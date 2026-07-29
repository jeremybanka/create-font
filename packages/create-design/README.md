# create-design

`create-design` is a proof-of-concept vector design application related to
`create-font`. It shares the editor command palette and responsive workspace
allocation logic, uses the same Bézier point representation, and exchanges
vectors with `create-font` through its versioned outline clipboard format.

The first output target is PDF through `mondrian.pdf`'s validated object IR.
RGB-authored fills are emitted with PDF RGB operators and CMYK-authored fills
with native PDF CMYK operators.

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
