# create-design

`create-design` is a proof-of-concept vector design application related to
`create-font`. It shares the editor command palette and responsive workspace
allocation logic, uses the same Bézier point representation, and exchanges
vectors with `create-font` through its versioned outline clipboard format.

The first output target is PDF through `mondrian.pdf`'s validated object IR.
RGB-authored fills are emitted with PDF RGB operators and CMYK-authored fills
with native PDF CMYK operators.

```sh
pnpm --filter create-design dev
pnpm --filter create-design test
pnpm --filter create-design build
```
