# Origin and attribution

This project is a new build on the structures of an existing work, with
file-wise adoption of parts of its integrity core.

This file records upstream attribution. Build provenance and copied modules also
retain their origin. Generated knowledge pages do not contain project advertising.

## Base

| | |
|---|---|
| Name | SkillSafeWerkstatt |
| Author | GodModeAI2025 |
| Repository | https://github.com/GodModeAI2025/SkillSafeWerkstatt |
| Commit | 6da224019453cb1b148af0b1097560101598a1bb (2026-08-22) |
| License | Apache License 2.0, 201 lines, no NOTICE file |

Apache 2.0 treats a copy and a clone alike, so file-wise adoption needs no
separate permission. It does need attribution, which is what this file is.

## Per-file attribution

Every file copied or adapted from the base carries an origin note in its head
comment, naming the source path in the base repository and whether it was taken
unchanged or adapted. A file without such a note is original work of this
project.

The base repository is not required to build or run this software.

## License

This project is licensed under the Apache License 2.0. See `LICENSE`.

## Portable runtime and platform builds (0.4.0)

The JavaScript runtime under `runtime/` preserves the Markdown and collaboration
contracts. Browser review/sync/project functions are statically generated into
`runtime/compat/` from this project's `app/` sources, with a build drift check.

The deterministic ZIP writer and runtime-section selector are adapted from
https://github.com/pssah4/vault-operator-skills at commit
56170eb6f40c9212b4a42590210af6d23b1e3622, Apache-2.0. Exact copied paths, changes and
hashes are recorded in `vendor/skill-build/ORIGIN.json`; its license is retained.
No skill-migrator code or workflow is used.

Runtime packages carry yaml 2.9.0 (ISC), fflate 0.8.3 (MIT), fast-xml-parser 5.11.1
and its bundled dependencies (MIT), and PDF.js 6.3.289 (Apache-2.0). Their notices
are in `assets/licenses/`; PDF font/WASM notices travel beside those assets.
The Vault Operator package uses Chromium's inert XML parser instead of the Node
XML dependency and receives the default ontology as an asset. It has no OS or
network interface. PDF/visual extraction there uses explicitly available host tools.

## Lucide interface icons

The workspace embeds a subset of Lucide SVG icons from
https://github.com/lucide-icons/lucide (retrieved 2026-09-08). The upstream ISC
license and the MIT notice for Feather-derived icons are included in full in
`app/icons.js` and travel inside the generated offline HTML and skill archives.

## Bundled Office viewer

The browser preview includes @silurus/ooxml 0.72.2 (MIT) and @zrimo/viewer 0.1.2
(MIT OR Apache-2.0), including their Office parser WASM. Full upstream notices
and license texts travel in `runtime/assets/office-NOTICES.txt` and inside
the embedded Office document. Versions, input hashes and local adaptations are
recorded in `vendor/office/manifest.json` and `vendor/office/README.md`.
