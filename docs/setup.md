# Setup and building

## Get started

1. **[Download the latest DMG](https://github.com/codebooker/OpenShoot/releases/latest)**, open it, and drag **OpenShoot** into **Applications**.
2. Create an album and choose the shoot type.
3. Import a folder or card. Filter for RAW, JPEG, or particular extensions; RAW+JPEG companions remain separate images.
4. Run local culling, or connect ChatGPT in Settings for AI-assisted workflows.
5. Review, adjust, and export your keepers or Quick Preview showcase.

**Current download:** Apple Silicon (`arm64`), macOS 13 or later. Tested on Apple Silicon with macOS 26. Intel, Windows, and Linux release binaries are not currently provided. Camera RAW decoding depends on the camera model, encoding, and available macOS support—recognizing an extension does not guarantee decoding it. See [format coverage](file-formats.md).

**Early-access distribution:** the current app is ad-hoc signed, not Apple-notarized. macOS may show an unidentified-developer warning. Follow Apple's [instructions for opening an app from an unidentified developer](https://support.apple.com/guide/mac-help/open-a-mac-app-from-an-unknown-developer-mh40616/mac) only if you trust this release. SHA-256 checksums accompany the DMG. Do not disable Gatekeeper globally.

### AI account and RAW model

- Local culling, manual editing, and export work without a ChatGPT account.
- Optional AI features use your connected ChatGPT account and its available models/allowance. Account eligibility, model access, and service limits may vary. No shared API key is included.
- RAW AI denoise runs locally. Install the supported Bayer model in Settings; the separately downloaded weights are **not bundled** in the DMG or source repository. Review their license before installing. Unsupported RAW types use an explicitly reported image-noise-reduction fallback in automatic finishing.
- The RAW model does not support every sensor layout; X-Trans and Foveon are not supported by this Bayer model.

## Your photos, your choice

Your catalog, edit settings, previews, denoise products, and model files live on your Mac. OpenShoot keeps original files in place and saves edits separately.

**AI features send selected image previews to OpenAI only after photo-preview sharing is enabled.** Editing requests can include camera settings and small unscaled detail samples to help judge noise. Set matching sends edited previews to compare the group. Local denoise does not upload your RAW file. Connecting an account alone does not send photographs.

Credentials are stored in the local app-data folder using Electron's OS-backed encryption. This repository and release do not include accounts, tokens, libraries, test photographs, or model weights. For details and reporting concerns, see [Security & privacy](../SECURITY.md).

**Storage:** full-resolution RAW denoise products can consume significant disk space. Completed job scratch libraries are cleaned automatically; finished source renders remain available for previews/export, and blend caches may be recreated. Back up originals and the catalog before managing app data. Avoid deleting referenced denoise sources while editing or exporting.

## Build from source

You need **Node.js 22.12+**, npm, Xcode Command Line Tools, and **Rust 1.90+** for the native RAW worker. The DMG already contains the compiled workers; end users do not need these development tools.

```sh
git clone https://github.com/codebooker/OpenShoot.git
cd OpenShoot
npm ci
npm run build:raw
npm test
npm run dev
```

Build the app and DMG on macOS:

```sh
npm run package
npm run dmg
```

Outputs appear in `release/`. Packaging uses the installed Electron architecture; the published release is built for Apple Silicon. For a disposable development library, set `OPENSHOOT_DATA_DIR` to a separate local directory before launching. Release packaging includes runtime dependencies and their license notices, not your app-data directory.

## Contribute

Found a rough edge? [Open an issue](https://github.com/codebooker/OpenShoot/issues) with your macOS version, camera/file format, and steps to reproduce. Please remove personal paths, account details, and private photos from logs/screenshots. See [contributing](../CONTRIBUTING.md) for local checks.

OpenShoot is early-access software. The current tests cover editing, checkpoints, culling, import filters, OAuth validation, denoise integration, and set matching; they do not replace testing with your camera and workflow.

## License and credits

OpenShoot is licensed under **[AGPL-3.0](../LICENSE)**. The RAW engine incorporates [LightCraft](https://github.com/storytold/lightcraft) components under their MIT/Apache-2.0 terms. Other dependencies and assets retain their own licenses. The optional RawNIND model weights are separately distributed under GPL-3.0.

See [third-party notices](../THIRD_PARTY.md), [asset attribution](../assets/ATTRIBUTION.md), and the license texts in the source and packaged app.
