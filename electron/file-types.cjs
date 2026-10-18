// Extension recognition is separate from decoder/camera compatibility.
// Sources and review date are documented in docs/file-formats.md.
const rawFormats = [
  ["Canon", ["crw", "cr2", "cr3"]],
  ["Nikon", ["nef", "nrw"]],
  ["Sony", ["arw", "srf", "sr2"]],
  ["Fujifilm", ["raf"]],
  ["Olympus / OM System", ["orf"]],
  ["Panasonic / Leica (legacy)", ["rw2", "raw"]],
  ["Leica", ["rwl"]],
  ["Pentax", ["pef"]],
  ["Samsung", ["srw"]],
  ["Hasselblad", ["3fr", "fff"]],
  ["Phase One", ["iiq"]],
  ["Leaf / Mamiya", ["mos", "mef", "mfw"]],
  ["Minolta", ["mrw"]],
  ["Kodak", ["dcr", "kdc"]],
  ["Epson", ["erf"]],
  ["GoPro", ["gpr"]],
  ["Sigma", ["x3f"]],
  ["DNG · multi-brand / Apple ProRAW", ["dng"]],
];
const imageFormats = [
  ["JPEG", ["jpg", "jpeg", "jpe", "jfif"]],
  ["PNG", ["png"]],
  ["TIFF", ["tif", "tiff"]],
  ["WebP", ["webp"]],
  ["HEIF / HEIC", ["heif", "heic", "hif"]],
  ["AVIF", ["avif"]],
  ["BMP", ["bmp"]],
];
const RAW_EXTENSIONS = rawFormats.flatMap(([, exts]) =>
  exts.map((e) => "." + e),
);
const JPEG_EXTENSIONS = [".jpg", ".jpeg", ".jpe", ".jfif"];
const FILE_TYPES = Object.fromEntries(
  [...rawFormats, ...imageFormats].flatMap(([label, exts]) =>
    exts.map((e) => [
      "." + e,
      { label, raw: RAW_EXTENSIONS.includes("." + e) },
    ]),
  ),
);
const supported = new Set(Object.keys(FILE_TYPES));
function filterFiles(files, extensions) {
  if (!Array.isArray(extensions) || extensions.some((e) => !supported.has(e)))
    throw Error("Choose supported file types");
  const allowed = new Set(extensions);
  return files.filter((file) =>
    allowed.has(require("node:path").extname(file).toLowerCase()),
  );
}
module.exports = {
  RAW_EXTENSIONS,
  JPEG_EXTENSIONS,
  FILE_TYPES,
  supported,
  filterFiles,
};
