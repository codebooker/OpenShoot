// Build a local macOS bundle. Clone-on-write avoids duplicating Electron on APFS.
import fs from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
if (process.platform !== "darwin")
  throw Error("This local packaging script currently targets macOS.");
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url))),
  require = createRequire(import.meta.url),
  electron = require("electron"),
  base = path.resolve(electron, "../../..");
const release = path.join(root, "release");
await fs.mkdir(release, { recursive: true });
const stage = await fs.mkdtemp(path.join(release, ".stage-"));
const app = path.join(stage, "OpenShoot.app");
await fs.cp(base, app, {
  recursive: true,
  verbatimSymlinks: true,
  mode: constants.COPYFILE_FICLONE,
});
const contents = path.join(app, "Contents"),
  resources = path.join(contents, "Resources"),
  target = path.join(resources, "app");
await fs.mkdir(target, { recursive: true });
for (const file of ["dist", "electron"])
  await fs.cp(path.join(root, file), path.join(target, file), {
    recursive: true,
    mode: constants.COPYFILE_FICLONE,
  });
const rawWorker = path.join(resources, "openshoot-raw");
await fs.copyFile(path.join(root, "native/openshoot-raw"), rawWorker);
await fs.chmod(rawWorker, 0o755);
const metadataWorker = path.join(resources, "openshoot-metadata");
await fs.copyFile(path.join(root, "native/openshoot-metadata"), metadataWorker);
await fs.chmod(metadataWorker, 0o755);
execFileSync("/usr/bin/codesign", ["--force", "--sign", "-", metadataWorker], {
  stdio: "inherit",
});
execFileSync("/usr/bin/codesign", ["--force", "--sign", "-", rawWorker], {
  stdio: "inherit",
});
await fs.mkdir(path.join(resources, "licenses"), { recursive: true });
await fs.cp(
  path.join(root, "native/licenses"),
  path.join(resources, "licenses/rust"),
  { recursive: true },
);
for (const name of ["LICENSE-MIT", "LICENSE-APACHE", "NOTICE"]) {
  try {
    await fs.copyFile(
      path.join(root, "third_party/lightcraft", name),
      path.join(resources, "licenses", "LightCraft-" + name),
    );
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
}
await fs.copyFile(
  path.join(root, "third_party/lightcraft/assets/fonts/OFL-Inter.txt"),
  path.join(resources, "licenses/OFL-Inter.txt"),
);
const packageData = JSON.parse(
  await fs.readFile(path.join(root, "package.json"), "utf8"),
);
await fs.writeFile(
  path.join(target, "package.json"),
  JSON.stringify({
    name: "openshoot",
    productName: "OpenShoot",
    version: packageData.version,
    description: packageData.description,
    main: "electron/main.cjs",
  }),
);
const visited = new Set();
async function dependency(name, from = root) {
  let source;
  try {
    const resolved = require.resolve(name + "/package.json", { paths: [from] });
    source = path.dirname(resolved);
  } catch {
    const probe = path.join(root, "node_modules", name);
    try {
      await fs.access(path.join(probe, "package.json"));
      source = probe;
    } catch {
      return;
    }
  }
  const dest = path.join(target, "node_modules", name);
  if (visited.has(name)) return;
  visited.add(name);
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.cp(source, dest, {
    recursive: true,
    verbatimSymlinks: true,
    mode: constants.COPYFILE_FICLONE,
  });
  const p = JSON.parse(
    await fs.readFile(path.join(source, "package.json"), "utf8"),
  );
  for (const d of Object.keys({ ...p.dependencies, ...p.optionalDependencies }))
    await dependency(d, source);
}
for (const name of ["sharp", "exifr", "jose"]) await dependency(name);
const plist = path.join(contents, "Info.plist");
for (const [key, value] of Object.entries({
  CFBundleName: "OpenShoot",
  CFBundleDisplayName: "OpenShoot",
  CFBundleIdentifier: "org.openshoot.desktop",
  CFBundleExecutable: "OpenShoot",
  CFBundleShortVersionString: packageData.version,
  CFBundleVersion: packageData.version,
  LSMinimumSystemVersion: "13.0",
  LSApplicationCategoryType: "public.app-category.photography",
}))
  execFileSync("/usr/bin/plutil", ["-replace", key, "-string", value, plist]);
await fs.rename(
  path.join(contents, "MacOS", "Electron"),
  path.join(contents, "MacOS", "OpenShoot"),
);
await fs.rm(path.join(resources, "default_app.asar"), { force: true });
// User-supplied OpenShoot artwork; retain its original colors and background.
const sharp = require("sharp"),
  iconset = path.join(stage, "OpenShoot.iconset"),
  iconSource = path.join(root, "public", "openshoot-icon.png");
await fs.mkdir(iconset);
for (const n of [16, 32, 128, 256, 512]) {
  await sharp(iconSource)
    .resize(n, n)
    .png()
    .toFile(path.join(iconset, `icon_${n}x${n}.png`));
  await sharp(iconSource)
    .resize(n * 2, n * 2)
    .png()
    .toFile(path.join(iconset, `icon_${n}x${n}@2x.png`));
}
execFileSync("/usr/bin/iconutil", [
  "-c",
  "icns",
  iconset,
  "-o",
  path.join(resources, "openshoot.icns"),
]);
execFileSync("/usr/bin/plutil", [
  "-replace",
  "CFBundleIconFile",
  "-string",
  "openshoot.icns",
  plist,
]);
execFileSync("/usr/bin/codesign", ["--force", "--deep", "--sign", "-", app], {
  stdio: "inherit",
});
execFileSync("/usr/bin/codesign", ["--verify", "--deep", app], {
  stdio: "inherit",
});
const destination = path.join(release, "OpenShoot.app");
try {
  await fs.access(destination);
  await fs.rename(
    destination,
    path.join(release, "OpenShoot-previous-" + Date.now() + ".app"),
  );
} catch (e) {
  if (e.code !== "ENOENT") throw e;
}
await fs.rename(app, destination);
await fs.rm(stage, { recursive: true, force: true });
console.log(destination);
