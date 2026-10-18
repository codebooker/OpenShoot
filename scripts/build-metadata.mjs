import fs from "node:fs";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
if (process.platform === "darwin") {
  const source = "native/metadata.swift",
    target = "native/openshoot-metadata";
  if (
    !fs.existsSync(target) ||
    fs.statSync(source).mtimeMs > fs.statSync(target).mtimeMs ||
    fs.statSync(fileURLToPath(import.meta.url)).mtimeMs >
      fs.statSync(target).mtimeMs
  ) {
    let silicon = false;
    try {
      silicon =
        execFileSync("/usr/sbin/sysctl", ["-n", "hw.optional.arm64"], {
          encoding: "utf8",
        }).trim() === "1";
    } catch {}
    const args = [
      "swiftc",
      "-O",
      "-target",
      `${silicon ? "arm64" : "x86_64"}-apple-macosx11.0`,
      "-file-prefix-map",
      `${os.homedir()}=/build/user`,
      source,
      "-o",
      target,
    ];
    execFileSync(
      silicon ? "/usr/bin/arch" : "/usr/bin/xcrun",
      silicon ? ["-arm64", ...args] : args,
      { stdio: "inherit" },
    );
  }
}
