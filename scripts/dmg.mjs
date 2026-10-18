import fs from "node:fs/promises";
import { constants, createReadStream } from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
const root = process.cwd();
const release = path.join(root, "release");
const app = path.join(release, "OpenShoot.app");
const { version } = JSON.parse(
  await fs.readFile(path.join(root, "package.json"), "utf8"),
);
const header = await fs.readFile(path.join(app, "Contents/MacOS/OpenShoot"));
const cpu = header.readUInt32LE(4);
const arch =
  cpu === 0x0100000c ? "arm64" : cpu === 0x01000007 ? "x64" : "universal";
const name = `OpenShoot-${version}-mac-${arch}.dmg`;
const output = path.join(release, name);
const stage = await fs.mkdtemp(path.join(release, ".dmg-stage-"));
try {
  await fs.cp(app, path.join(stage, "OpenShoot.app"), {
    recursive: true,
    verbatimSymlinks: true,
    mode: constants.COPYFILE_FICLONE,
  });
  await fs.symlink("/Applications", path.join(stage, "Applications"));
  await fs.writeFile(
    path.join(stage, "Install OpenShoot.txt"),
    `OpenShoot ${version}\n\nDrag OpenShoot.app into Applications, then open it from there.\n\nEarly access: ad-hoc signed, not Apple-notarized. See the README and release notes for installation details.\n\nSource, license notices and checksums: https://github.com/codebooker/OpenShoot\n\nOriginal photos and account data are not included in this installer.\n`,
  );
  execFileSync(
    "/usr/bin/hdiutil",
    [
      "create",
      "-volname",
      "OpenShoot",
      "-srcfolder",
      stage,
      "-format",
      "UDZO",
      "-ov",
      output,
    ],
    { stdio: "inherit" },
  );
  execFileSync("/usr/bin/hdiutil", ["verify", output], { stdio: "inherit" });
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(output)) hash.update(chunk);
  await fs.writeFile(
    path.join(release, "SHASUMS256.txt"),
    `${hash.digest("hex")}  ${name}\n`,
  );
  console.log(output);
} finally {
  await fs.rm(stage, { recursive: true, force: true });
}
