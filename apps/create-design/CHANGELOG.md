# create-design

## 0.1.3

### Patch Changes

- 0d59cb3: Format canonical create-font and create-design source with the pinned,
  published dprint contract before hashing and persistence, and expose matching
  `create-source-format` fmt/check workflows for users, editors, and CI.
- 05f8226: Transfer byte-preserved design assets through bounded, atomic source RPC transactions.
- 07d8245: Preserve editable live rectangles and ellipses with exact parameters and atomic path expansion.
- 05f8226: Generalize bounded source comparison and selective Git commits with adapter-defined semantic change groups, and enable design-aware version control.
- f311815: Add explicit persistence, conflict, invalid-source, and crash-recovery workflows with accessible controls.
- 76d6aa0: Add shared revisioned source RPC infrastructure and source-backed create-design workspaces with atomic persistence and reliable live editor synchronization, including active glyph restoration after external filesystem resets. Run both editors and their APIs from the root development command on a configurable four-port block, with the checked-in Workbench Poster as create-design's default development source.
- 0bdcb56: Separate authored geometry, object transforms, and optional fill/stroke appearance while preserving legacy path objects.
- 4b938c1: Add a deterministic directory-shaped create-design source codec with indexed document, palette, artboard, layer, object, asset, and font boundaries.
- Updated dependencies [2b737a0]
- Updated dependencies [d607691]
- Updated dependencies [0d59cb3]
- Updated dependencies [05f8226]
- Updated dependencies [07d8245]
- Updated dependencies [05f8226]
- Updated dependencies [76d6aa0]
- Updated dependencies [0bdcb56]
- Updated dependencies [4b938c1]
- Updated dependencies [9e5ee6c]
  - @create-font/editor@0.7.10
  - @create-art/vector-geometry@0.0.1
  - @create-design/source@0.2.0
  - @create-art/source-rpc@0.1.1

## 0.1.2

### Patch Changes

- f8badaf: Compile PDFs incrementally and add an opt-in live PDF proof with stale-result protection.

## 0.1.1

### Patch Changes

- 38e7d82: Share Konva canvas foundations and move the create-design canvas to Konva.
- e354211: Add shared font and design vector adapters with a neutral clipboard interchange boundary. Complete create-design Pen authoring with hard and smooth nodes, live Bézier handles, open and closed contour finalization, atomic undo and redo, and persisted vector objects. Defer the create-design Rule tool until it has a complete design-specific interaction.
- 13eda7d: Add shared authoritative vector gesture state machines and interactive scene components for font and design editing, including complete Pen drafts, Bézier handles, cancellation, shape placement, selection, and coordinate-correct transforms in both y-up and y-down canvases. Keep create-design persistence and history in its document adapter while deferring its Rule tool, and preserve create-font's responsive native Pen transactions and unselected preview marker. Add an issue-linked create-font tool itinerary, mounted interaction-lifecycle regressions, and CI-enforced Vitest coverage floors for the font-tool surface. Keep Pen commits responsive by using shallow revision dependencies for mounted font projections, compiling live fonts only while a Preview tile is present, coalescing whole-source persistence after an edit burst, and moving post-save full-font validation into an incremental source worker so edits do not block the renderer. Restore Shift-marquee selection inversion so every covered node or handle toggles its prior selection state, fully select pasted contours including their authored handles, and keep selected-contour fills, outlines, nodes, and screen-constant selection rings aligned with the pointer while controlled Konva nodes rerender. Let the full-width invisible edge hit target initiate the same selected-contour drag as the visible stroke.
- 216946d: Let applications provide tile registries so font and design editors share workspace tiling behavior, and migrate create-design's complete tool and inspector UI into managed tiles.
- Updated dependencies [38e7d82]
- Updated dependencies [e354211]
- Updated dependencies [13eda7d]
- Updated dependencies [216946d]
  - @create-font/editor@0.7.9
  - @create-font/preact-konva@0.1.1
