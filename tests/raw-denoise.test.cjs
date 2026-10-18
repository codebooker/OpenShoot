const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs/promises"),
  os = require("node:os"),
  path = require("node:path"),
  sharp = require("sharp");
const { RawDenoiser } = require("../electron/raw-denoise.cjs"),
  { Library, validateEdits } = require("../electron/library.cjs"),
  { render, defaultEdits } = require("../electron/analysis.cjs");
const { validate } = require("../electron/ai-edit.cjs");
test("RAW denoise blends predictably, coalesces preview work, detects changed sources and missing caches", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "openshoot-raw-"));
  try {
    const lib = { root, busy: false },
      d = new RawDenoiser(lib, path.join(root, "missing-helper")),
      photo = { path: path.join(root, "photo.cr3") };
    await fs.writeFile(photo.path, "synthetic RAW identity");
    const key = await d.key(photo),
      dir = path.join(d.root, "products", key);
    await fs.mkdir(dir, { recursive: true });
    for (const [name, v] of [
      ["plain.png", 100],
      ["clean.png", 200],
    ])
      await sharp({
        create: {
          width: 40,
          height: 30,
          channels: 3,
          background: { r: v, g: v, b: v },
        },
      })
        .png()
        .toFile(path.join(dir, name));
    await fs.writeFile(path.join(dir, "result.json"), "{}");
    const edits = { ...defaultEdits(), rawDenoiseKey: key, aiDenoise: 50 };
    const [a, b] = await Promise.all([
      d.input(photo, edits, 20),
      d.input(photo, edits, 20),
    ]);
    assert.equal(a, b);
    const stats = await sharp(a).stats();
    assert.ok(Math.abs(stats.channels[0].mean - 150) < 1);
    const m = await sharp(a).metadata();
    assert.equal(m.width, 20);
    assert.equal(validateEdits({ ...edits, aiDenoise: 200 }).aiDenoise, 100);
    assert.throws(
      () => validateEdits({ ...edits, rawDenoiseKey: "../bad" }),
      /Invalid/,
    );
    const response = {
      exposure: 0.2,
      contrast: 1,
      saturation: 2,
      temperature: 3,
      cropRect: { x: 0, y: 0, width: 1, height: 1 },
      reason: "Test",
      confidence: 0.9,
    };
    assert.equal(
      validate(JSON.stringify(response), "both", edits).edits.rawDenoiseKey,
      key,
    );
    await fs.rm(path.join(dir, "result.json"));
    await assert.rejects(d.input(photo, edits, 30), /cache is missing/);
    await fs.writeFile(photo.path, "changed RAW identity");
    await assert.rejects(d.input(photo, edits, 30), /RAW changed/);
    const status = await d.status();
    assert.equal(status.available, false);
    await assert.rejects(d.generate(photo), /Install/);
    assert.equal(lib.busy, false);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
test("saved RAW denoise is used by preview and JPEG export; missing support fails explicitly", async () => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "openshoot-raw-export-"),
  );
  try {
    const source = path.join(root, "photo.jpg");
    await sharp({
      create: { width: 60, height: 40, channels: 3, background: "red" },
    })
      .jpeg()
      .toFile(source);
    const derived = path.join(root, "derived.png");
    await sharp({
      create: { width: 60, height: 40, channels: 3, background: "blue" },
    })
      .png()
      .toFile(derived);
    const lib = await new Library(path.join(root, "db")).init(),
      a = await lib.create("Raw integration", "Other");
    await lib.import(a.id, [source]);
    const p = a.photos[0],
      edits = {
        ...defaultEdits(),
        rawDenoiseKey: "a".repeat(64),
        aiDenoise: 50,
      };
    await lib.patch(a.id, [p.id], { edits });
    await assert.rejects(lib.editPreview(a.id, p.id, edits), /unavailable/);
    let calls = [];
    lib.denoiser = {
      input: async (photo, e, size) => {
        calls.push(size);
        assert.equal(e.rawDenoiseKey, edits.rawDenoiseKey);
        return derived;
      },
    };
    assert.equal(
      await lib.editPreview(a.id, p.id, edits),
      "data:image/jpeg;base64," +
        (await render(derived, edits, 1600)).toString("base64"),
    );
    const result = await lib.export(
      a.id,
      { scope: "all", format: "jpeg", maxSize: "" },
      root,
    );
    assert.equal(result.written, 1);
    const file = (await fs.readdir(result.folder)).find((f) =>
      f.endsWith(".jpg"),
    );
    assert.ok(
      (await fs.readFile(path.join(result.folder, file))).equals(
        await render(derived, edits),
      ),
    );
    assert.deepEqual(calls, [2400, undefined]);
    lib.denoiser = {
      input: async () => {
        throw Error("Cache unavailable");
      },
    };
    const failure = await lib.export(
      a.id,
      { scope: "all", format: "jpeg", maxSize: "" },
      root,
    );
    assert.equal(failure.written, 0);
    assert.match(failure.failures[0].error, /Cache unavailable/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("cached denoise sources survive scratch cleanup and regenerate blend previews", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "openshoot-scratch-"));
  try {
    const lib = { root, busy: false },
      d = new RawDenoiser(lib, "unused"),
      photo = { path: path.join(root, "photo.cr3") };
    await fs.writeFile(photo.path, "original identity");
    d.status = async () => ({ installed: true });
    const key = await d.key(photo),
      dir = path.join(d.root, "products", key);
    await fs.mkdir(path.join(dir, "library"), { recursive: true });
    await fs.writeFile(path.join(dir, "library", "working-copy"), "scratch");
    for (const name of ["plain.png", "clean.png"])
      await sharp({
        create: { width: 20, height: 20, channels: 3, background: "#808080" },
      })
        .png()
        .toFile(path.join(dir, name));
    await fs.writeFile(path.join(dir, "result.json"), JSON.stringify({ key }));
    await d.generate(photo);
    await assert.rejects(fs.access(path.join(dir, "library")));
    assert.equal(await fs.readFile(photo.path, "utf8"), "original identity");
    await fs.access(path.join(dir, "plain.png"));
    await fs.access(path.join(dir, "clean.png"));
    await fs.access(
      await d.input(photo, { rawDenoiseKey: key, aiDenoise: 85 }, 20),
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
