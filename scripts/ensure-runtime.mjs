// Electron chooses native Apple Silicon even when npm runs under Rosetta.
// Ensure Sharp has the matching optional native binary without changing the lockfile.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { spawnSync, execFileSync } from "node:child_process";
const require = createRequire(import.meta.url);
let electron;
try {
  electron = require("electron");
} catch {
  const install = spawnSync(
    process.execPath,
    ["node_modules/electron/install.js"],
    {
      stdio: "inherit",
      env: { ...process.env, npm_config_arch: process.arch },
    },
  );
  if (install.status !== 0) process.exit(install.status || 1);
  electron = require("electron");
}
if (process.platform === "darwin") {
  const binary = fs.readFileSync(electron);
  const cpu = binary.readUInt32LE(4);
  const arch =
    cpu === 0x0100000c ? "arm64" : cpu === 0x01000007 ? "x64" : process.arch;
  const needed = [
    `@img/sharp-darwin-${arch}`,
    `@img/sharp-libvips-darwin-${arch}`,
  ].filter((name) => !fs.existsSync(path.join("node_modules", name)));
  if (needed.length) {
    const sharp = JSON.parse(
      fs.readFileSync(
        path.join("node_modules", "sharp", "package.json"),
        "utf8",
      ),
    );
    const args = [
      "install",
      "--force",
      "--no-save",
      "--ignore-scripts",
      "--package-lock=false",
      "--no-audit",
      "--no-fund",
      ...needed.map((name) => name + "@" + sharp.optionalDependencies[name]),
    ];
    const result = spawnSync("npm", args, { stdio: "inherit" });
    if (result.status !== 0) process.exit(result.status || 1);
  }
}
await import("./build-metadata.mjs");
