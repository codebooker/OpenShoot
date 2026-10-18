const { test } = require("node:test");
const assert = require("node:assert/strict");
const sharp = require("sharp");
const fs = require("node:fs/promises"),
  os = require("node:os"),
  path = require("node:path");
const { validate, suggest } = require("../electron/ai-edit.cjs");
const { defaultEdits, render } = require("../electron/analysis.cjs");
const response = {
  exposure: 0.3,
  contrast: 10,
  saturation: 5,
  temperature: 3,
  cropRect: { x: 0.5, y: 0, width: 0.5, height: 1 },
  reason: "Keep the subject on the right.",
  confidence: 0.8,
};
response.advanced = {
  ...Object.fromEntries(
    Object.entries(require("../electron/edit-controls.json"))
      .filter(
        ([key, c]) =>
          ["Light", "Color", "Color mixer", "Color grading"].includes(
            c.group,
          ) || ["texture", "clarity", "dehaze"].includes(key),
      )
      .map(([key, c]) => [key, c.default]),
  ),
  ...response.advanced,
};
response.denoiseAmount = 85;

test("AI editing validates controls and crop bounds, preserves geometry, and never saves suggestions", async () => {
  const base = {
    ...defaultEdits(),
    rotation: 90,
    monochrome: true,
    exposure: 3,
    contrast: 100,
    highlights: -100,
    shadows: 100,
    tint: 100,
    curveShadows: 100,
    grain: 100,
    redHue: 100,
    shadowGradeSaturation: 100,
  };
  assert.equal(
    validate(JSON.stringify(response), "crop", base).edits.exposure,
    3,
  );
  assert.equal(
    validate(JSON.stringify(response), "edit", base).edits.cropRect,
    undefined,
  );
  assert.equal(
    validate(JSON.stringify(response), "both", base).edits.rotation,
    90,
  );
  for (const bad of [
    { ...response, exposure: 4 },
    { ...response, cropRect: { x: 0.9, y: 0, width: 0.5, height: 1 } },
    { ...response, confidence: "high" },
    { ...response, command: "run" },
  ])
    assert.throws(() => validate(JSON.stringify(bad), "both", base));
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "openshoot-edit-"));
  try {
    await sharp({
      create: { width: 40, height: 30, channels: 3, background: "red" },
    })
      .jpeg()
      .toFile(path.join(root, "p.jpg"));
    const photo = { id: "p", edits: base, rating: 4 },
      lib = {
        busy: false,
        cache: root,
        album: () => ({ photos: [photo] }),
        ensurePreview: async () => {},
      };
    const before = JSON.stringify(photo);
    let calls = 0;
    const auth = {
      models: async () => [{ id: "test" }],
      respond: async (body) => {
        const content = body.input[0].content;
        assert.equal(
          content.find((c) => c.type === "input_image").image_url,
          "data:image/jpeg;base64," +
            (await fs.readFile(path.join(root, "p.jpg"))).toString("base64"),
        );
        assert.match(content[0].text, /Start fresh/);
        assert.ok(!content[0].text.includes("Current settings"));
        assert.ok(!content[0].text.includes("highlights"));
        calls++;
        return JSON.stringify(response);
      },
    };
    const r = await suggest(lib, auth, "a", "p", "test", "both");
    assert.equal(r.edits.exposure, 0.3);
    assert.equal(r.edits.monochrome, false);
    const expectedFresh = {
      ...defaultEdits(),
      rotation: 90,
      exposure: response.exposure,
      contrast: response.contrast,
      saturation: response.saturation,
      temperature: response.temperature,
      cropRect: response.cropRect,
    };
    assert.ok(
      (await render(path.join(root, "p.jpg"), r.edits)).equals(
        await render(path.join(root, "p.jpg"), expectedFresh),
      ),
      "AI result renders from a neutral baseline despite extreme saved adjustments",
    );
    for (const key of [
      "highlights",
      "shadows",
      "tint",
      "curveShadows",
      "grain",
      "redHue",
      "shadowGradeSaturation",
    ])
      assert.equal(r.edits[key] ?? 0, 0, key + " must return to neutral");
    const cropOnly = validate(JSON.stringify(response), "crop", base).edits;
    assert.equal(cropOnly.highlights, -100);
    assert.equal(cropOnly.monochrome, true);
    const framing = {
      ...base,
      crop: "4:5",
      cropRect: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 },
    };
    const lightOnly = validate(JSON.stringify(response), "edit", framing).edits;
    assert.deepEqual(lightOnly.cropRect, framing.cropRect);
    assert.equal(lightOnly.crop, "4:5");
    assert.equal(lightOnly.highlights, 0);
    assert.equal(JSON.stringify(photo), before);
    assert.equal(calls, 1);
    assert.equal(lib.busy, false);
    auth.respond = async () => {
      photo.edits = { ...base, exposure: 1 };
      return JSON.stringify(response);
    };
    await assert.rejects(
      suggest(lib, auth, "a", "p", "test", "both"),
      /changed/,
    );
    assert.equal(lib.busy, false);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
