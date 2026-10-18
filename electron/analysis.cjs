// Independent image measurements. No original application code or models are used.
const sharp = require("sharp");
const { advanced } = require("./advanced.cjs");
function hamming(a, b) {
  let n = BigInt("0x" + a) ^ BigInt("0x" + b),
    c = 0;
  while (n) {
    c++;
    n &= n - 1n;
  }
  return c;
}
async function measure(input) {
  const { data, info } = await sharp(input)
    .rotate()
    .resize(256, 256, { fit: "inside" })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const w = info.width,
    h = info.height;
  let sum = 0,
    sq = 0,
    mean = 0,
    dark = 0,
    bright = 0,
    n = 0;
  for (let i = 0; i < data.length; i++) {
    mean += data[i];
    dark += data[i] < 10 ? 1 : 0;
    bright += data[i] > 245 ? 1 : 0;
  }
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x,
        v = 4 * data[i] - data[i - 1] - data[i + 1] - data[i - w] - data[i + w];
      sum += v;
      sq += v * v;
      n++;
    }
  const small = await sharp(input)
    .rotate()
    .resize(9, 8, { fit: "fill" })
    .greyscale()
    .raw()
    .toBuffer();
  let hash = 0n;
  for (let y = 0; y < 8; y++)
    for (let x = 0; x < 8; x++)
      hash = (hash << 1n) | (small[y * 9 + x] > small[y * 9 + x + 1] ? 1n : 0n);
  const rgb = await sharp(input)
    .rotate()
    .resize(1, 1, { fit: "fill" })
    .toColourspace("srgb")
    .removeAlpha()
    .raw()
    .toBuffer();
  return {
    version: 2,
    colour: [...rgb],
    sharpness: Math.round(Math.max(0, sq / n - (sum / n) ** 2) * 100) / 100,
    brightness: Math.round(mean / data.length),
    dark: dark / data.length,
    bright: bright / data.length,
    hash: hash.toString(16).padStart(16, "0"),
  };
}
function classify(photos, settings = {}) {
  const threshold = { low: 25, standard: 65, high: 140 }[settings.blur] ?? 65;
  const distance =
    { strict: 3, standard: 6, loose: 10 }[settings.similarity] ?? 6;
  const sorted = [...photos].sort(
    (a, b) => b.analysis.sharpness - a.analysis.sharpness,
  );
  const groups = [];
  const result = new Map();
  for (const p of sorted) {
    const a = p.analysis;
    // Group against a representative to prevent transitive chains joining unrelated photos.
    let g =
      settings.duplicates === false
        ? null
        : groups.find(
            (g) =>
              hamming(a.hash, g.rep.analysis.hash) <= distance &&
              Math.abs(a.brightness - g.rep.analysis.brightness) < 32 &&
              Math.abs(p.width / p.height - g.rep.width / g.rep.height) <
                0.12 &&
              (!a.colour ||
                !g.rep.analysis.colour ||
                Math.max(
                  ...a.colour.map((c, i) =>
                    Math.abs(c - g.rep.analysis.colour[i]),
                  ),
                ) <
                  ({ strict: 18, standard: 28, loose: 40 }[
                    settings.similarity
                  ] ?? 28)),
          );
    if (!g) {
      g = { rep: p, id: p.id, photos: [] };
      groups.push(g);
    }
    g.photos.push(p);
    const category =
      g.rep.id !== p.id
        ? "Duplicates"
        : a.sharpness < threshold && settings.detectBlur !== false
          ? "Blurred"
          : "Selected";
    const exposure =
      a.dark > 0.6 ? "Underexposed" : a.bright > 0.6 ? "Overexposed" : null;
    const quality = Math.min(
      100,
      Math.round(
        Math.log2(a.sharpness + 1) * 10 +
          (1 - Math.abs(a.brightness - 128) / 128) * 12,
      ),
    );
    result.set(p.id, {
      ...p,
      category,
      group: g.id,
      rating: category === "Selected" ? 4 : category === "Duplicates" ? 2 : 1,
      label:
        category === "Selected"
          ? "Green"
          : category === "Duplicates"
            ? "Yellow"
            : "Red",
      quality,
      exposure,
    });
  }
  if (settings.mode === "target") {
    const target = Math.max(
      1,
      Math.min(photos.length, Math.floor(Number(settings.target) || 1)),
    );
    const rank = [...result.values()].sort(
      (a, b) =>
        (a.category === "Duplicates") - (b.category === "Duplicates") ||
        b.quality - a.quality ||
        b.analysis.sharpness - a.analysis.sharpness,
    );
    rank.forEach((p, i) => {
      p.category =
        i < target
          ? "Selected"
          : p.category === "Selected"
            ? "Maybe"
            : p.category;
      p.rating = i < target ? 4 : p.category === "Maybe" ? 3 : p.rating;
      p.label =
        i < target ? "Green" : p.category === "Maybe" ? "Blue" : p.label;
    });
  }
  return photos.map((p) => result.get(p.id));
}
function xmlEscape(s) {
  return String(s).replace(
    /[<>&"']/g,
    (c) =>
      ({
        "<": "&lt;",
        ">": "&gt;",
        "&": "&amp;",
        '"': "&quot;",
        "'": "&apos;",
      })[c],
  );
}
function xmp(photo) {
  return `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>\n<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about="" xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmp:Rating="${photo.rating || 0}" xmp:Label="${xmlEscape(photo.label || "")}"><dc:subject><rdf:Bag><rdf:li>OpenShoot</rdf:li><rdf:li>${xmlEscape(photo.category)}</rdf:li></rdf:Bag></dc:subject></rdf:Description></rdf:RDF></x:xmpmeta>\n<?xpacket end="w"?>`;
}
const defaultEdits = () => ({
  exposure: 0,
  contrast: 0,
  saturation: 0,
  temperature: 0,
  rotation: 0,
  monochrome: false,
  crop: "original",
});
async function render(input, edits = {}, maxSize) {
  let p = sharp(input).rotate();
  const e = { ...defaultEdits(), ...edits };
  if (e.cropRect || e.crop !== "original") {
    const meta = await sharp(input).metadata();
    const swapped = [5, 6, 7, 8].includes(meta.orientation);
    let w = swapped ? meta.height : meta.width,
      h = swapped ? meta.width : meta.height;
    const ratio = { "1:1": 1, "4:5": 4 / 5, "3:2": 3 / 2, "16:9": 16 / 9 }[
      e.crop
    ];
    if (e.cropRect) {
      const c = e.cropRatio
        ? require("./crop.cjs").ratioCrop(
            e.cropRect,
            e.cropRatio,
            w / h,
            e.rotation,
          )
        : e.cropRect;
      const left = Math.min(w - 1, Math.round(c.x * w)),
        top = Math.min(h - 1, Math.round(c.y * h));
      p = p.extract({
        left,
        top,
        width: Math.max(1, Math.min(w - left, Math.round(c.width * w))),
        height: Math.max(1, Math.min(h - top, Math.round(c.height * h))),
      });
    } else if (ratio) {
      const cw = Math.min(w, Math.floor(h * ratio)),
        ch = Math.min(h, Math.floor(w / ratio));
      p = p.extract({
        left: Math.floor((w - cw) / 2),
        top: Math.floor((h - ch) / 2),
        width: cw,
        height: ch,
      });
    }
  }
  if (e.rotation) p = p.rotate(e.rotation);
  if (maxSize)
    p = p.resize(maxSize, maxSize, { fit: "inside", withoutEnlargement: true });
  const c = 1 + e.contrast / 100;
  p = p
    .linear(c * 2 ** e.exposure, 128 * (1 - c))
    .modulate({ saturation: Math.max(0, 1 + e.saturation / 100) });
  if (e.temperature)
    p = p.recomb([
      [1 + e.temperature / 500, 0, 0],
      [0, 1, 0],
      [0, 0, 1 - e.temperature / 500],
    ]);
  p = await advanced(p, e);
  if (e.monochrome) p = p.greyscale();
  return p.jpeg({ quality: 92 }).toBuffer();
}
module.exports = { measure, classify, hamming, xmp, render, defaultEdits };
