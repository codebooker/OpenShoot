# Import format coverage

Reviewed 2026-10-17. One central registry, `electron/file-types.cjs`, drives folder scanning, the system file picker, RAW/JPEG presets, extension filtering, and camera-family labels. Matching is case-insensitive and uses the final filename extension, so `photo.JPG` matches JPEG and `photo.jpg.exe` does not. RAW+JPEG pairs are separate entries: RAW-only excludes their JPEG companions and vice versa.

| Camera family / standard | Recognized RAW extensions |
| --- | --- |
| Canon | CRW, CR2, CR3 |
| Nikon | NEF, NRW |
| Sony | ARW, SRF, SR2 |
| Fujifilm | RAF |
| Olympus / OM System | ORF |
| Panasonic / legacy Leica | RW2, RAW |
| Leica | RWL |
| Pentax | PEF |
| Samsung | SRW |
| Hasselblad | 3FR, FFF |
| Phase One | IIQ |
| Leaf / Mamiya | MOS, MEF, MFW |
| Minolta | MRW |
| Kodak | DCR, KDC |
| Epson | ERF |
| GoPro | GPR |
| Sigma | X3F |
| DNG / multi-brand / Apple ProRAW | DNG |

This is 28 distinct RAW extensions. DNG is used across several camera brands and phones. These group labels are descriptive, not exclusive manufacturer identification.

Other recognized still-image extensions: JPG/JPEG/JPE/JFIF, PNG, TIF/TIFF, WEBP, HEIC/HEIF/HIF, AVIF, and BMP. Custom selection can include any subset encountered in the chosen source. Sidecars, movies, hidden files, and symbolic links are not imported as photos. Scanning includes nested folders, with a nesting limit.

Recognition only determines candidates for import. Each selected file must successfully decode before it is added to the album. Sharp is tried first; on macOS, ImageIO through `sips` is the fallback. A camera model, RAW compression variant, multi-shot format, damaged file, or OS version can prevent decoding even when its extension is recognized. Those files are reported individually; the rest of the batch continues. No claim is made that OpenShoot matches Adobe's or Apple's entire supported-camera matrix.

Legacy TIFF-wrapped camera RAW is ambiguous with ordinary TIFF by extension; the RAW-only preset does not include all TIFF files. EIP packages, proprietary project/catalog files, and video RAW containers are not treated as still photographs.

## Sources

- [Adobe supported-camera table](https://helpx.adobe.com/camera-raw/desktop/dng-and-file-formats/camera-raw-plug-supported-cameras.html): manufacturer and filename-extension references.
- [Adobe Experience Manager file-format reference](https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service/content/assets/file-format-support): RAW extension and manufacturer overview, including legacy and medium-format types. This is a reference for format names, not OpenShoot decoder support.
- [Apple camera RAW compatibility](https://support.apple.com/en-gb/122870): demonstrates camera-model and OS-specific decoder coverage.
- [Nikon NX Studio](https://www.nikonusa.com/content/nx-studio): Nikon NEF/NRW formats.