test("custom off-center crop extracts correct subject and preserves dimensions through rotation", async () => {
  const pixels = Buffer.alloc(100 * 60 * 3);
  for (let i = 0; i < 100 * 60; i++)
    pixels[i * 3 + (i % 100 < 50 ? 0 : 2)] = 255;
  const input = await sharp(pixels, {
    raw: { width: 100, height: 60, channels: 3 },
  })
    .png()
    .toBuffer();
  const edits = { ...defaultEdits(), cropRect: response.cropRect };
  const cropped = await render(input, edits);
  const stats = await sharp(cropped).stats();
  assert.ok(stats.channels[2].mean > 240);
  assert.ok(stats.channels[0].mean < 10);
  const meta = await sharp(
    await render(input, { ...edits, rotation: 90 }),
  ).metadata();
  assert.equal(meta.width, 60);
  assert.equal(meta.height, 50);
});

test("original-ratio reframe enforces proportions, preserves the proposed subject area and keeps off-center placement", async () => {
  const { originalRatioCrop } = require("../electron/crop.cjs");
  const c = { x: 0.55, y: 0.1, width: 0.3, height: 0.6 },
    locked = originalRatioCrop(c);
  assert.equal(locked.width, locked.height);
  assert.ok(locked.x > 0);
  assert.ok(locked.x <= c.x);
  assert.ok(locked.x + locked.width >= c.x + c.width - 1e-8);
  assert.ok(locked.y <= c.y + 1e-8);
  assert.ok(locked.y + locked.height >= c.y + c.height - 1e-8);
  const text = JSON.stringify({ ...response, cropRect: c });
  const edits = validate(
    text,
    "crop",
    { ...defaultEdits(), exposure: 1.5 },
    "original",
  ).edits;
  assert.equal(edits.cropRatio, "original");
  assert.deepEqual(edits.cropRect, locked);
  assert.equal(edits.exposure, 1.5);
  const free = validate(text, "crop", edits, "free").edits;
  assert.equal(free.cropRatio, undefined);
  assert.deepEqual(free.cropRect, c);
  const lightOnly = validate(text, "edit", edits).edits;
  assert.equal(lightOnly.cropRatio, "original");
  assert.deepEqual(lightOnly.cropRect, locked);
  for (const [width, height] of [
    [600, 400],
    [400, 600],
    [500, 500],
  ]) {
    const input = await sharp({
      create: { width, height, channels: 3, background: "orange" },
    })
      .png()
      .toBuffer();
    for (const rotation of [0, 90]) {
      const meta = await sharp(
        await render(input, { ...edits, rotation }),
      ).metadata();
      const ratio = rotation ? height / width : width / height;
      assert.ok(
        Math.abs(meta.width - meta.height * ratio) <= 1,
        "crop preserves source proportions within pixel rounding",
      );
      assert.ok(
        meta.width < (rotation ? height : width),
        "crop tightens framing",
      );
    }
  }
});

test("all fixed AI crop sizes render the selected proportions for portrait, landscape and rotated photos", async () => {
  const { ratioCrop, targetRatio } = require("../electron/crop.cjs");
  const { validateEdits } = require("../electron/library.cjs");
  const proposed = { x: 0.6, y: 0.05, width: 0.35, height: 0.7 };
  for (const mode of ["1:1", "4:5", "3:2", "5:7", "16:9"])
    for (const [width, height] of [
      [600, 400],
      [400, 600],
    ])
      for (const rotation of [0, 90]) {
        const input = await sharp({
          create: { width, height, channels: 3, background: "#778899" },
        })
          .png()
          .toBuffer();
        const result = validate(
          JSON.stringify({ ...response, cropRect: proposed }),
          "crop",
          { ...defaultEdits(), rotation },
          mode,
          width / height,
        ).edits;
        assert.equal(result.cropRatio, mode);
        assert.deepEqual(validateEdits(result), result);
        const c = result.cropRect;
        assert.ok(
          c.x >= 0 &&
            c.y >= 0 &&
            c.x + c.width <= 1.000001 &&
            c.y + c.height <= 1.000001,
        );
        const out = await sharp(await render(input, result)).metadata();
        const beforeRotation = targetRatio(mode, width / height, rotation),
          expected = rotation ? 1 / beforeRotation : beforeRotation;
        assert.ok(
          Math.abs(out.width - out.height * expected) <= 2,
          `${mode} ${width}x${height} rotated ${rotation}: ${out.width}x${out.height}`,
        );
        // Enforcement also applies to a saved ratio whose proposed rectangle is off-ratio.
        const enforced = ratioCrop(proposed, mode, width / height, rotation);
        assert.ok(
          Math.abs(
            ((enforced.width / enforced.height) * width) / height -
              beforeRotation,
          ) < 1e-9,
        );
      }
});
