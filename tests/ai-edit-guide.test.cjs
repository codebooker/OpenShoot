const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  sharp = require("sharp");
const {
  imageCalibration,
  CONTROL_GUIDE,
} = require("../electron/ai-edit-guide.cjs");
const { render, defaultEdits } = require("../electron/analysis.cjs");
test("AI exposure calibration agrees with rendered bright/dark pixel patches", async () => {
  const image = await sharp({
    create: { width: 200, height: 100, channels: 3, background: "#505050" },
  })
    .composite([
      {
        input: await sharp({
          create: {
            width: 100,
            height: 100,
            channels: 3,
            background: "#c8c8c8",
          },
        })
          .png()
          .toBuffer(),
        left: 100,
        top: 0,
      },
    ])
    .png()
    .toBuffer();
  const guide = await imageCalibration(image);
  assert.equal(guide.luminance.p10, 80);
  assert.equal(guide.luminance.p90, 200);
  assert.equal(guide.existingNearClippedChannelPercent, 0);
  assert.equal(guide.exposureOnlyEstimates[0].nearClippedChannelPercent, 0);
  assert.equal(guide.exposureOnlyEstimates[1].nearClippedChannelPercent, 50);
  for (const [exposure, expected] of [
    [0.25, 238],
    [0.5, 255],
  ]) {
    const { data, info } = await sharp(
      await render(image, { ...defaultEdits(), exposure }),
    )
      .raw()
      .toBuffer({ resolveWithObject: true });
    assert.ok(Math.abs(data[(50 * info.width + 150) * 3] - expected) <= 2);
  }
});
test("control guide describes actual contrast, black lift, color and clipping semantics", () => {
  assert.match(CONTROL_GUIDE, /128\*\(1-c\)/);
  assert.match(CONTROL_GUIDE, /positive blacks lifts blacks/);
  assert.match(CONTROL_GUIDE, /not Kelvin/);
  assert.match(CONTROL_GUIDE, /cannot recover channel detail/);
  assert.match(CONTROL_GUIDE, /not Lightroom/);
});
