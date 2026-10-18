const path = require("node:path");
const { promisify } = require("node:util");
const execFile = promisify(require("node:child_process").execFile);
const exifr = require("exifr");
const pending = new Map();
async function readMetadata(photo) {
  let info = { ...photo.exif };
  if (!Number.isFinite(Number(info.ISO)) || Number(info.ISO) <= 0) {
    try {
      info = {
        ...(await exifr.parse(photo.path, {
          pick: [
            "Make",
            "Model",
            "LensModel",
            "ISO",
            "FNumber",
            "ExposureTime",
            "FocalLength",
          ],
        })),
        ...info,
      };
    } catch {}
    if (
      (!Number.isFinite(Number(info.ISO)) || Number(info.ISO) <= 0) &&
      process.platform === "darwin"
    ) {
      try {
        const helper =
          process.resourcesPath && !process.defaultApp
            ? path.join(process.resourcesPath, "openshoot-metadata")
            : path.join(__dirname, "../native/openshoot-metadata");
        const { stdout } = await execFile(helper, [photo.path], {
          timeout: 15000,
          maxBuffer: 65536,
        });
        info = { ...info, ...JSON.parse(stdout) };
      } catch {}
    }
  }
  const out = {};
  for (const key of ["ISO", "FNumber", "ExposureTime", "FocalLength"]) {
    const value = Number(info[key]);
    if (Number.isFinite(value) && value > 0) out[key] = value;
  }
  for (const key of ["Make", "Model", "LensModel"])
    if (typeof info[key] === "string") out[key] = info[key].slice(0, 120);
  return out;
}
async function photoMetadata(photo) {
  const key = JSON.stringify([photo.path, photo.size, photo.exif]);
  if (!pending.has(key)) {
    if (pending.size >= 2000) pending.clear();
    pending.set(key, readMetadata(photo));
  }
  return pending.get(key);
}
module.exports = { photoMetadata };
