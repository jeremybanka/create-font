# @create-art/editor

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
- Updated dependencies [c852f02]
  - @create-art/preact-konva@0.2.0
