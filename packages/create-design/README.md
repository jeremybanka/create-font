# create-design

`create-design` is a proof-of-concept vector design application related to
`create-font`. It shares the editor command palette and responsive workspace
allocation logic, uses the same Bézier point representation, and exchanges
vectors with `create-font` through its versioned outline clipboard format.

The first output target is PDF through `mondrian.pdf`'s validated object IR.
RGB-authored fills and strokes are emitted with PDF RGB operators and
CMYK-authored paints with native PDF CMYK operators.

Design objects keep three authored concerns separate:

- `geometry` is a tagged path, live rectangle, or live ellipse;
- `transform` is an independent local-to-document affine transform; and
- `appearance` contains optional fill and stroke paints.

Move, scale, and rotate compose the object transform without rewriting source
points or converting live shapes. Canvas, selection, clipboard, and PDF use an
explicit document-space contour projection. Node-level vector replacement is
the deliberate bake boundary: it converts the projected result to path
geometry and resets the transform to identity.

The versioned repository source boundary lives in
[`@create-design/source`](../design-source/README.md). Its first directory
format splits document metadata, palette, artboard, layer ordering, and each
design object into independently validated units. Object IDs, display names,
source paths, and stacking order remain independent so ordinary edits produce
narrow Git diffs. Group, asset, and font inventories reserve future source
boundaries without duplicating facts the current document model cannot yet
represent.

The repository's [`designs/workbench-poster`](../../designs/workbench-poster)
project is a complete source-format example and the default development
workspace.

The Export tile offers an opt-in live PDF proof rendered by the browser's PDF
viewer. PDF lowering is memoized at object, page, and document boundaries, so
ordinary geometry edits reuse unrelated object streams. The last successfully
loaded proof remains visible while a replacement compiles or if an edit makes
the document temporarily invalid.

```sh
pnpm --filter create-design dev
pnpm --filter create-design test
pnpm --filter create-design build
pnpm --filter create-design profile:pdf
```

The profile command reports cold and warm projection and serialization timings
for a 500-object document without asserting machine-dependent thresholds.
