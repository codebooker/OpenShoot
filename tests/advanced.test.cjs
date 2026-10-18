const { test } = require("node:test");
const assert = require("node:assert/strict");
const sharp = require("sharp"),
  fs = require("node:fs/promises"),
  path = require("node:path"),
  os = require("node:os");
const { render, defaultEdits } = require("../electron/analysis.cjs");
const { controls } = require("../electron/advanced.cjs");
const { Library, validateEdits } = require("../electron/library.cjs");
async function fixture() {
  const w = 320,
    h = 240,
    data = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3;
      data[i] = (x * 3 + y * 7) % 256;
      data[i + 1] = (x * 5 + y * 2) % 256;
      data[i + 2] = (x + y * 3) % 256;
    }
  return sharp(data, { raw: { width: w, height: h, channels: 3 } })
    .png()
    .toBuffer();
}
test("every advanced slider changes rendered pixels, respects bounds and preserves neutral legacy rendering", async () => {
  const image = await fixture(),
    base = await render(image, defaultEdits());
  assert.deepEqual(
    await render(image, {
      ...defaultEdits(),
      ...Object.fromEntries(
        Object.entries(controls).map(([k, c]) => [k, c.default]),
      ),
    }),
    base,
  );
  for (const [key, c] of Object.entries(controls)) {
    const parent = {};
    if (key.startsWith("vignette") && key !== "vignette") parent.vignette = -70;
    if (key.startsWith("grain") && key !== "grain") parent.grain = 80;
    if (key.startsWith("sharpen") && key !== "sharpening")
      parent.sharpening = 90;
    if (key.startsWith("noise") && key !== "noiseReduction")
      parent.noiseReduction = 90;
    if (key === "colorNoiseSmoothness") parent.colorNoiseReduction = 90;
    if (key.includes("GradeHue")) parent[key.replace("Hue", "Saturation")] = 90;
    const before = await render(image, { ...defaultEdits(), ...parent });
    const v = key.includes("GradeHue")
      ? 180
      : c.default === c.max
        ? c.min
        : c.max;
    const after = await render(image, {
      ...defaultEdits(),
      ...parent,
      [key]: v,
    });
    assert.ok(!after.equals(before), key + " should affect pixels");
    const safe = validateEdits({ [key]: c.max + 1000 });
    assert.equal(safe[key], c.max);
    assert.throws(() => validateEdits({ [key]: NaN }), /Invalid/);
  }
});
test("advanced adjustments persist, export through the same renderer, and leave the source untouched", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "openshoot-advanced-"));
  try {
    const original = await fixture(),
      source = path.join(root, "photo.png");
    await fs.writeFile(source, original);
    const lib = await new Library(path.join(root, "db")).init(),
      album = await lib.create("Advanced test", "Other");
    await lib.import(album.id, [source]);
    const photo = album.photos[0],
      edits = {
        ...defaultEdits(),
        highlights: -45,
        shadows: 50,
        tint: 15,
        vibrance: 40,
        blueSaturation: -25,
        shadowGradeHue: 210,
        shadowGradeSaturation: 30,
        texture: 25,
        vignette: -25,
        sharpening: 40,
      };
    await lib.patch(album.id, [photo.id], { edits });
    const reopened = await new Library(path.join(root, "db")).init();
    assert.deepEqual(reopened.album(album.id).photos[0].edits, edits);
    const result = await lib.export(
      album.id,
      { scope: "all", format: "jpeg", maxSize: "" },
      root,
      () => {},
    );
    const files = await fs.readdir(result.folder),
      jpeg = files.find((f) => f.endsWith(".jpg"));
    assert.ok(jpeg);
    assert.deepEqual(
      await fs.readFile(path.join(result.folder, jpeg)),
      await render(source, edits, undefined),
    );
    assert.deepEqual(await fs.readFile(source), original);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
