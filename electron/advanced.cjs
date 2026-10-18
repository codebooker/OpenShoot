const sharp = require("sharp");
const controls = require("./edit-controls.json");
const defaults = () =>
  Object.fromEntries(Object.entries(controls).map(([k, v]) => [k, v.default]));
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
function hsl(r, g, b) {
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b),
    d = max - min,
    l = (max + min) / 2;
  let h = 0,
    s = 0;
  if (d) {
    s = d / (1 - Math.abs(2 * l - 1));
    h =
      (max === r
        ? ((g - b) / d + 6) % 6
        : max === g
          ? (b - r) / d + 2
          : (r - g) / d + 4) * 60;
  }
  return [h, s, l];
}
function rgb(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s,
    x = c * (1 - Math.abs(((h / 60) % 2) - 1)),
    m = l - c / 2;
  const a =
    h < 60
      ? [c, x, 0]
      : h < 120
        ? [x, c, 0]
        : h < 180
          ? [0, c, x]
          : h < 240
            ? [0, x, c]
            : h < 300
              ? [x, 0, c]
              : [c, 0, x];
  return a.map((v) => v + m);
}
const colors = [
    "red",
    "orange",
    "yellow",
    "green",
    "aqua",
    "blue",
    "purple",
    "magenta",
  ],
  centers = [0, 30, 60, 120, 180, 240, 270, 300];
