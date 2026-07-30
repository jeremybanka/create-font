# Design projects

Each immediate subdirectory is an independently addressable create-design
project. The checked-in `workbench-poster` project is the development design
served by `pnpm dev` and `pnpm dev:design`.

Regenerate it from the repository root with:

```sh
node scripts/workbench-poster.ts
```

The source codec and the repository formatter share the versioned
[`@create-art/source-format`](../packages/source-format/README.md) policy.
Regeneration, application writes, `pnpm fmt`, and `pnpm fmt:check` therefore
converge on identical bytes.
