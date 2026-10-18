# Third-party notices

OpenShoot's original application code is distributed under the root AGPL-3.0 license. Third-party components keep their respective licenses.

- **LightCraft native engine**, copyright ArtCraft Team and contributors: selected vendored crates and required assets, MIT OR Apache-2.0. Source: https://github.com/storytold/lightcraft. See `third_party/lightcraft/LICENSE-MIT`, `LICENSE-APACHE`, `NOTICE`, and `assets/ATTRIBUTION.md`. OpenShoot's adapter is in `third_party/lightcraft/openshoot-raw`. The native build includes a dependency/license inventory under the app's `Contents/Resources/licenses/rust/`.
- **Spectral camera matrices:** upstream LightCraft notices identify rawtoaces-data (Academy Software Foundation, Apache-2.0) and CIE 1931 color-matching data (CIE, CC-BY-4.0). Preserve the vendored attribution and notices.
- **Inter fonts**, Rasmus Andersson: SIL Open Font License 1.1. License files accompany the font assets and are copied into the app.
- **Electron/Chromium:** MIT and accompanying third-party notices. Original Electron license files remain in the packaged app.
- **React/React DOM, Sharp, exifr, jose, and their runtime dependencies:** license files accompany the distributed npm packages. Sharp/libvips carries its upstream LGPL and dependency notices. Build tooling and UI packages retain their own package licenses; Lucide is ISC licensed.
- **Optional RawNIND Bayer weights**, Brummer / De Vleeschouwer and darktable-ai contributors: GPL-3.0. Source: https://github.com/darktable-org/darktable-ai/tree/master/models/rawdenoise-nind. The weights are installed separately and are not included in this repository or release. Source, checksum and license are recorded in `electron/raw-model.json`.

The OpenShoot icon was supplied for the project. README artwork and screenshots use original generated demo illustrations. See `assets/ATTRIBUTION.md` for asset provenance. No customer photograph is included in the public showcase.
