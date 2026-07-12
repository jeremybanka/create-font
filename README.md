# Trigraph

A TypeScript toolchain for rigorously modeled OpenType variable TrueType fonts.

- [`trigraph`](packages/trigraph/README.md) is the validated, logical-SFNT IR.
- [`@trigraph/states`](packages/states/README.md) is the atom.io editor model
  that incrementally projects into that IR.
- [`@trigraph/source`](packages/source/README.md) is its deterministic,
  lossless JSON source-file codec.
- [`@trigraph/editor`](packages/editor/README.md) is the Preact and Konva font
  editor built directly on that state graph.
