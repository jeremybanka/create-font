# @create-design/source

## 0.3.0

### Minor Changes

- a5c4e14: Replace the singleton page with ordered named artboards and deterministic legacy migrations.
- efd3b76: Add full stroke appearance authoring, painted geometry interactions, and faithful vector output.

### Patch Changes

- 8188be2: Separate the create-design browser editor from its CLI and server package,
  move shared editor foundations under create-art ownership, and make font-owned
  package directories explicit throughout the workspace. Move the product-neutral
  Preact Konva bindings into the product-neutral `@create-art` scope. Put
  canonical document initialization in the source package and extract headless
  design-model and PDF packages for browser and CLI consumers. Keep the
  fea-rs-wasm build and benchmark scripts runnable from their scoped directory.
- c852f02: Declare the repository's MPL library boundary and AGPL application boundary, with explicit permissions for generated assets.
- 16e86cb: Add persistent rulers and guides with configurable multi-source smart snapping.
- 306063e: Add strict versioned design-document decoding and deterministic v1-to-v2 migration.
- 7471aca: Add hierarchy-safe groups, compound paths with authored fill rules, and atomic stacking commands.
- dd3321b: Add persistent nested artwork groups with atomic selection, movement, duplication,
  group, ungroup, and stacking commands plus explicit group-content drill-down.
  Shared vector contours now expose the renderer's existing double-click and
  double-tap activation events for group drill-down.
- 41e85b8: Establish global document coordinates and stable vector identities.
- Updated dependencies [c852f02]
  - @create-art/source-format@0.1.2

## 0.2.0

### Minor Changes

- 0bdcb56: Separate authored geometry, object transforms, and optional fill/stroke appearance while preserving legacy path objects.

### Patch Changes

- 0d59cb3: Format canonical create-font and create-design source with the pinned,
  published dprint contract before hashing and persistence, and expose matching
  `create-source-format` fmt/check workflows for users, editors, and CI.
- 05f8226: Transfer byte-preserved design assets through bounded, atomic source RPC transactions.
- 07d8245: Preserve editable live rectangles and ellipses with exact parameters and atomic path expansion.
- 4b938c1: Add a deterministic directory-shaped create-design source codec with indexed document, palette, artboard, layer, object, asset, and font boundaries.
- Updated dependencies [0d59cb3]
  - @create-art/source-format@0.1.1
