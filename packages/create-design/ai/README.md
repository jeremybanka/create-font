# `@create-design/ai`

Headless Adobe Illustrator interchange for create-design. The importer decodes
Illustrator's native, revisable source program from modern `.ai` containers (or
reads legacy direct Illustrator PostScript), parses a typed canvas-oriented AST,
then lowers it into one validated `DesignDocument` hierarchy.

```ts
import { readFile } from "node:fs/promises"
import { importAdobeIllustrator } from "@create-design/ai"

const imported = importAdobeIllustrator(await readFile("poster.ai"))
if (!imported.ok) console.error(imported.diagnostics)
else console.log(imported.document)
```

PDF pages embedded in `.ai` files are previews and are never treated as artwork.
If native Illustrator source is absent or corrupt, import fails with an
actionable diagnostic instead of clipping or duplicating page presentations.

## Architecture and public APIs

- `decodeIllustratorPrivateSource` extracts contiguous `AIPrivateData` blocks,
  supports Illustrator deflate and zstd containers, and accepts direct
  Illustrator PostScript. Node versions without zstd support receive a precise
  compatibility diagnostic.
- `lexIllustratorSource` losslessly tokenizes the complete source, including
  whitespace, CR/LF/CRLF comments and pseudo-comments, nested strings, names,
  numbers, hex data, and structural delimiters. Concatenating token `raw` values
  reconstructs the original program.
- `parseIllustratorSource` produces the typed AST: global artboards, layers,
  groups, compound paths, clipping paths, editable Béziers, process/custom
  paint, strokes, live text frames, decoded AI11 text resources, source spans,
  metadata, raw statements, and preserved unknown extensions.
- `lowerIllustratorSource` performs the explicit Illustrator Y-up to
  create-design Y-down conversion once. Artboards remain independent export
  rectangles on the original shared canvas; they never own, clip, translate, or
  duplicate artwork.

## Fidelity boundary

Native paths, compound holes, clipping groups, layer order/visibility/locks,
RGB/CMYK/gray and alternate process paint, stroke geometry, artboard positions,
bleed, and off-artboard artwork are preserved. AI11 point-like live text content,
positions, point size, and PostScript font selection are represented as native
text objects. Imported PostScript fonts are external dependencies and must be
added to `fonts/index.json` before build or export; the importer lists every
required font in one diagnostic. Character-run paint, paragraph metrics, and
threaded, multiframe, area, path, or undo-shadow text structures remain
losslessly available in the source AST and produce explicit fidelity warnings.

Placed/raster art, gradients and patterns, opacity/transparency, symbols,
brushes, effects, overprint, and newer extension operators remain in the
lossless source layer. Named-ink tints retain their authored operands in the AST
and lower to a tint-aware process-color approximation. Constructs that affect
visible scene lowering are diagnosed rather than silently converted to
page-preview artwork.

The decoder and public parser enforce bounded file, compressed-source,
decompressed-source, source-character, statement, AI11 text-resource, token,
point, and nesting work before materializing their corresponding structures.
Private PDF stream blocks require direct bounded lengths and exact PDF object
and generation references; duplicate objects, ambiguous descriptors, generation
mismatches, and missing or noncontiguous block numbering are rejected.

## Supplied-sample verification

The untracked issue samples are read during development but never committed.
Current native-source results are:

- `biome.ai`: 8 original-position artboards, 51 vector objects, 5 clipping groups.
- `equip.ai`: 1 artboard with 3-point bleed, 22 vector objects, 11 groups, and 5
  authored layers with their locks.
- `lasertag.ai`: all 4 exact artboards, 207 vector objects, 45 structural groups,
  111 source compound paths, and 9 active live-text frames (216 native objects).

Committed synthetic fixtures cover the same private-container, shared-canvas,
paint, hierarchy, compound, clip, lexer, and direct-source paths.
