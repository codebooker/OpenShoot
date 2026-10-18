const fs = require("node:fs/promises"),
  fss = require("node:fs"),
  path = require("node:path"),
  crypto = require("node:crypto");
const { spawn, execFile } = require("node:child_process"),
  { promisify } = require("node:util");
const sharp = require("sharp"),
  model = require("./raw-model.json");
class RawDenoiser {
  constructor(lib, helper) {
    this.lib = lib;
    this.root = path.join(lib.root, "raw-denoise");
    this.models = path.join(this.root, "models");
    this.helper = helper;
    this.child = null;
    this.hashes = new Map();
    this.blends = new Map();
    this.downloadController = null;
    this.cancelled = false;
  }
  async status() {
    let installed = false,
      device = null;
    try {
      await fs.access(path.join(this.models, model.id, "model.onnx"));
      installed = true;
    } catch {}
    try {
      device = JSON.parse(
        await fs.readFile(path.join(this.root, "device.json"), "utf8"),
      );
    } catch {}
    return {
      available: fss.existsSync(this.helper),
      installed,
      model: model.name,
      license: model.licence.name,
      source: model.source,
      device,
    };
  }
  cancel() {
    this.cancelled = true;
    this.downloadController?.abort();
    this.child?.kill("SIGTERM");
  }
  async worker(args, progress = () => {}) {
    if (this.cancelled)
      throw Error(
        "RAW denoise stopped. Your edits and originals are unchanged.",
      );
    if (!fss.existsSync(this.helper))
      throw Error(
        "The native RAW denoise worker is not installed. Rebuild OpenShoot.",
      );
    return new Promise((resolve, reject) => {
      const child = spawn(this.helper, args, {
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          LIGHTCRAFT_DENOISE_URL: "",
          LIGHTCRAFT_DENOISE_TOKEN: "",
          LIGHTCRAFT_CAMERA_PROFILES: path.join(this.root, "camera-profiles"),
        },
      });
      this.child = child;
      let buffer = "",
        stderr = "",
        error = "",
        result = null;
      const timer = setTimeout(() => child.kill("SIGTERM"), 30 * 60 * 1000);
      child.stdout.on("data", (chunk) => {
        buffer += chunk.toString();
        if (buffer.length > 1024 * 1024) {
          child.kill();
          return;
        }
        let i;
        while ((i = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, i);
          buffer = buffer.slice(i + 1);
          try {
            const event = JSON.parse(line);
            if (event.error) error = event.error;
            if (event.phase)
              progress({
                phase: event.phase,
                done: event.done || 0,
                total: event.total || 1,
              });
            if (event.complete || event.installed) result = event;
          } catch {}
        }
      });
      child.stderr.on("data", (chunk) => {
        stderr = (stderr + chunk.toString()).slice(-4000);
      });
      child.on("error", (e) => {
        clearTimeout(timer);
        this.child = null;
        reject(e);
      });
      child.on("close", (code, signal) => {
        clearTimeout(timer);
        this.child = null;
        if (code === 0 && result) resolve(result);
        else
          reject(
            Error(
              signal
                ? "RAW denoise stopped. Your edits and originals are unchanged."
                : error || stderr || "RAW denoise worker failed",
            ),
          );
      });
    });
  }
  async install(file, progress) {
    if (this.lib.busy) throw Error("Please wait for the current operation");
    this.lib.busy = true;
    this.cancelled = false;
    const stage = path.join(this.root, "install-" + crypto.randomUUID());
    try {
      await fs.mkdir(stage, { recursive: true });
      let input = file;
      if (path.extname(file).toLowerCase() === ".dtmodel") {
        await promisify(execFile)(
          "/usr/bin/unzip",
          ["-p", file, "model_bayer.onnx"],
          { encoding: "buffer", maxBuffer: 40 * 1024 * 1024 },
        ).then((r) => fs.writeFile(path.join(stage, "model.onnx"), r.stdout));
        input = path.join(stage, "model.onnx");
      }
      const stat = await fs.stat(input);
      if (stat.size !== model.sizeBytes)
        throw Error(
          "This file is not the supported RawNIND Bayer model (unexpected size).",
        );
      const hash = crypto
        .createHash("sha256")
        .update(await fs.readFile(input))
        .digest("hex");
      if (hash !== model.sha256)
        throw Error("RAW denoise model checksum did not match.");
      if (input !== path.join(stage, "model.onnx"))
        await fs.copyFile(input, path.join(stage, "model.onnx"));
      await fs.writeFile(
        path.join(stage, "denoise-model.json"),
        JSON.stringify(model),
      );
      const result = await this.worker(
        ["install", this.models, stage, path.join(stage, "model.onnx"), "gpu"],
        progress,
      );
      await fs.writeFile(
        path.join(this.root, "device.json"),
        JSON.stringify(result.status?.device || null),
      );
      return this.status();
    } finally {
      this.lib.busy = false;
      await fs.rm(stage, { recursive: true, force: true });
    }
  }
  async download(progress) {
    if (this.lib.busy) throw Error("Please wait for the current operation");
    await fs.mkdir(this.root, { recursive: true });
    const file = path.join(
      this.root,
      "model-download-" + crypto.randomUUID() + ".dtmodel",
    );
    this.lib.busy = true;
    this.cancelled = false;
    this.downloadController = new AbortController();
    try {
      const response = await fetch(
        "https://github.com/darktable-org/darktable-ai/releases/download/release-5.6.0/rawdenoise-nind.dtmodel",
        {
          signal: AbortSignal.any([
            this.downloadController.signal,
            AbortSignal.timeout(180000),
          ]),
        },
      );
      if (!response.ok)
        throw Error("Model download failed: " + response.status);
      const parts = [];
      let size = 0;
      for await (const chunk of response.body) {
        size += chunk.length;
        if (size > 60 * 1024 * 1024)
          throw Error("Model download exceeded its size limit");
        parts.push(chunk);
        progress({
          phase: "Downloading RAW denoise model",
          done: size,
          total: Number(response.headers.get("content-length")) || 57700134,
        });
      }
      const data = Buffer.concat(parts);
      if (
        crypto.createHash("sha256").update(data).digest("hex") !==
        "d71b5f1e727c85a359e6f74dca9e2016c9d8fc3e2f7ac3e9b347d80ceca969af"
      )
        throw Error("Downloaded model checksum did not match");
      await fs.writeFile(file, data);
      this.lib.busy = false;
      return await this.install(file, progress);
    } finally {
      this.lib.busy = false;
      this.downloadController = null;
      await fs.rm(file, { force: true });
    }
  }
  async digest(photo) {
    const stat = await fs.stat(photo.path),
      fingerprint = photo.path + ":" + stat.size + ":" + stat.mtimeMs;
    const found = this.hashes.get(fingerprint);
    if (found) return found;
    const hash = crypto.createHash("sha256");
    for await (const chunk of fss.createReadStream(photo.path))
      hash.update(chunk);
    const value = hash.digest("hex");
    this.hashes.set(fingerprint, value);
    return value;
  }
  async key(photo) {
    return crypto
      .createHash("sha256")
      .update(
        (await this.digest(photo)) + ":" + model.sha256 + ":openshoot-raw-v1",
      )
      .digest("hex");
  }
  async generate(photo, progress = () => {}, ownsLock = false) {
    if (this.lib.busy && !ownsLock)
      throw Error("Please wait for the current operation");
    this.lib.busy = true;
    this.cancelled = false;
    try {
      if (!(await this.status()).installed)
        throw Error("Install the RawNIND model first.");
      const key = await this.key(photo),
        dir = path.join(this.root, "products", key);
      await fs.mkdir(dir, { recursive: true });
      try {
        const meta = JSON.parse(
          await fs.readFile(path.join(dir, "result.json"), "utf8"),
        );
        await fs.access(path.join(dir, "clean.png"));
        await fs.access(path.join(dir, "plain.png"));
        await fs.rm(path.join(dir, "library"), {
          recursive: true,
          force: true,
        });
        return { ...meta, key };
      } catch {}
      const result = await this.worker(
        ["render", this.models, dir, photo.path, "gpu"],
        progress,
      );
      const clean = await sharp(path.join(dir, "clean.png")).metadata(),
        plain = await sharp(path.join(dir, "plain.png")).metadata();
      if (clean.width !== plain.width || clean.height !== plain.height)
        throw Error("RAW denoise output dimensions do not match");
      const meta = {
        key,
        width: clean.width,
        height: clean.height,
        model: model.name,
        device: result.device,
        seconds: result.seconds,
      };
      await fs.writeFile(
        path.join(dir, "result.json.tmp"),
        JSON.stringify(meta),
      );
      await fs.rename(
        path.join(dir, "result.json.tmp"),
        path.join(dir, "result.json"),
      );
      await fs.writeFile(
        path.join(this.root, "device.json"),
        JSON.stringify(result.device),
      );
      await fs.rm(path.join(dir, "library"), { recursive: true, force: true });
      return meta;
    } finally {
      if (!ownsLock) this.lib.busy = false;
    }
  }
  async input(photo, edits, maxSize) {
    const jobKey = JSON.stringify([
      photo.path,
      edits.rawDenoiseKey,
      edits.aiDenoise,
      maxSize,
    ]);
    if (this.blends.has(jobKey)) return this.blends.get(jobKey);
    const job = this.blendInput(photo, edits, maxSize);
    this.blends.set(jobKey, job);
    try {
      return await job;
    } finally {
      this.blends.delete(jobKey);
    }
  }
  async blendInput(photo, edits, maxSize) {
    const key = edits.rawDenoiseKey;
    if (!/^[a-f0-9]{64}$/.test(key || ""))
      throw Error("Invalid RAW denoise cache key");
    if ((await this.key(photo)) !== key)
      throw Error(
        "The original RAW changed. Generate its denoised version again.",
      );
    const dir = path.join(this.root, "products", key);
    try {
      await fs.access(path.join(dir, "result.json"));
      await fs.access(path.join(dir, "clean.png"));
    } catch {
      throw Error(
        "The denoised RAW cache is missing. Generate it again before preview or export.",
      );
    }
    const amount = Math.max(0, Math.min(100, edits.aiDenoise || 0));
    const output = path.join(dir, `blend-${amount}-${maxSize || "full"}.png`);
    try {
      await fs.access(output);
      return output;
    } catch {}
    const decode = (file) => {
      let p = sharp(path.join(dir, file)).removeAlpha().toColourspace("srgb");
      if (maxSize)
        p = p.resize(maxSize, maxSize, {
          fit: "inside",
          withoutEnlargement: true,
        });
      return p.raw().toBuffer({ resolveWithObject: true });
    };
    const [plain, clean] = await Promise.all([
      decode("plain.png"),
      decode("clean.png"),
    ]);
    if (plain.data.length !== clean.data.length)
      throw Error("RAW denoise blend dimensions differ");
    const mix = amount / 100;
    for (let i = 0; i < plain.data.length; i++)
      plain.data[i] = Math.round(
        plain.data[i] * (1 - mix) + clean.data[i] * mix,
      );
    await sharp(plain.data, {
      raw: { width: plain.info.width, height: plain.info.height, channels: 3 },
    })
      .png()
      .toFile(output + ".tmp");
    await fs.rename(output + ".tmp", output);
    return output;
  }
}
module.exports = { RawDenoiser };
