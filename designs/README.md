# Design projects

Each immediate subdirectory is an independently addressable create-design
project. The checked-in `workbench-poster` project is the development design
served by `pnpm dev` and `pnpm dev:design`.

Regenerate it from the repository root with:

```sh
node scripts/workbench-poster.ts
```

The source codec owns the stable serialization of project JSON, so those files
are intentionally excluded from the repository's generic JSON formatter.
