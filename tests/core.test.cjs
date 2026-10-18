const { test } = require("node:test");
const assert = require("node:assert/strict");
const sharp = require("sharp");
const fs = require("node:fs/promises"),
  os = require("node:os"),
  path = require("node:path");
const {
  measure,
  classify,
  hamming,
  xmp,
  render,
  freshEdits,
} = require("../electron/analysis.cjs");
const { Library } = require("../electron/library.cjs");
const {
  RAW_EXTENSIONS,
  JPEG_EXTENSIONS,
  FILE_TYPES,
  filterFiles,
} = require("../electron/file-types.cjs");
const { validate } = require("../electron/ai.cjs");
const { readResponseStream } = require("../electron/auth.cjs");
async function fixture() {
  const w = 400,
    h = 300,
    data = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const v = ((x >> 3) + (y >> 3)) % 2 ? 200 : 55;
      for (let c = 0; c < 3; c++) data[(y * w + x) * 3 + c] = v;
    }
  return sharp(data, { raw: { width: w, height: h, channels: 3 } })
    .png()
    .toBuffer();
}
test("format registry includes major modern and legacy brands; filters are case-insensitive and exact", () => {
  for (const e of [
    ".crw",
    ".cr2",
    ".cr3",
    ".nef",
    ".nrw",
    ".arw",
    ".srf",
    ".sr2",
    ".raf",
    ".orf",
    ".rw2",
    ".rwl",
    ".pef",
    ".srw",
    ".3fr",
    ".fff",
    ".iiq",
    ".dng",
    ".gpr",
    ".x3f",
  ])
    assert.ok(RAW_EXTENSIONS.includes(e), e);
  const files = [
    "a.CR3",
    "a.JPG",
    "b.NEF",
    "c.ARW",
    "d.RAF",
    "e.JPEG",
    "file.jpg.exe",
    "clip.mov",
    "sidecar.xmp",
    "f.heic",
    "d.raw",
  ];
  assert.deepEqual(filterFiles(files, RAW_EXTENSIONS), [
    "a.CR3",
    "b.NEF",
    "c.ARW",
    "d.RAF",
    "d.raw",
  ]);
  assert.deepEqual(filterFiles(files, JPEG_EXTENSIONS), ["a.JPG", "e.JPEG"]);
  assert.deepEqual(filterFiles(files, [".heic"]), ["f.heic"]);
  assert.deepEqual(filterFiles(files, []), []);
  assert.throws(() => filterFiles(files, [".exe"]));
  assert.equal(
    Object.keys(FILE_TYPES).length,
    new Set(Object.keys(FILE_TYPES)).size,
  );
});
test("blur reduces measured sharpness; hamming is deterministic", async () => {
  const image = await fixture(),
    blur = await sharp(image).blur(6).png().toBuffer();
  const a = await measure(image),
    b = await measure(blur);
  assert.ok(a.sharpness > b.sharpness * 5, JSON.stringify({ a, b }));
  assert.equal(hamming(a.hash, a.hash), 0);
  assert.equal(hamming("0000000000000000", "ffffffffffffffff"), 64);
  assert.ok(Number.isFinite(a.brightness));
});
test("local culling retains sharp group representative and meets target without changing originals", () => {
  const p = (id, hash, sharpness, brightness = 128) => ({
    id,
    width: 400,
    height: 300,
    rating: 0,
    category: "Unrated",
    edits: {},
    analysis: { hash, sharpness, brightness },
  });
  const photos = [
    p("a", "abcdef0123456789", 400),
    p("b", "abcdef0123456789", 40),
    p("c", "0000000000000000", 2),
    p("d", "ffffffffffffffff", 300),
  ];
  const r = classify(photos, { blur: "standard" });
  assert.equal(r[0].category, "Selected");
  assert.equal(r[1].category, "Duplicates");
  assert.equal(r[2].category, "Blurred");
  assert.equal(r[3].category, "Selected");
  assert.equal(photos[0].category, "Unrated");
  assert.equal(
    classify(photos, { mode: "target", target: 1 }).filter(
      (p) => p.category === "Selected",
    ).length,
    1,
  );
  assert.equal(
    classify(photos, { duplicates: false }).filter(
      (p) => p.category === "Duplicates",
    ).length,
    0,
  );
});
test("rendered edits change pixels and honor center crop plus rotation", async () => {
  const source = await fixture(),
    a = await render(source, {}),
    b = await render(source, {
      exposure: 1,
      temperature: 10,
      crop: "1:1",
      rotation: 90,
    });
  assert.notDeepEqual(a, b);
  const meta = await sharp(b).metadata();
  assert.equal(meta.width, 300);
  assert.equal(meta.height, 300);
  const c = await render(source, { rotation: 90 });
  const cm = await sharp(c).metadata();
  assert.equal(cm.width, 300);
  assert.equal(cm.height, 400);
  const d = await render(source, { crop: "4:5" });
  const dm = await sharp(d).metadata();
  assert.equal(dm.width, 240);
  assert.equal(dm.height, 300);
});
test("XMP escapes user-controlled labels and stores rating", () => {
  const s = xmp({ rating: 4, label: 'A" & <B>', category: "Selected" });
  assert.ok(s.includes('xmp:Rating="4"'));
  assert.ok(s.includes("A&quot; &amp; &lt;B&gt;"));
});
test("AI response validation rejects missing, duplicated, foreign, or malformed rows and downgrades uncertainty", () => {
  const row = {
    id: "a",
    decision: "keep",
    confidence: 0.8,
    reason: "Visible detail.",
    issue: "none",
  };
  assert.equal(
    validate(JSON.stringify({ photos: [row] }), ["a"])[0].decision,
    "review",
  );
  for (const photos of [
    [],
    [row, row],
    [{ ...row, id: "b" }],
    [{ ...row, confidence: 1.1 }],
    [{ ...row, reason: "" }],
    [{ ...row, command: "delete" }],
  ])
    assert.throws(() => validate(JSON.stringify({ photos }), ["a"]));
});
test("stream reader handles split chunks and requires terminal completion", async () => {
  const events =
    'data: {"type":"response.output_text.delta","delta":"hello"}\n\ndata: {"type":"response.completed"}\n\n';
  const stream = (text) =>
    new ReadableStream({
      start(c) {
        for (let i = 0; i < text.length; i += 7)
          c.enqueue(Buffer.from(text.slice(i, i + 7)));
        c.close();
      },
    });
  assert.equal(await readResponseStream(stream(events)), "hello");
  await assert.rejects(
    readResponseStream(
      stream(
        'data: {"type":"response.output_text.delta","delta":"partial"}\n\n',
      ),
    ),
    /before completion/,
  );
  await assert.rejects(
    readResponseStream(
      stream(
        'data: {"type":"response.failed","response":{"error":{"message":"usage limit"}}}\n\n',
      ),
    ),
    /usage limit/,
  );
});
test("library imports recursively, skips duplicates, persists ratings, exports unique folders and preserves source", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "openshoot-test-"));
  try {
    const source = path.join(root, "shoot"),
      nested = path.join(source, "nested"),
      out = path.join(root, "out");
    await fs.mkdir(nested, { recursive: true });
    await fs.mkdir(out);
    const bytes = await fixture();
    await fs.writeFile(path.join(source, "one.JPG"), bytes);
    await fs.writeFile(path.join(nested, "two.png"), bytes);
    await fs.writeFile(
      path.join(source, "bad.jpg"),
      Buffer.from("not an image"),
    );
    await fs.writeFile(path.join(source, "sidecar.xmp"), "sidecar");
    await fs.symlink(source, path.join(nested, "cycle"));
    const lib = await new Library(path.join(root, "db")).init();
    const album = await lib.create("Test", "Other");
    const result = await lib.import(album.id, [source]);
    assert.equal(result.added, 2);
    assert.equal(result.errors.length, 1);
    assert.equal((await lib.import(album.id, [source])).added, 0);
    const ids = album.photos.map((p) => p.id);
    await lib.patch(album.id, ids, {
      rating: 5,
      category: "Selected",
      label: "Green",
    });
    const loaded = await new Library(path.join(root, "db")).init();
    assert.equal(loaded.album(album.id).photos[0].rating, 5);
    const exported = await lib.export(
      album.id,
      { format: "original", scope: "selected" },
      out,
    );
    assert.equal(exported.written, 2);
    assert.equal(
      (await fs.readdir(exported.folder)).filter((f) => f.endsWith(".xmp"))
        .length,
      2,
    );
    const second = await lib.export(
      album.id,
      { format: "jpeg", scope: "selected" },
      out,
    );
    assert.notEqual(exported.folder, second.folder);
    assert.equal(second.written, 2);
    assert.deepEqual(await fs.readFile(path.join(source, "one.JPG")), bytes);
    await lib.archive(album.id);
    assert.equal(lib.list().length, 0);
    await lib.restore();
    assert.equal(lib.list().length, 1);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("each light and color slider independently changes rendered pixels", async () => {
  const width = 120,
    height = 80,
    pixels = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3;
      pixels[i] = 40 + x;
      pixels[i + 1] = 50 + y * 2;
      pixels[i + 2] = 170 - Math.floor(x / 2);
    }
  const source = await sharp(pixels, { raw: { width, height, channels: 3 } })
    .png()
    .toBuffer();
  const decoded = async (edits) =>
    sharp(await render(source, edits))
      .toColourspace("srgb")
      .removeAlpha()
      .raw()
      .toBuffer();
  const baseline = await decoded({});
  for (const edits of [
    { exposure: 1 },
    { contrast: 40 },
    { saturation: -80 },
    { temperature: 70 },
  ]) {
    const output = await decoded(edits);
    let difference = 0;
    for (let i = 0; i < baseline.length; i++)
      difference += Math.abs(baseline[i] - output[i]);
    assert.ok(
      difference / baseline.length > 2,
      JSON.stringify(edits) + " must have a visible effect",
    );
  }
});

