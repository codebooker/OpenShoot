import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
const root = process.cwd(),
  dest = path.join(root, "native/licenses");
const data = JSON.parse(
  execFileSync(
    "cargo",
    [
      "metadata",
      "--offline",
      "--filter-platform",
      "aarch64-apple-darwin",
      "--format-version",
      "1",
      "--manifest-path",
      path.join(root, "third_party/lightcraft/Cargo.toml"),
    ],
    { encoding: "utf8", maxBuffer: 30 * 1024 * 1024 },
  ),
);
await fs.mkdir(dest, { recursive: true });
const rows = [];
for (const p of data.packages) {
  rows.push({
    name: p.name,
    version: p.version,
    license: p.license,
    repository: p.repository,
  });
  const source = path.dirname(p.manifest_path),
    target = path.join(dest, p.name + "-" + p.version);
  for (const name of await fs.readdir(source))
    if (/^(license|copying|notice)([._-]|$)/i.test(name)) {
      const stat = await fs.stat(path.join(source, name));
      if (!stat.isFile()) continue;
      await fs.mkdir(target, { recursive: true });
      await fs.copyFile(path.join(source, name), path.join(target, name));
    }
}
await fs.writeFile(
  path.join(dest, "dependencies.json"),
  JSON.stringify(rows, null, 2),
);
