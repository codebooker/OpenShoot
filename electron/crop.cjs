const cropModes = [
  "free",
  "original",
  "1:1",
  "4:5",
  "3:2",
  "5:7",
  "16:9",
  "9:16",
  "4:5-portrait",
];
function targetRatio(mode, sourceAspect, rotation = 0) {
  if (mode === "original") return sourceAspect;
  const turned = rotation % 180 !== 0,
    aspect = turned ? 1 / sourceAspect : sourceAspect;
  let ratio = {
    "1:1": 1,
    "4:5": 4 / 5,
    "3:2": 3 / 2,
    "5:7": 5 / 7,
    "16:9": 16 / 9,
    "9:16": 9 / 16,
    "4:5-portrait": 4 / 5,
  }[mode];
  if (!ratio) return null;
  if (["4:5", "3:2", "5:7"].includes(mode))
    ratio =
      aspect >= 1 ? Math.max(ratio, 1 / ratio) : Math.min(ratio, 1 / ratio);
  return turned ? 1 / ratio : ratio;
}
// Expand around the AI's proposed center, fitting within the full source frame.
function ratioCrop(c, mode, sourceAspect = 1, rotation = 0) {
  const target = targetRatio(mode, sourceAspect, rotation);
  if (!target) return { ...c };
  const ratio = target / sourceAspect;
  if (Math.abs(c.width / c.height - ratio) < 1e-10) return { ...c };
  let width = Math.max(c.width, c.height * ratio),
    height = width / ratio;
  const scale = Math.min(1, 1 / width, 1 / height);
  width *= scale;
  height *= scale;
  return {
    x: Math.max(0, Math.min(1 - width, c.x + c.width / 2 - width / 2)),
    y: Math.max(0, Math.min(1 - height, c.y + c.height / 2 - height / 2)),
    width,
    height,
  };
}
const originalRatioCrop = (c) => ratioCrop(c, "original");
module.exports = { originalRatioCrop, ratioCrop, targetRatio, cropModes };
