# create-design

`create-design` is a proof-of-concept vector design application related to
`create-font`. It shares the editor command palette and responsive workspace
allocation logic, uses the same Bézier point representation, and exchanges
vectors with `create-font` through its versioned outline clipboard format.

The first output target is PDF through `mondrian.pdf`'s validated object IR.
RGB-authored fills are emitted with PDF RGB operators and CMYK-authored fills
with native PDF CMYK operators.

The versioned repository source boundary lives in
[`@create-font/design-source`](../design-source/README.md). Its first directory
format splits document metadata, palette, artboard, layer ordering, and each
design object into independently validated units. Object IDs, display names,
source paths, and stacking order remain independent so ordinary edits produce
narrow Git diffs. Group, asset, and font inventories reserve future source
boundaries without duplicating facts the current document model cannot yet
represent.

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
