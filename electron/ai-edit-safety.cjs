const sharp = require("sharp");
const { render, defaultEdits } = require("./analysis.cjs");
const TONE = [
  ...Object.entries(require("./edit-controls.json"))
    .filter(
      ([key, control]) =>
        control.group === "Color mixer" ||
        (control.group === "Color grading" && !key.endsWith("Hue")),
    )
    .map(([key]) => key),
  "exposure",
  "contrast",
  "saturation",
  "temperature",
  "highlights",
  "shadows",
  "whites",
  "blacks",
  "tint",
  "vibrance",
  "texture",
  "clarity",
  "dehaze",
];
async function pixels(input, edits) {
  const buffer = await render(
    input,
    { ...edits, rotation: 0, cropRatio: undefined },
    600,
  );
  return sharp(buffer).removeAlpha().raw().toBuffer();
}
function addedClipping(before, after) {
  let added = 0;
  for (let i = 0; i < before.length; i += 3) {
    const old = Math.max(before[i], before[i + 1], before[i + 2]);
    const next = Math.max(after[i], after[i + 1], after[i + 2]);
    if (old < 250 && next >= 253) added++;
  }
  return added / (before.length / 3);
}
async function protectHighlights(input, result, mode) {
  if (mode === "crop") return result;
  const neutral = {
    ...defaultEdits(),
    rotation: result.edits.rotation,
    crop: result.edits.crop,
    cropRect: result.edits.cropRect,
    cropRatio: result.edits.cropRatio,
  };
  const before = await pixels(input, neutral);
  // Check the basic stage too: lowering Highlights afterward cannot restore
  // detail already clipped by the 8-bit exposure/contrast stage.
  for (const strength of [1, 0.75, 0.5, 0.25, 0]) {
    const edits = { ...result.edits };
    for (const key of TONE)
      if (Number.isFinite(edits[key])) edits[key] *= strength;
    const basic = {
      ...neutral,
      exposure: edits.exposure,
      contrast: edits.contrast,
      saturation: edits.saturation,
      temperature: edits.temperature,
    };
    const clipping = Math.max(
      addedClipping(before, await pixels(input, basic)),
      addedClipping(before, await pixels(input, edits)),
    );
    if (clipping <= 0.005 || strength === 0)
      return {
        ...result,
        edits,
        ...(strength < 1
          ? {
              reason: `${result.reason} Highlight protection reduced the suggested light/color adjustment to ${Math.round(strength * 100)}% to avoid introducing clipped highlights.`,
              highlightProtection: { strength, addedClipping: clipping },
            }
          : {}),
      };
  }
}
module.exports = { protectHighlights, addedClipping };
