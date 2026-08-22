# @create-design/source

## 0.4.1

### Patch Changes

- Updated dependencies [1032c7c]
  - @create-art/source-format@0.2.0

## 0.4.0

### Minor Changes

- bbf22f4: Add workspace design switching and versioned portable live linked-artboard objects, including browser canvas/export projection and isolated recovery state.
- 62c9d01: Add arbitrary-angle snapping guides and the two-point Guide tool.
- db30f7b: Add the version-six first-class layer contract, migrate legacy singleton scenes,
  and preserve ordered layers throughout editing, SVG, and PNG projections.

### Patch Changes

- 3275452: Add editable point and area text, canonical font shaping and outline projection,
  persistent source fonts, PDF text lowering, overset diagnostics, and undoable
  text expansion. Use ready browser faces in the native editing overlay and exact
  layout/ink bounds for text selection, transforms, whitespace hit testing, and
  dragging. Rehydrate installed font bytes before reload preflight, reject stale
  browser font loads, and let whitespace double-clicks enter text editing.
  Keep canonical glyph outlines visually authoritative while the accessible native
  surface owns caret, selection, composition, and input. Store authored text in
  stable adjacent raw UTF-8 `.txt` units with lossless inline-source migration and
  coherent source/version-control transactions.
  Absorb proportional Point and Area Text resizing into canonical typography and
  frame metrics, including mixed selections and repeated transforms, while
  preserving anchored world geometry. Keep the native editor's content width
  independent of its border and prevent Point Text from soft-wrapping so caret and
  selection insertion boundaries remain aligned with shaped glyph advances.

  Keep installed font inventories and binary files coherent across comparison and
  selective version-control commits.
- 1a9b87b: Add authored layer UI colors, layer-colored selection outlines and fills, and a neutral layer-agnostic selection marquee.
- 6421beb: Add placed raster images and editable clipping masks across source projects, canvas rendering, and PDF/SVG export.
- e56860f: Add durable circular and squircle corner profiles with shared inset controls,
  deterministic lowering, safe adjacent-corner clamping, accessible numeric
  editing, undoable multi-master font edits, and output/compiler parity.
- 27a2793: Add configurable transparent artboard backgrounds, outside borders, canvas labels, and active Artboards tile styling with consistent SVG, PNG, and PDF export behavior.
- 5c9197e: Preserve linked artboard paints, artboard backgrounds, live text and image resources, clipping, visibility and locking, and atomic selection across canvas and headless PDF, SVG, and PNG exports, with explicit diagnostics for unresolved and cyclic references.
- fa8a287: Share one effective layer projection across the canvas, previews, clipboard interchange, PDF, SVG, and PNG output.
- 3d7e4d5: Add persisted live contour blends with deterministic interpolation, diagnostics, canvas rendering, clipboard semantics, and PDF lowering.
- 3fb4abf: Preserve open create-design contours losslessly while deriving straight fill closure independently from open stroke topology, including Pathfinder and SVG/PDF/PNG output parity. Pen drafts now finish open on Enter, double-click, or a tool switch, retain same-frame Bézier handle drags when pointer capture ends before pointer-up reaches the canvas, and Direct Selection deletes nodes by splitting their surviving runs instead of deleting the complete object.

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
