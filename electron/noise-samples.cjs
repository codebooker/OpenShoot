const sharp = require("sharp"),
  path = require("node:path");
async function noiseSamples(lib, photo, prepared) {
  let source, label;
  if (prepared?.rawDenoiseKey && lib.denoiser) {
    source = await lib.denoiser.input(photo, { ...prepared, aiDenoise: 0 });
    label = "Undenoised native RAW rendering";
  } else {
    try {
      await sharp(photo.path).metadata();
      source = photo.path;
      label = "Original image";
    } catch {
      source = path.join(lib.cache, photo.id + ".jpg");
      label = "Camera preview (may already be resized or noise-reduced)";
    }
  }
  const meta = await sharp(source).metadata(),
    size = Math.min(512, meta.width, meta.height);
  const samples = [];
  for (const cy of [0.5, 0.7]) {
    const left = Math.max(0, Math.floor((meta.width - size) / 2)),
      top = Math.max(
        0,
        Math.min(meta.height - size, Math.floor(meta.height * cy - size / 2)),
      );
    samples.push({
      label: `${label}: ${size}×${size} source pixels, unscaled detail crop at center x=50%, y=${cy * 100}%. Samples may not represent every region.`,
      buffer: await sharp(source)
        .extract({ left, top, width: size, height: size })
        .jpeg({ quality: 95 })
        .toBuffer(),
    });
  }
  return samples;
}
module.exports = { noiseSamples };
