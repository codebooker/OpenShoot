const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  sharp = require("sharp"),
  fs = require("node:fs/promises"),
  os = require("node:os"),
  path = require("node:path");
const { photoMetadata } = require("../electron/photo-metadata.cjs");
const { noiseSamples } = require("../electron/noise-samples.cjs");
test("capture metadata includes ISO and exposure without inventing missing settings", async () => {
  assert.deepEqual(
    await photoMetadata({
      path: "/not-real",
      exif: {
        ISO: 6400,
        ExposureTime: 1 / 1000,
        FNumber: 2.8,
        Make: "Canon",
        Model: "test",
      },
    }),
    {
      ISO: 6400,
      FNumber: 2.8,
      ExposureTime: 0.001,
      Make: "Canon",
      Model: "test",
    },
  );
  assert.deepEqual(
    await photoMetadata({ path: "/not-real-missing", exif: {} }),
    {},
  );
});
test("noise samples use undenoised RAW input and 512px crops without resizing", async () => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "openshoot-noise-sample-"),
  );
  try {
    const source = path.join(root, "plain.png");
    await sharp({
      create: { width: 1200, height: 1000, channels: 3, background: "#807060" },
    })
      .png()
      .toFile(source);
    let amount;
    const lib = {
      denoiser: {
        input: async (p, e, max) => {
          amount = e.aiDenoise;
          assert.equal(max, undefined);
          return source;
        },
      },
    };
    const samples = await noiseSamples(
      lib,
      { id: "p" },
      { rawDenoiseKey: "x", aiDenoise: 85 },
    );
    assert.equal(amount, 0);
    assert.equal(samples.length, 2);
    for (const sample of samples) {
      const m = await sharp(sample.buffer).metadata();
      assert.equal(m.width, 512);
      assert.equal(m.height, 512);
      assert.match(sample.label, /unscaled detail/);
    }
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
