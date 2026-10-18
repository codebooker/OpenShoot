import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
const root = process.cwd();
const encodedFlags = [
  ...(process.env.CARGO_ENCODED_RUSTFLAGS?.split("\x1f") ||
    process.env.RUSTFLAGS?.split(/\s+/).filter(Boolean) ||
    []),
  `--remap-path-prefix=${os.homedir()}=/build/user`,
  `--remap-path-prefix=${root}=/build/openshoot`,
].join("\x1f");
const buildEnv = {
  ...process.env,
  CARGO_ENCODED_RUSTFLAGS: encodedFlags,
  CARGO_PROFILE_RELEASE_STRIP: "symbols",
};
const args = [
  "build",
  "--release",
  "--manifest-path",
  path.join(root, "third_party/lightcraft/Cargo.toml"),
  "-p",
  "openshoot-raw",
];
let appleSilicon = false;
if (process.platform === "darwin") {
  try {
    appleSilicon =
      execFileSync("/usr/sbin/sysctl", ["-n", "hw.optional.arm64"], {
        encoding: "utf8",
      }).trim() === "1";
  } catch {}
}
if (appleSilicon)
  execFileSync("/usr/bin/arch", ["-arm64", "cargo", ...args], {
    stdio: "inherit",
    env: buildEnv,
  });
else execFileSync("cargo", args, { stdio: "inherit", env: buildEnv });
await fs.mkdir(path.join(root, "native"), { recursive: true });
await fs.copyFile(
  path.join(root, "third_party/lightcraft/target/release/openshoot-raw"),
  path.join(root, "native/openshoot-raw"),
);
await fs.chmod(path.join(root, "native/openshoot-raw"), 0o755);

await import("./collect-raw-licenses.mjs");
