# @create-design/pdf

## 0.1.4

### Patch Changes

- @create-design/source@0.4.2
  - @create-design/model@0.2.2
  - @create-design/text@0.0.3

## 0.1.3

### Patch Changes

- @create-design/source@0.4.1
  - @create-design/model@0.2.1
  - @create-design/text@0.0.2

## 0.1.2

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
- 6421beb: Add placed raster images and editable clipping masks across source projects, canvas rendering, and PDF/SVG export.
- 27a2793: Add configurable transparent artboard backgrounds, outside borders, canvas labels, and active Artboards tile styling with consistent SVG, PNG, and PDF export behavior.
- 5c9197e: Preserve linked artboard paints, artboard backgrounds, live text and image resources, clipping, visibility and locking, and atomic selection across canvas and headless PDF, SVG, and PNG exports, with explicit diagnostics for unresolved and cyclic references.
- fa8a287: Share one effective layer projection across the canvas, previews, clipboard interchange, PDF, SVG, and PNG output.
- 3d7e4d5: Add persisted live contour blends with deterministic interpolation, diagnostics, canvas rendering, clipboard semantics, and PDF lowering.
- 3fb4abf: Preserve open create-design contours losslessly while deriving straight fill closure independently from open stroke topology, including Pathfinder and SVG/PDF/PNG output parity. Pen drafts now finish open on Enter, double-click, or a tool switch, retain same-frame Bézier handle drags when pointer capture ends before pointer-up reaches the canvas, and Direct Selection deletes nodes by splitting their surviving runs instead of deleting the complete object.
- Updated dependencies [3275452]
- Updated dependencies [1a9b87b]
- Updated dependencies [6421beb]
- Updated dependencies [48db2a7]
- Updated dependencies [e56860f]
- Updated dependencies [27a2793]
- Updated dependencies [c80b294]
- Updated dependencies [5c9197e]
- Updated dependencies [fa8a287]
- Updated dependencies [3d7e4d5]
- Updated dependencies [664804c]
- Updated dependencies [bbf22f4]
- Updated dependencies [62c9d01]
- Updated dependencies [3fb4abf]
- Updated dependencies [864121c]
- Updated dependencies [db30f7b]
- Updated dependencies [f0710f5]
  - @create-design/model@0.2.0
  - @create-design/source@0.4.0
  - @create-design/text@0.0.1

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
- Updated dependencies [c852f02]
- Updated dependencies [16e86cb]
- Updated dependencies [efd3b76]
- Updated dependencies [306063e]
- Updated dependencies [7471aca]
- Updated dependencies [dd3321b]
- Updated dependencies [41e85b8]
  - @create-design/model@0.1.1
  - @create-design/source@0.3.0