test("photo previews use a dedicated directory and recover missing legacy previews from the original", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "openshoot-preview-"));
  try {
    const source = path.join(root, "source.png");
    await fs.writeFile(source, await fixture());
    const lib = await new Library(path.join(root, "db")).init();
    const a = await lib.create("Preview test", "Other");
    await lib.import(a.id, [source]);
    const p = a.photos[0];
    assert.equal(path.basename(lib.cache), "previews");
    // Simulate the old browser cache location and migration on the next launch.
    const legacy = path.join(lib.root, "cache");
    await fs.mkdir(legacy);
    const preview = path.join(lib.cache, p.id + ".jpg");
    await fs.rename(preview, path.join(legacy, p.id + ".jpg"));
    await fs.writeFile(path.join(legacy, "chromium-owned"), "leave intact");
    const loaded = await new Library(lib.root).init();
    await fs.access(preview);
    assert.equal(
      await fs.readFile(path.join(legacy, "chromium-owned"), "utf8"),
      "leave intact",
    );
    await fs.unlink(preview);
    let decodes = 0;
    const originalDecode = loaded.decode.bind(loaded);
    loaded.decode = async (...args) => {
      decodes++;
      return originalDecode(...args);
    };
    await Promise.all([loaded.ensurePreview(p.id), loaded.ensurePreview(p.id)]);
    assert.equal(decodes, 1);
    await fs.access(preview);
    const data = await loaded.editPreview(a.id, p.id, { exposure: 1 });
    assert.ok(data.startsWith("data:image/jpeg;base64,"));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
