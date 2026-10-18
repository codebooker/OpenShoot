# Security and privacy

## Reporting a concern

Do not include tokens, account files, private images, library exports, or full personal paths in public issues. Use GitHub's private vulnerability reporting for this repository if available; otherwise open an issue containing only a general description and ask the maintainer for a private channel.

## Local data

The default macOS data directory is `~/Library/Application Support/OpenShoot/`. It contains the catalog, cached previews/denoise products, preferences, AI checkpoints, and encrypted account credentials. The original photos remain at their imported locations. Back up originals and catalog data independently.

Local culling and manual edits do not require cloud inference. Opting into AI image sharing allows previews, relevant capture metadata, and editing detail samples to be sent to OpenAI using the connected account. Set matching sends rendered previews. AI output is validated, but it remains a recommendation requiring review.

## Publishing safeguards

Internal research, personal testing records, app-data directories, media captures, model weights, credentials, build caches, and installers are excluded from the source repository. The application bundle is assembled from an explicit code/runtime allowlist. Native builds remap local source paths. Release assets include checksums.

The first public build is ad-hoc signed and is not Apple-notarized. It does not claim a verified Apple developer identity. Review the source, release URL, and checksum before running it.

A clean automated secret scan reduces risk; it is not a guarantee that every possible disclosure pattern is detectable. Report any accidental exposure promptly.
