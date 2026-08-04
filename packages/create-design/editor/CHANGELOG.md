# @create-design/editor

## 0.2.1

### Patch Changes

- 0e55ec6: Normalize design documents into granular atom.io atoms and keyed families.
- 3a29372: Restore composed geometry selectors with atom.io 0.51.1 transaction tracing.
- 9449dda: Use atom.io timeline effects to retain the latest 100 complete design undo steps.

## 0.2.0

### Minor Changes

- a731f3b: Port the browser editors from Preact and the local Konva adapter to React 19 and react-konva.

### Patch Changes

- 8935808: Migrate document history and source persistence to isolated atom.io state.
- Updated dependencies [a731f3b]
  - @create-art/editor@0.2.0

## 0.1.1

### Patch Changes

- 8188be2: Separate the create-design browser editor from its CLI and server package,
  move shared editor foundations under create-art ownership, and make font-owned
  package directories explicit throughout the workspace. Move the product-neutral
  Preact Konva bindings into the product-neutral `@create-art` scope. Put
  canonical document initialization in the source package and extract headless
  design-model and PDF packages for browser and CLI consumers. Keep the
  fea-rs-wasm build and benchmark scripts runnable from their scoped directory.
- Updated dependencies [8188be2]
- Updated dependencies [a5c4e14]
- Updated dependencies [8ed890a]
- Updated dependencies [c852f02]
- Updated dependencies [16e86cb]
- Updated dependencies [151d54a]
- Updated dependencies [3cbad6c]
- Updated dependencies [efd3b76]
- Updated dependencies [7471aca]
- Updated dependencies [306063e]
- Updated dependencies [7471aca]
- Updated dependencies [dd3321b]
- Updated dependencies [41e85b8]
  - @create-art/editor@0.1.1
  - @create-art/preact-konva@0.2.0
  - @create-design/model@0.1.1
  - @create-design/pdf@0.1.1
  - @create-design/source@0.3.0
  - @create-art/vector-geometry@0.0.2
  - @create-art/source-rpc@0.1.2
