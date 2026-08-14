# @create-font/source

## 0.2.10

### Patch Changes

- e56860f: Add durable circular and squircle corner profiles with shared inset controls,
  deterministic lowering, safe adjacent-corner clamping, accessible numeric
  editing, undoable multi-master font edits, and output/compiler parity.
- Updated dependencies [e56860f]
- Updated dependencies [f99d64d]
  - @create-font/states@0.7.1

## 0.2.9

### Patch Changes

- Updated dependencies [27b8d85]
  - @create-font/states@0.7.0

## 0.2.8

### Patch Changes

- c852f02: Declare the repository's MPL library boundary and AGPL application boundary, with explicit permissions for generated assets.
- Updated dependencies [8188be2]
- Updated dependencies [c852f02]
  - @create-font/fea-rs-wasm@0.1.2
  - @create-art/source-format@0.1.2
  - @create-font/states@0.6.8

## 0.2.7

### Patch Changes

- 0d59cb3: Format canonical create-font and create-design source with the pinned,
  published dprint contract before hashing and persistence, and expose matching
  `create-source-format` fmt/check workflows for users, editors, and CI.
- Updated dependencies [c5b4ace]
- Updated dependencies [0d59cb3]
- Updated dependencies [76d6aa0]
  - @create-font/states@0.6.7
  - @create-art/source-format@0.1.1

## 0.2.6

### Patch Changes

- aa926b7: Add shared Adobe feature analysis, checking CLI, language server, and bundled VS Code extension
- 1856b23: Replace the transitional TypeScript Adobe feature parser with upstream fea-rs through shared WebAssembly bindings in Node and browser consumers.
- Updated dependencies [1856b23]
- Updated dependencies [13eda7d]
  - @create-font/fea-rs-wasm@0.1.1
  - @create-font/states@0.6.6

## 0.2.5

### Patch Changes

- @create-font/states@0.6.5

## 0.2.4

### Patch Changes

- Updated dependencies [475f2f7]
  - @create-font/states@0.6.4

## 0.2.3

### Patch Changes

- e610e37: Add persisted glyph measuring rules, derived one-dimensional form and counterform measures, and the Rule canvas tool.
- Updated dependencies [6601452]
- Updated dependencies [e610e37]
  - @create-font/states@0.6.3

## 0.2.2

### Patch Changes

- 5ff7ace: Add persisted pair kerning, canvas editing controls, and conventional GPOS Pair Adjustment compilation.
- 04000ab: Compile Adobe feature sources into GSUB tables and apply enabled substitutions in the Canvas preview.
- Updated dependencies [5ff7ace]
- Updated dependencies [f87a70c]
- Updated dependencies [04000ab]
  - @create-font/states@0.6.2

## 0.2.1

### Patch Changes

- @create-font/states@0.6.1

## 0.2.0

### Minor Changes

- 9f0fe7d: Store outlines independently per master, migrate v3/v4 shared topology to the
  v5 source model, validate interpolation compatibility explicitly, preserve
  authored paths during export, and add master comparison plus path-order tools.

### Patch Changes

- Updated dependencies [9f0fe7d]
  - @create-font/states@0.6.0

## 0.1.4

### Patch Changes

- Updated dependencies [b64038b]
- Updated dependencies [829bcd6]
- Updated dependencies [a325bed]
- Updated dependencies [7dfefd2]
- Updated dependencies [585a2af]
  - @create-font/states@0.5.0

## 0.1.3

### Patch Changes

- Updated dependencies [7c44ab6]
- Updated dependencies [d2446a5]
  - @create-font/states@0.4.0

## 0.1.2

### Patch Changes

- Updated dependencies [f51bcf5]
- Updated dependencies [0de6bd8]
  - @create-font/states@0.3.0

## 0.1.1

### Patch Changes

- Updated dependencies [4541636]
- Updated dependencies [4541636]
- Updated dependencies [4541636]
  - @create-font/states@0.2.0

## 0.1.0

### Minor Changes

- 2abe981: Add configurable per-metric overshoot zones and a shared vertical-metric model
  for source round trips, canvas guides, snapping, and node alignment halos.

### Patch Changes

- Updated dependencies [2abe981]
- Updated dependencies [2abe981]
  - @create-font/states@0.1.0
