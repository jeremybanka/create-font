# @create-art/source-rpc

## 0.1.4

### Patch Changes

- ea25f19: Correct public TypeScript contracts for browser source formatting, request bodies, stroke diagnostic arrays, legacy design migration, and discriminated font outline commands.

  Design directory assembly now returns a missing-file diagnostic for a missing project manifest alongside inline text. Direct SVG export reports an actionable error when a linked artboard has not been expanded.

## 0.1.3

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
- bbf22f4: Allow uniquely named source RPC mounts so multiple isolated project sessions can share one workspace server.

## 0.1.2

### Patch Changes

- c852f02: Declare the repository's MPL library boundary and AGPL application boundary, with explicit permissions for generated assets.

## 0.1.1

### Patch Changes

- 05f8226: Transfer byte-preserved design assets through bounded, atomic source RPC transactions.
- 05f8226: Generalize bounded source comparison and selective Git commits with adapter-defined semantic change groups, and enable design-aware version control.
- 76d6aa0: Add shared revisioned source RPC infrastructure and source-backed create-design workspaces with atomic persistence and reliable live editor synchronization, including active glyph restoration after external filesystem resets. Run both editors and their APIs from the root development command on a configurable four-port block, with the checked-in Workbench Poster as create-design's default development source.
