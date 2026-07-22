# Workbench Sans

Workbench Sans is create-font's live development family: a geometric, monoline
display sans with Text and Heavy masters. It includes .notdef, every printable
ASCII character from U+0020 through U+007E, and an unencoded f_i ligature, with
compatible topology across weights and reviewable per-entity JSON source units.
The Adobe feature source enables the f_i glyph through the standard liga feature.

Regenerate the checked-in source with `bun scripts/workbench-sans.ts`.

From the repository root, build the installable variable TrueType artifact with
`bun font build workbench-sans`. The deterministic output is written to
`artifacts/workbench-sans/WorkbenchSans-Text.ttf`.
