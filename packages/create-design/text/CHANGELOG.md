# @create-design/text

## 0.0.5

### Patch Changes

- @create-design/source@0.4.4

## 0.0.4

### Patch Changes

- @create-design/source@0.4.3

## 0.0.3

### Patch Changes

- @create-design/source@0.4.2

## 0.0.2

### Patch Changes

- @create-design/source@0.4.1

## 0.0.1

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
- Updated dependencies [3275452]
- Updated dependencies [1a9b87b]
- Updated dependencies [6421beb]
- Updated dependencies [e56860f]
- Updated dependencies [27a2793]
- Updated dependencies [5c9197e]
- Updated dependencies [8818c4f]
- Updated dependencies [fa8a287]
- Updated dependencies [3d7e4d5]
- Updated dependencies [bbf22f4]
- Updated dependencies [62c9d01]
- Updated dependencies [3fb4abf]
- Updated dependencies [f99d64d]
- Updated dependencies [db30f7b]
  - @create-design/source@0.4.0
  - @create-font/font-service@0.0.2
  - @create-art/vector-geometry@0.0.3
