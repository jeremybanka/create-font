---
"@create-font/glyphs": patch
"create-font": patch
---

Add `@create-font/glyphs` with a bounded Glyphs.app 2/3 source parser, preserved source AST, explicit create-font lowering, and a parser-only runtime entry. Import the resulting master-local cubic outlines, recursively expanded components, axes, instances, cmap, default-master kerning, and diagnostics through atomic project creation. Keep `font dev` alive and reliably serve the browser application from source-linked and installed packages.
