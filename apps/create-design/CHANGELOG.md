# create-design

## 0.2.1

### Patch Changes

- a731f3b: Port the browser editors from Preact and the local Konva adapter to React 19 and react-konva.
- Updated dependencies [a731f3b]
- Updated dependencies [8935808]
  - @create-design/editor@0.2.0

## 0.2.0

### Minor Changes

- a5c4e14: Replace the singleton page with ordered named artboards and deterministic legacy migrations.

### Patch Changes

- 8af2cfe: Add deterministic alignment, distribution, and inspector-backed numeric selection transforms.
- 7205533: Keep create-design rulers clear of tile lanes and theme the canvas for system appearance.
- 7471aca: Add hierarchy-safe Pathfinder Divide, Trim, Merge, Crop, and Outline commands
  with off-thread progress, cancellation, and stale-result protection.
- 8188be2: Separate the create-design browser editor from its CLI and server package,
  move shared editor foundations under create-art ownership, and make font-owned
  package directories explicit throughout the workspace. Move the product-neutral
  Preact Konva bindings into the product-neutral `@create-art` scope. Put
  canonical document initialization in the source package and extract headless
  design-model and PDF packages for browser and CLI consumers. Keep the
  fea-rs-wasm build and benchmark scripts runnable from their scoped directory.
- 93afa43: Author optional fill and stroke paints from one accessible Appearance tile, including none, swap, mixed selections, and new-object defaults.
- 7390b70: Add shared tile control primitives and split create-design's Object, Transform,
  and Arrange inspectors into focused tiles. Keep their control layouts stable
  across selection states, use disabled controls for unavailable actions, and use
  a single pressed-button treatment for constrained proportions.
- 8ed890a: Add deterministic Pathfinder Intersect and Exclude operations.
- c852f02: Declare the repository's MPL library boundary and AGPL application boundary, with explicit permissions for generated assets.
- 16e86cb: Add persistent rulers and guides with configurable multi-source smart snapping.
- 151d54a: Expand visible strokes into deterministic compact cubic fill contours with complete cap, join, miter, dash, transform, and atomic undo support.
- 3cbad6c: Add deterministic Pathfinder Unite and Subtract Front over editable filled regions.
- efd3b76: Add full stroke appearance authoring, painted geometry interactions, and faithful vector output.
- 04104e8: Add in-editor semantic source review, ref comparisons, and guarded selective commits.
- 800f506: Add selection-aware path cleanup, joining, winding, and compound-path commands.
- 8188be2: Add robust headless PDF export to the create-design CLI with artboard and bleed selection, shared preflight diagnostics, and atomic no-clobber output.
- d06441e: Preserve global document coordinates when pasting design artwork and add an explicit offset duplicate command.
- 306063e: Add strict versioned design-document decoding and deterministic v1-to-v2 migration.
- 932b362: Add deterministic shared export preflight diagnostics, blocking only unsupported output while keeping warnings and opt-in advisories non-blocking.
- ad3427b: Export ordered artboard scopes as deterministic clipped multi-page PDFs with bleed and generation-safe preview/downloads.
- 7471aca: Add hierarchy-safe groups, compound paths with authored fill rules, and atomic stacking commands.
- dd3321b: Add persistent nested artwork groups with atomic selection, movement, duplication,
  group, ungroup, and stacking commands plus explicit group-content drill-down.
  Shared vector contours now expose the renderer's existing double-click and
  double-tap activation events for group drill-down.
- 08c4074: Refine the create-design shell with source-aware navigation, consolidated canvas status, contextual help, and accessible live announcements.
- 41e85b8: Establish global document coordinates and stable vector identities.
- a102f75: Add atomic artboard creation, editing, canvas gestures, and accessible navigation.
- abea7a8: Add multi-object transforms and direct vector control selection.
- Updated dependencies [8188be2]
- Updated dependencies [a5c4e14]
- Updated dependencies [c852f02]
- Updated dependencies [16e86cb]
- Updated dependencies [efd3b76]
- Updated dependencies [306063e]
- Updated dependencies [7471aca]
- Updated dependencies [dd3321b]
- Updated dependencies [41e85b8]
  - @create-design/editor@0.1.1
  - @create-design/pdf@0.1.1
  - @create-design/source@0.3.0
  - @create-art/source-rpc@0.1.2

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
