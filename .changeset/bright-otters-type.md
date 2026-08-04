---
"create-design": patch
"@create-art/source-rpc": patch
"@create-design/editor": patch
"@create-design/model": patch
"@create-design/pdf": patch
"@create-design/source": patch
"@create-design/svg": patch
"@create-design/text": patch
"@create-font/font-service": patch
---

Add editable point and area text, canonical font shaping and outline projection,
persistent source fonts, PDF text lowering, overset diagnostics, and undoable
text expansion. Use ready browser faces in the native editing overlay and exact
layout/ink bounds for text selection, transforms, whitespace hit testing, and
dragging. Rehydrate installed font bytes before reload preflight, reject stale
browser font loads, and let whitespace double-clicks enter text editing.
Keep canonical glyph outlines visually authoritative while the accessible native
surface owns caret, selection, composition, and input. Store authored text in
stable adjacent raw UTF-8 `.txt` units with lossless inline-source migration and
coherent source/version-control transactions.

Keep installed font inventories and binary files coherent across comparison and
selective version-control commits.
