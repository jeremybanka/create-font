---
"@create-art/source-format": patch
"@create-art/source-rpc": patch
"@create-art/vector-geometry": patch
"@create-design/source": patch
"@create-design/svg": patch
"@create-font/font-service": patch
---

Correct public TypeScript contracts for browser source formatting, request bodies, stroke diagnostic arrays, legacy design migration, and discriminated font outline commands.

Design directory assembly now returns a missing-file diagnostic for a missing project manifest alongside inline text. Direct SVG export reports an actionable error when a linked artboard has not been expanded.
