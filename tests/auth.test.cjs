const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises"),
  path = require("node:path"),
  os = require("node:os");
const { ChatGPT } = require("../electron/auth.cjs");
test("independent OAuth flow validates state, signature, nonce and issued audience, and stores only app-specific credentials", async () => {
  const { generateKeyPair, SignJWT } = await import("jose");
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "openshoot-auth-"));
  let auth;
  try {
    let url;
    const safe = {
      isEncryptionAvailable: () => true,
      encryptString: (s) => Buffer.from(s),
      decryptString: (b) => b.toString(),
    };
    auth = new ChatGPT(root, safe, async (u) => {
      url = new URL(u);
    });
    auth.keys = async () => publicKey;
    await auth.init();
    const host = auth.host;
    auth.json = async (endpoint) => {
      assert.equal(
        endpoint,
        "https://auth.openai.com/api/accounts/oauth/token",
      );
      const id = await new SignJWT({
        nonce: url.searchParams.get("nonce"),
        email: "fixture@example.invalid",
      })
        .setProtectedHeader({ alg: "RS256" })
        .setIssuer("https://auth.openai.com")
        .setAudience("fixture-client")
        .setSubject("fixture-subject")
        .setIssuedAt()
        .setExpirationTime("1h")
        .sign(privateKey);
      return {
        access_token: "fixture-access",
        refresh_token: "fixture-refresh",
        id_token: id,
        scope: "openid chatgpt.tokens.use.direct",
        expires_in: 3600,
      };
    };
    await auth.signIn();
    assert.equal(url.searchParams.get("agent_name_hint"), "OpenShoot");
    assert.equal(url.searchParams.get("client_id"), "dynamic_agent_client");
    assert.ok(
      url.searchParams.get("scope").includes("chatgpt.tokens.use.direct"),
    );
    assert.equal(url.searchParams.get("code_challenge_method"), "S256");
    const callback = new URL(url.searchParams.get("redirect_uri"));
    assert.equal(callback.hostname, "127.0.0.1");
    callback.searchParams.set("state", "incorrect");
    assert.equal((await fetch(callback)).status, 400);
    assert.equal(auth.status().connected, false);
    callback.searchParams.set("state", url.searchParams.get("state"));
    callback.searchParams.set("code", "fixture-code");
    callback.searchParams.set("client_id", "fixture-client");
    assert.equal((await fetch(callback)).status, 200);
    assert.equal(auth.status().enabled, true);
    assert.equal(auth.account.client_id, "fixture-client");
    assert.equal(auth.pending, null);
    assert.equal(
      (await fs.stat(path.join(root, "chatgpt.enc"))).mode & 0o777,
      0o600,
    );
    const loaded = new ChatGPT(root, safe, () => {});
    await loaded.init();
    assert.equal(loaded.host, host);
    assert.equal(loaded.status().email, "fixture@example.invalid");
    assert.equal(await loaded.token(), "fixture-access");
    await assert.rejects(
      auth.verify(auth.account.id_token, "wrong-audience"),
      /aud/,
    );
    await assert.rejects(
      auth.verify(auth.account.id_token, "fixture-client", "wrong-nonce"),
      /nonce/,
    );
  } finally {
    auth?.pending?.server.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});