function smooth(a, b, x) {
  const t = clamp((x - a) / (b - a));
  return t * t * (3 - 2 * t);
}
async function advanced(p, settings) {
  const e = { ...defaults(), ...settings };
  const active = Object.keys(controls).some(
    (k) => e[k] !== controls[k].default,
  );
  if (!active) return p;
  const {
    blacks,
    clarity,
    colorNoiseReduction,
    colorNoiseSmoothness,
    curveDarks,
    curveHighlights,
    curveLights,
    curveShadows,
    dehaze,
    grain,
    grainRoughness,
    grainSize,
    highlights,
    noiseContrast,
    noiseDetail,
    noiseReduction,
    shadows,
    sharpenDetail,
    sharpenMasking,
    sharpenRadius,
    sharpening,
    texture,
    tint,
    vibrance,
    vignette,
    vignetteFeather,
    vignetteMidpoint,
    vignetteRoundness,
    whites,
  } = e;
  const { data, info } = await p
    .removeAlpha()
    .toColourspace("srgb")
    .raw()
    .toBuffer({ resolveWithObject: true });
  const w = info.width,
    h = info.height,
    raw = { width: w, height: h, channels: 3 };
  const blur = async (radius) =>
    sharp(data, { raw }).blur(Math.max(0.3, radius)).raw().toBuffer();
  const spatial = !!(
    texture ||
    clarity ||
    sharpening ||
    noiseReduction ||
    colorNoiseReduction
  );
  const small = spatial
    ? await blur(Math.max(0.8, sharpenRadius * Math.sqrt(w / 1600)))
    : null;
  const large = clarity ? await blur(Math.max(1, w / 100)) : null;
  const noise =
    noiseReduction || colorNoiseReduction
      ? await blur(Math.max(0.8, w / 1000))
      : null;
  const mixer = colors
    .map((c, j) => ({
      center: centers[j],
      width: j === 1 ? 30 : 60,
      hue: e[c + "Hue"] * 0.3,
      sat: e[c + "Saturation"] / 100,
      lum: e[c + "Luminance"] / 400,
    }))
    .filter((c) => c.hue || c.sat || c.lum);
  const grades = ["shadow", "midtone", "highlight"].map((z) => {
    const col = rgb(e[z + "GradeHue"] % 360, 1, 0.5);
    return {
      r: col[0] - 0.5,
      g: col[1] - 0.5,
      b: col[2] - 0.5,
      sat: e[z + "GradeSaturation"] / 500,
      lum: e[z + "GradeLuminance"] * 0.0015,
    };
  });
  const out = Buffer.alloc(data.length),
    mix = colors.some(
      (c) => e[c + "Hue"] || e[c + "Saturation"] || e[c + "Luminance"],
    );
  const grading = ["shadow", "midtone", "highlight"].some(
    (z) => e[z + "GradeSaturation"] || e[z + "GradeLuminance"],
  );
  const curve = [0, 0.2, 0.4, 0.6, 0.8, 1],
    values = [
      0,
      0.2 + curveShadows / 600,
      0.4 + curveDarks / 600,
      0.6 + curveLights / 600,
      0.8 + curveHighlights / 600,
      1,
    ];
  const curveOn = curveShadows || curveDarks || curveLights || curveHighlights;
  const grainCell = Math.max(
    1,
    Math.round(Math.sqrt(w / 1600) * (0.5 + grainSize / 30)),
  );
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3;
      let r = data[i] / 255,
        g = data[i + 1] / 255,
        b = data[i + 2] / 255;
      const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      let target =
        l +
        (shadows / 100) * 0.28 * (1 - smooth(0.05, 0.65, l)) * (1 - l) +
        (highlights / 100) * 0.28 * smooth(0.35, 0.95, l) * l +
        (whites / 100) * 0.2 * smooth(0.6, 1, l) +
        (blacks / 100) * 0.18 * (1 - smooth(0, 0.4, l));
      if (curveOn) {
        let j = 0;
        while (j < 4 && target > curve[j + 1]) j++;
        const t = clamp((target - curve[j]) / 0.2);
        target = values[j] + (values[j + 1] - values[j]) * t;
      }
      if (dehaze)
        target = (target - 0.5) * (1 + dehaze / 180) + 0.5 - dehaze / 1000;
      const delta = target - l;
      r += delta;
      g += delta;
      b += delta;
      g *= 1 - tint / 400;
      r *= 1 + tint / 800;
      b *= 1 + tint / 800;
      r = clamp(r);
      g = clamp(g);
      b = clamp(b);
      if (mix || vibrance) {
        let [hue, sat, lum] = hsl(r, g, b),
          dh = 0,
          ds = 0,
          dl = 0;
        for (const channel of mixer) {
          const dist = Math.abs(((hue - channel.center + 540) % 360) - 180),
            weight = Math.max(0, 1 - dist / channel.width);
          dh += weight * channel.hue;
          ds += weight * channel.sat;
          dl += weight * channel.lum;
        }
        sat = clamp(sat * (1 + ds + (vibrance / 100) * (1 - sat)));
        [r, g, b] = rgb((hue + dh + 360) % 360, sat, clamp(lum + dl));
      }
      if (grading) {
        const weights = [
          1 - smooth(0.15, 0.55, l),
          1 - Math.abs(2 * l - 1),
          smooth(0.45, 0.85, l),
        ];
        for (let j = 0; j < 3; j++) {
          const grade = grades[j],
            amount = grade.sat * weights[j],
            light = grade.lum * weights[j];
          r += grade.r * amount + light;
          g += grade.g * amount + light;
          b += grade.b * amount + light;
        }
      }
      let a = [r, g, b];
      if (spatial) {
        const edge =
            Math.abs(data[i] - small[i]) +
            Math.abs(data[i + 1] - small[i + 1]) +
            Math.abs(data[i + 2] - small[i + 2]),
          protect = 1 - smooth(3, 25 + noiseDetail / 2, edge),
          sharpenMask = sharpenMasking
            ? smooth(sharpenMasking / 5, sharpenMasking / 5 + 15, edge)
            : 1;
        const nl = noise
          ? (0.2126 * noise[i] +
              0.7152 * noise[i + 1] +
              0.0722 * noise[i + 2]) /
            255
          : l;
        for (let c = 0; c < 3; c++) {
          if (noise) {
            const lumMix =
                (noiseReduction / 100) * protect * (1 - noiseContrast / 150),
              colorMix =
                (colorNoiseReduction / 100) *
                protect *
                (0.5 + colorNoiseSmoothness / 200);
            a[c] += (nl - l) * lumMix;
            const chroma = data[i + c] / 255 - l,
              blurChroma = noise[i + c] / 255 - nl;
            a[c] += (blurChroma - chroma) * colorMix;
          }
          const detail = (data[i + c] - small[i + c]) / 255;
          a[c] +=
            detail *
            ((texture / 100) * 1.2 +
              (sharpening / 100) * (0.5 + sharpenDetail / 50) * sharpenMask);
          if (large)
            a[c] +=
              ((((data[i + c] - large[i + c]) / 255) * clarity) / 100) * 0.8;
        }
      }
      if (vignette) {
        const nx = (x / w - 0.5) * 2,
          ny = (y / h - 0.5) * 2,
          round = vignetteRoundness / 100,
          dist =
            Math.sqrt(
              nx * nx * (1 + round * 0.5) + ny * ny * (1 - round * 0.5),
            ) / Math.SQRT2,
          start = (vignetteMidpoint / 100) * 0.85,
          edge = smooth(start, start + vignetteFeather / 100, dist);
        a = a.map((v) =>
          vignette < 0
            ? v * (1 + (vignette / 100) * 0.85 * edge)
            : v + (((1 - v) * vignette) / 100) * 0.7 * edge,
        );
      }
      if (grain) {
        const gx = Math.floor(x / grainCell),
          gy = Math.floor(y / grainCell);
        let seed = Math.imul(gx + 1, 374761393) ^ Math.imul(gy + 1, 668265263);
        seed = Math.imul(seed ^ (seed >>> 13), 1274126177);
        const n =
          ((((seed >>> 0) / 4294967295 - 0.5) * grain) / 100) *
          (0.08 + grainRoughness / 500);
        a = a.map((v) => v + n);
      }
      for (let c = 0; c < 3; c++) out[i + c] = Math.round(clamp(a[c]) * 255);
    }
  return sharp(out, { raw });
}
module.exports = { advanced, defaults, controls };
