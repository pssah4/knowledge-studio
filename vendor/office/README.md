# Bundled Office runtime

Pinned from the public npm registry on 2026-09-08:

- `@silurus/ooxml@0.72.2`, https://github.com/yukiyokotani/office-open-xml-viewer
- `@zrimo/viewer@0.1.2`, https://github.com/bnku/zrimo

Only files used by the Office build and upstream license/provenance files are kept.
The ooxml MIT LICENSE was retrieved from the upstream repository (the npm package
ships its third-party notices). `manifest.json` records every build input hash.

Developer rebuild (esbuild 0.28.2; Node is a development dependency only):

```
node scripts/build_office.mjs /path/to/esbuild/lib/main.js
node scripts/build-app.mjs
```

Use the esbuild version actually recorded in the manifest when reproducing an
artifact. All user-facing builds use the checked-in generated `app/officebundle.js`.
Users install no programs or npm packages and download no runtime assets.

The build adapts three self-contained parser workers from module to classic Blob
workers. Chrome rejects module Blob workers in an opaque-origin frame. The import.meta
startup URL revocation is removed from these workers; their owning frame releases
its Blob resources when closed. Source vendor files remain unchanged. WASM is passed
as embedded data, never loaded from its upstream default asset URL. Upstream font
fetching is disabled. No PDF.js, cloud viewer, font downloads or native converter.

A sandboxed srcdoc frame (`allow-scripts`, no same-origin access) receives only the
selected file bytes. Its CSP blocks networking and permits embedded JS/WASM and Blob
parser workers. Compressed encoding is packaging, not the security boundary. PDF
uses the browser's built-in viewer. Modern Office is rendered via Canvas; legacy
conversion occurs in memory. If legacy layout conversion fails, plain text extraction
is attempted and clearly labelled. PPT uses the explicit text view because the pinned converter does not preserve slide
structure. Both paths can reject unsupported or damaged files.

The complete upstream license notices are included in the generated document and
`runtime/assets/office-NOTICES.txt`. Upstream notices also mention optional
assets omitted by this build.
