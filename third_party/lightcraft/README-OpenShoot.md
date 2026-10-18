# LightCraft RAW engine in OpenShoot

Vendored on 2026-10-17 from LightCraft workspace version 0.6.0 (upstream source: https://github.com/storytold/lightcraft). Used under the MIT license; see LICENSE-MIT, LICENSE-APACHE and NOTICE. Selected engine/dependency crates and their required camera assets/font are retained; desktop UI/app crates are excluded. Core engine sources are unmodified. `openshoot-raw` is OpenShoot's new isolated command-line adapter. It creates only OpenShoot-owned scratch libraries and never opens a user's LightCraft library.

Build with `npm run build:raw` (Rust/Cargo required). Binary and dependency license inventory are copied into the packaged app. Model weights are NOT bundled. OpenShoot supports the pinned RawNIND Bayer ONNX model, whose separate weights are GPL-3.0. Source and attribution are in `electron/raw-model.json`; users may install their existing model or download its checksum-verified archive. The model stays in OpenShoot's per-user data folder.
