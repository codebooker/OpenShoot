// OpenShoot's own implementation of the documented public OAuth/PKCE flow.
const fs = require("node:fs/promises"),
  path = require("node:path"),
  http = require("node:http"),
  crypto = require("node:crypto");
const AUTH = "https://auth.openai.com",
  RESOURCE = "https://api.openai.com/v1";
class ChatGPT {
  constructor(root, safeStorage, openBrowser) {
    this.root = root;
    this.safe = safeStorage;
    this.openBrowser = openBrowser;
    this.account = null;
    this.pending = null;
    this.refreshing = null;
  }
  async init() {
    try {
      const host = JSON.parse(
        await fs.readFile(path.join(this.root, "host.json"), "utf8"),
      );
      this.host = host.id;
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
      this.host = "urn:uuid:" + crypto.randomUUID();
      await fs.writeFile(
        path.join(this.root, "host.json"),
        JSON.stringify({ id: this.host }),
        { mode: 0o600 },
      );
    }
    try {
      const data = await fs.readFile(path.join(this.root, "chatgpt.enc"));
      if (this.safe.isEncryptionAvailable()) {
        this.account = JSON.parse(this.safe.decryptString(data));
      }
    } catch (e) {
      if (e.code !== "ENOENT")
        this.storageError =
          "Saved ChatGPT connection could not be unlocked. Sign in again.";
    }
  }
  status() {
    return {
      connected: !!this.account,
      enabled: !!this.account?.scope
        ?.split(" ")
        .includes("chatgpt.tokens.use.direct"),
      email: this.account?.email || "",
      pending: !!this.pending,
      error: this.storageError || "",
    };
  }
  async persist() {
    if (!this.safe.isEncryptionAvailable())
      throw Error("Secure credential storage is unavailable");
    const dest = path.join(this.root, "chatgpt.enc");
    await fs.writeFile(
      dest + ".tmp",
      this.safe.encryptString(JSON.stringify(this.account)),
      { mode: 0o600 },
    );
    await fs.rename(dest + ".tmp", dest);
  }
  async json(url, options = {}) {
    const response = await fetch(url, {
      ...options,
      signal: options.signal || AbortSignal.timeout(45000),
    });
    if (!response.ok) {
      let code = "";
      try {
        const e = await response.json();
        code = e.error?.code || e.error || "";
      } catch {}
      throw Error(
        `OpenAI request failed (${response.status})${typeof code === "string" && code ? " — " + code : ""}`,
      );
    }
    return response.json();
  }
  async verify(token, audience, nonce) {
    const { jwtVerify, createRemoteJWKSet } = await import("jose");
    if (!this.keys) {
      const discovery = await this.json(
        AUTH + "/.well-known/openid-configuration",
      );
      const u = new URL(discovery.jwks_uri);
      if (u.origin !== AUTH) throw Error("Unexpected identity key origin");
      this.keys = createRemoteJWKSet(u);
    }
    const { payload } = await jwtVerify(token, this.keys, {
      issuer: AUTH,
      audience,
      algorithms: ["RS256"],
    });
    if (nonce && payload.nonce !== nonce) throw Error("Sign-in nonce mismatch");
    if (!payload.sub) throw Error("Missing account identity");
    return payload;
  }
  async signIn() {
    if (this.pending) throw Error("A sign-in is already in progress");
    if (!this.safe.isEncryptionAvailable())
      throw Error("Secure credential storage is unavailable");
    const state = crypto.randomBytes(32).toString("base64url"),
      nonce = crypto.randomBytes(32).toString("base64url"),
      verifier = crypto.randomBytes(48).toString("base64url");
    const previous = this.account;
    const client = previous?.client_id || "dynamic_agent_client";
    const server = http.createServer();
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const redirect = `http://127.0.0.1:${server.address().port}/auth/callback`;
    this.pending = { server, state };
    const finish = () => {
      clearTimeout(timer);
      server.close();
      this.pending = null;
    };
    const timer = setTimeout(
      () => {
        finish();
        this.onChange?.({ error: "Sign-in expired. Please try again." });
      },
      5 * 60 * 1000,
    );
    server.on("request", async (req, res) => {
      const u = new URL(req.url, redirect);
      if (u.pathname !== "/auth/callback") {
        res.writeHead(404).end();
        return;
      }
      if (u.searchParams.get("state") !== state) {
        res.writeHead(400).end("Invalid sign-in state.");
        return;
      }
      try {
        if (u.searchParams.has("error"))
          throw Error("ChatGPT authorization was declined");
        const code = u.searchParams.get("code");
        let issued = u.searchParams.get("client_id") || client;
        if (
          !code ||
          issued === "dynamic_agent_client" ||
          (previous && issued !== client)
        )
          throw Error("Incomplete or mismatched app registration");
        const token = await this.json(AUTH + "/api/accounts/oauth/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            grant_type: "authorization_code",
            client_id: issued,
            code,
            code_verifier: verifier,
            redirect_uri: redirect,
            resource: RESOURCE,
          }).toString(),
        });
        const claims = await this.verify(token.id_token, issued, nonce);
        if (previous && claims.sub !== previous.subject)
          throw Error(
            "The selected account differs. Disconnect before adding another account.",
          );
        if (!token.access_token || !token.refresh_token)
          throw Error("A renewable ChatGPT connection was not granted");
        const account = {
          client_id: issued,
          subject: claims.sub,
          email: claims.email || "",
          id_token: token.id_token,
          access_token: token.access_token,
          refresh_token: token.refresh_token,
          scope: token.scope || "",
          expires_at: Date.now() + (Number(token.expires_in) || 3600) * 1000,
        };
        this.account = account;
        try {
          await this.persist();
        } catch (e) {
          this.account = previous;
          throw e;
        }
        res
          .writeHead(200, {
            "Content-Type": "text/html; charset=utf-8",
            "Content-Security-Policy": "default-src 'none'",
          })
          .end(
            "<h1>Connected to OpenShoot</h1><p>You can close this tab and return to the app.</p>",
          );
        finish();
        this.storageError = "";
        this.onChange?.(this.status());
      } catch (e) {
        res
          .writeHead(400, { "Content-Type": "text/plain" })
          .end("Sign-in failed. Return to OpenShoot for details.");
        finish();
        this.onChange?.({ error: e.message });
      }
    });
    const u = new URL(AUTH + "/api/accounts/authorize");
    const params = {
      client_id: client,
      ext_agent_host_id: this.host,
      response_type: "code",
      redirect_uri: redirect,
      scope:
        "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct",
      resource: RESOURCE,
      state,
      nonce,
      code_challenge_method: "S256",
      code_challenge: crypto
        .createHash("sha256")
        .update(verifier)
        .digest("base64url"),
    };
    if (previous) params.id_token_hint = previous.id_token;
    else params.agent_name_hint = "OpenShoot";
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
    try {
      await this.openBrowser(u.href);
    } catch (e) {
      finish();
      throw e;
    }
    return this.status();
  }
  async token() {
    if (!this.account) throw Error("Continue with ChatGPT in Settings first");
    if (!this.status().enabled)
      throw Error(
        "ChatGPT plan usage was not granted. Reconnect and enable plan usage.",
      );
    if (this.account.expires_at > Date.now() + 60000)
      return this.account.access_token;
    if (!this.refreshing)
      this.refreshing = this.refresh().finally(() => {
        this.refreshing = null;
      });
    return this.refreshing;
  }
  async refresh() {
    const a = this.account;
    const t = await this.json(AUTH + "/api/accounts/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: a.client_id,
        refresh_token: a.refresh_token,
        resource: RESOURCE,
      }).toString(),
    });
    if (!t.access_token) throw Error("No access token returned");
    if (t.id_token) {
      const claims = await this.verify(t.id_token, a.client_id);
      if (claims.sub !== a.subject)
        throw Error("Refreshed account does not match");
    }
    this.account = {
      ...a,
      access_token: t.access_token,
      refresh_token: t.refresh_token || a.refresh_token,
      id_token: t.id_token || a.id_token,
      scope: t.scope || a.scope,
      expires_at: Date.now() + (Number(t.expires_in) || 3600) * 1000,
    };
    await this.persist();
    return this.account.access_token;
  }
  async models() {
    const token = await this.token();
    const data = await this.json(RESOURCE + "/models", {
      headers: { Authorization: "Bearer " + token },
    });
    return (data.models || [])
      .filter((m) => m.visibility === "list")
      .map((m) => ({ id: m.slug, name: m.display_name }));
  }
  async disconnect() {
    if (this.pending) {
      this.pending.server.close();
      this.pending = null;
    }
    if (this.account) {
      // Revoke when supported; local credentials are removed even if the service is unreachable.
      try {
        const d = await this.json(AUTH + "/.well-known/openid-configuration");
        if (
          d.revocation_endpoint &&
          new URL(d.revocation_endpoint).origin === AUTH
        )
          await this.json(d.revocation_endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
              token: this.account.refresh_token,
              token_type_hint: "refresh_token",
              client_id: this.account.client_id,
            }).toString(),
          });
      } catch {}
    }
    this.account = null;
    await fs.rm(path.join(this.root, "chatgpt.enc"), { force: true });
    return this.status();
  }
  async respond(body, signal) {
    const token = await this.token();
    const response = await fetch(RESOURCE + "/responses", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ...body, store: false, stream: true }),
      signal,
    });
    if (!response.ok) {
      let message = "";
      try {
        const e = await response.json();
        message = e.error?.message || "";
      } catch {}
      const error = Error(
        `ChatGPT returned ${response.status}. ${message.slice(0, 300)}`,
      );
      error.status = response.status;
      const retry = response.headers.get("retry-after");
      error.retryAfterMs =
        Math.max(
          0,
          Number.isFinite(Number(retry))
            ? Number(retry) * 1000
            : Date.parse(retry) - Date.now(),
        ) || 0;
      throw error;
    }
    return readResponseStream(response.body, signal);
  }
}
async function readResponseStream(body, signal) {
  const decoder = new TextDecoder();
  let buffer = "",
    text = "",
    complete = false,
    total = 0;
  for await (const bytes of body) {
    if (signal?.aborted) throw Error("AI culling paused");
    total += bytes.length;
    if (total > 8 * 1024 * 1024) throw Error("AI response exceeded size limit");
    buffer += decoder.decode(bytes, { stream: true });
    buffer = buffer.replace(/\r\n/g, "\n");
    let end;
    while ((end = buffer.indexOf("\n\n")) >= 0) {
      const frame = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      const data = frame
        .split("\n")
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).trimStart())
        .join("\n");
      if (!data || data === "[DONE]") continue;
      const event = JSON.parse(data);
      if (event.type === "response.output_text.delta")
        text += event.delta || "";
      if (event.type === "response.completed") complete = true;
      if (
        ["error", "response.failed", "response.incomplete"].includes(event.type)
      )
        throw Error(
          event.response?.error?.message ||
            event.error?.message ||
            "ChatGPT did not complete the assessment",
        );
    }
  }
  if (!complete)
    throw Error(
      "AI stream ended before completion. The saved queue can be resumed.",
    );
  return text;
}
module.exports = { ChatGPT, readResponseStream };
