// Original procedural illustrations, intentionally labeled as a demo album.
const fs = require("node:fs/promises"),
  path = require("node:path"),
  sharp = require("sharp");
async function demo(lib, progress) {
  const folder = path.join(lib.root, "demo");
  await fs.mkdir(folder, { recursive: true });
  const files = [];
  const palettes = [
    ["#9dbac1", "#ead0ad", "#6c8f8d", "#2c555c"],
    ["#b9c7ae", "#e4dfc7", "#8b9e65", "#344e40"],
    ["#beabb0", "#f4c7a6", "#9a7c7b", "#4c535d"],
    ["#5e879c", "#b8cfca", "#608a92", "#294958"],
  ];
  for (let i = 0; i < 16; i++) {
    const group = Math.floor(i / 4),
      [sky, sun, hill, front] = palettes[group],
      shift = (i % 4) * 9;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1100"><defs><linearGradient id="sky" x2="0" y2="1"><stop stop-color="${sky}"/><stop offset="1" stop-color="${sun}"/></linearGradient><filter id="grain"><feTurbulence baseFrequency=".5" numOctaves="3" stitchTiles="stitch"/><feColorMatrix type="saturate" values="0"/><feComponentTransfer><feFuncA type="linear" slope=".07"/></feComponentTransfer><feBlend in="SourceGraphic" mode="soft-light"/></filter></defs><g filter="url(#grain)"><path fill="url(#sky)" d="M0 0h1600v1100H0z"/><circle fill="${sun}" cx="${1100 + shift}" cy="300" r="100"/><path fill="${hill}" d="M0 760 400 330 780 720 1080 470 1600 790v310H0z"/><path fill="${front}" d="M0 870Q400 650 800 870T1600 750v350H0z"/><path fill="${sun}" opacity=".5" d="M650 1100q120-150 340-270-80 130-140 270"/><g fill="${front}">${Array.from({ length: 14 }, (_, n) => `<path d="M${n * 127} ${790 + (n % 3) * 38}l-25 70h50z"/>`).join("")}</g></g></svg>`;
    const file = path.join(
      folder,
      `Landscape_${String(i + 1).padStart(3, "0")}.jpg`,
    );
    let p = sharp(Buffer.from(svg));
    if (i % 4 === 2) p = p.blur(5);
    if (i % 4 === 3) p = p.modulate({ brightness: 0.4 });
    await p.jpeg({ quality: 90 }).toFile(file);
    files.push(file);
  }
  const album = await lib.create(
    "The quiet outdoors · Demo",
    "Landscape & travel",
  );
  album.demo = true;
  return (await lib.import(album.id, files, progress)).album;
}
module.exports = { demo };
