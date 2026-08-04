# @create-font/editor

## 0.9.0

### Minor Changes

- a731f3b: Port the browser editors from Preact and the local Konva adapter to React 19 and react-konva.

### Patch Changes

- Updated dependencies [a731f3b]
  - @create-art/editor@0.2.0

## 0.8.0

### Minor Changes

- 8188be2: Separate the create-design browser editor from its CLI and server package,
  move shared editor foundations under create-art ownership, and make font-owned
  package directories explicit throughout the workspace. Move the product-neutral
  Preact Konva bindings into the product-neutral `@create-art` scope. Put
  canonical document initialization in the source package and extract headless
  design-model and PDF packages for browser and CLI consumers. Keep the
  fea-rs-wasm build and benchmark scripts runnable from their scoped directory.

### Patch Changes

- 7205533: Keep create-design rulers clear of tile lanes and theme the canvas for system appearance.
- 7390b70: Add shared tile control primitives and split create-design's Object, Transform,
  and Arrange inspectors into focused tiles. Keep their control layouts stable
  across selection states, use disabled controls for unavailable actions, and use
  a single pressed-button treatment for constrained proportions.
- c852f02: Declare the repository's MPL library boundary and AGPL application boundary, with explicit permissions for generated assets.
- efd3b76: Add full stroke appearance authoring, painted geometry interactions, and faithful vector output.
- dd3321b: Add persistent nested artwork groups with atomic selection, movement, duplication,
  group, ungroup, and stacking commands plus explicit group-content drill-down.
  Shared vector contours now expose the renderer's existing double-click and
  double-tap activation events for group drill-down.
- Updated dependencies [8188be2]
- Updated dependencies [c852f02]
  - @create-art/editor@0.1.1
  - @create-font/states@0.6.8
  - @create-font/target@0.0.3

## 0.7.10

### Patch Changes

- 2b737a0: Expose a product-neutral source review surface with semantic row, navigation adapter, comparison, and guarded selective-commit hooks while preserving create-font glyph review and Diff View.

  Initialize create-font source review in an actionable empty state so the first
  HEAD-to-working comparison can be requested.

- 9e5ee6c: Keep editor tooltips compact by resetting browser popover inset constraints.
- Updated dependencies [c5b4ace]
- Updated dependencies [76d6aa0]
  - @create-font/states@0.6.7

## 0.7.9

### Patch Changes

- 38e7d82: Share Konva canvas foundations and move the create-design canvas to Konva.
- e354211: Add shared font and design vector adapters with a neutral clipboard interchange boundary. Complete create-design Pen authoring with hard and smooth nodes, live Bézier handles, open and closed contour finalization, atomic undo and redo, and persisted vector objects. Defer the create-design Rule tool until it has a complete design-specific interaction.
- 13eda7d: Add shared authoritative vector gesture state machines and interactive scene components for font and design editing, including complete Pen drafts, Bézier handles, cancellation, shape placement, selection, and coordinate-correct transforms in both y-up and y-down canvases. Keep create-design persistence and history in its document adapter while deferring its Rule tool, and preserve create-font's responsive native Pen transactions and unselected preview marker. Add an issue-linked create-font tool itinerary, mounted interaction-lifecycle regressions, and CI-enforced Vitest coverage floors for the font-tool surface. Keep Pen commits responsive by using shallow revision dependencies for mounted font projections, compiling live fonts only while a Preview tile is present, coalescing whole-source persistence after an edit burst, and moving post-save full-font validation into an incremental source worker so edits do not block the renderer. Restore Shift-marquee selection inversion so every covered node or handle toggles its prior selection state, fully select pasted contours including their authored handles, and keep selected-contour fills, outlines, nodes, and screen-constant selection rings aligned with the pointer while controlled Konva nodes rerender. Let the full-width invisible edge hit target initiate the same selected-contour drag as the visible stroke.
- 216946d: Let applications provide tile registries so font and design editors share workspace tiling behavior, and migrate create-design's complete tool and inspector UI into managed tiles.
- Updated dependencies [13eda7d]
  - @create-font/states@0.6.6

## 0.7.8

### Patch Changes

- ccd346e: Build and test the browser and server workflow with Node while retaining Bun runtime compatibility.
  - @create-font/states@0.6.5

## 0.7.7

### Patch Changes

- 475f2f7: Replace SharedWorker source coordination with server-authoritative ordered unit deltas, direct revision-guarded writes, snapshot recovery, and faster dirty-edit persistence.
- Updated dependencies [475f2f7]
  - @create-font/states@0.6.4

## 0.7.6

### Patch Changes

- 6601452: Keep live font previews updating by freezing incompatible glyphs to their default master while preserving strict export validation.
- e610e37: Add persisted glyph measuring rules, derived one-dimensional form and counterform measures, and the Rule canvas tool.
- 1f74d99: Allow whole-contour selection by double-clicking outline segments in Transform mode.
- Updated dependencies [6601452]
- Updated dependencies [e610e37]
  - @create-font/states@0.6.3

## 0.7.5

### Patch Changes

- 9ed0716: Keep glyph undo and redo active while editing an outline at a text caret.

## 0.7.4

### Patch Changes

- 0874e0d: Visualize native textarea selection ranges on the glyph canvas across lines and Unicode text.
- 7d0b55c: Allow marquee selection from outline helper targets and reduce point helper sizes while keeping segment targets forgiving.
- 5ff7ace: Add persisted pair kerning, canvas editing controls, and conventional GPOS Pair Adjustment compilation.
- f87a70c: Compile live editor fonts and render Preview tiles through managed browser FontFace resources.
- 04000ab: Compile Adobe feature sources into GSUB tables and apply enabled substitutions in the Canvas preview.
- eed4136: Add center-pivot rotation with Shift-based 15 degree snapping to the Transform tool.
- Updated dependencies [5ff7ace]
- Updated dependencies [f87a70c]
- Updated dependencies [04000ab]
  - @create-font/target@0.0.2
  - @create-font/states@0.6.2

## 0.7.3

### Patch Changes

- c3ababf: Keep tiled editor columns clear of the action hotbar, pass empty column space through to the canvas, and show measured scroll overflow edges.
- 6670af3: Support tangent-aware Alt/Option dragging for multi-node outline selections
- 07221ff: Paste single-layer outline copies across masters of the same glyph.
- c28c938: Initialize canvas views one-third into their first usable viewport.
- ae3d43e: Prevent loading-screen layout shift and remove obsolete diff overlays that collided with tile management controls.

## 0.7.2

### Patch Changes

- ed751e8: Add bounded Git snapshot comparison, visual diff review, and guided selective commits.
  - @create-font/states@0.6.1

## 0.7.1

### Patch Changes

- 9cc75e0: Add subtractive Shift-marquee selection and safe outline cutting with Mod-X.
- 613f9fb: Select paths from compatibility order and invert exact outline selections
- dde1031: Keep generated favicons in sync with live system color preference

## 0.7.0

### Minor Changes

- 8a36d1f: Add previous and next master commands with wrapping navigation and Action Hotbar support.

### Patch Changes

- 61e9d52: Render additive path overlaps correctly in Glyph Library previews.
- 61e9d52: Propagate Preview Tile color presets to rendered glyph foregrounds.
- 4f41584: Move one hard node with Alt or Option while keeping its authored handle endpoints fixed.

## 0.6.0

### Minor Changes

- 9f0fe7d: Store outlines independently per master, migrate v3/v4 shared topology to the
  v5 source model, validate interpolation compatibility explicitly, preserve
  authored paths during export, and add master comparison plus path-order tools.

### Patch Changes

- Updated dependencies [9f0fe7d]
  - @create-font/states@0.6.0

## 0.5.0

### Minor Changes

- a325bed: Add a point-cut Knife tool and explicit drag-end joining for open contour endpoints, backed by atomic multi-master topology transactions.
- 7dfefd2: Add Rect and Ellipse outline tools with constrained square and circle gestures,
  multi-master projection, and atomic complete-contour history edits.
- abbaed8: Allow editor number fields to evaluate and normalize basic arithmetic expressions when committed.

### Patch Changes

- b64038b: Move every selected outline node together during keyboard nudges, including repeated and modified Arrow presses.
- 80bcc77: Keep the Command Palette open while dragging multiple commands into hotbar slots.
- d946e2e: Coalesce Pen hover and drag previews to the latest input once per animation frame.
- 829bcd6: Constrain Select handle drags, nudge selected handles, and slide soft nodes along fixed tangent controls.
- 2a2f1eb: Draw rectangles and ellipses from their center and resize transform selections around their center while Alt or Option is held.
- 53cfdff: Add independent, vertically filling preview tiles with local proof text, samples, variation controls, typography sizing, and color presets.
- 716ccd1: Render open contours as thin strokes without implicitly filling or closing them.
- 585a2af: Toggle every eligible selected outline node between hard and soft in one atomic Enter action.
- Updated dependencies [b64038b]
- Updated dependencies [829bcd6]
- Updated dependencies [a325bed]
- Updated dependencies [7dfefd2]
- Updated dependencies [585a2af]
  - @create-font/states@0.5.0

## 0.4.0

### Minor Changes

- 4365720: Publish the editor as a standalone browser artifact and load it from create-font's production dependency instead of embedding it in the CLI bundle.
- 7c44ab6: Add modifier-aware Bézier Pen constraints, context-aware pointer-aligned drag-out handles, and atomic bidirectional endpoint handle authoring with clear replacement previews, drawing-direction-aware single-node path resumption, and click-to-harden dangling-handle cancellation for open contours.
- 6f81421: Add a responsive tiling workspace and a persistent, command-backed action hotbar to the canvas editor.

### Patch Changes

- adb48ef: Make canvas Up/Down navigation follow variable-width text lines with native selection semantics, and derive nullable glyph focus from the typing caret instead of defaulting inspector state to O.
- b4028b3: Keep pasted outlines selected, drag selected geometry from owned path segments, add a nine-origin selection dimensions tile with workspace-synchronized proportional scaling controls and command, and let the Command Palette trigger fill the available header space at narrow viewport widths.
- d2446a5: Support reversing open contours and add atomic horizontal and vertical path inversion actions.
- Updated dependencies [7c44ab6]
- Updated dependencies [d2446a5]
  - @create-font/states@0.4.0

## 0.3.0

### Minor Changes

- 2a4acc5: Add larger modifier-based numeric and node steps, explanatory disabled-control
  tooltips, tool-appropriate canvas cursors, and a hold-E momentary glyph preview.
- a5dc666: Make node, handle, and path selection and dragging more forgiving with
  deterministic, zoom-stable hit resolution and a 24-screen-pixel maximum target
  radius, and raise the canvas zoom limit to 1000%. Add an opt-in Visual Debug
  command that overlays the effective selection targets for nodes, handles, and
  paths.
- 0de6bd8: Visualize non-overlapping vertical-metric overshoot bands and distinguish exact
  metric-line alignment from overshoot-only alignment with canonical state
  classifiers and dedicated canvas halos.

### Patch Changes

- Updated dependencies [f51bcf5]
- Updated dependencies [0de6bd8]
  - @create-font/states@0.3.0

## 0.2.0

### Minor Changes

- 4541636: Add conventional cubic Bézier Pen gestures with click-drag handle creation,
  curve previews, pointer capture, contour closure, and atomic multi-master state
  updates.
- 4541636: Add portable outline copy and paste for nodes, handles, and contours across
  glyphs, browser tabs, and windows, with atomic multi-master state updates.
- 4541636: Add Option/Alt-click conversion of straight segments into curves with
  one-third-length handles and atomic multi-master editing history.
- 4541636: Add rigid multi-control dragging that snaps the selected group's edges and
  centers while preserving the selection's internal geometry.
- 4541636: Add straight-segment projection guides so dragged points can interpolate and
  extrapolate along the line shared with an adjacent node.
- 4541636: Add Shift-constrained horizontal and vertical movement for individual nodes,
  multi-node selections, and Pen placement, with live constraint guides.

### Patch Changes

- 4541636: Keep dragged node controls visually synchronized with their committed snapped
  outline positions.
- 4541636: Synchronize the visible canvas caret when keyboard navigation changes the
  selection in the editor's backing textarea.
- Updated dependencies [4541636]
- Updated dependencies [4541636]
- Updated dependencies [4541636]
  - @create-font/states@0.2.0

## 0.1.0

### Minor Changes

- 2abe981: Add precise glyph metrics, node and metric snapping, mixed-control alignment,
  transform-selection bounds, whole-path selection, Pen segment splitting, path
  reversal, and first-node editing with atomic Undo/Redo history.
- 2abe981: Add configurable per-metric overshoot zones and a shared vertical-metric model
  for source round trips, canvas guides, snapping, and node alignment halos.
- 2abe981: Add the polished source bootstrap, dynamic document title and font favicon,
  shortcut tooltips, SharedWorker validation, and entity-scoped editor rendering
  needed for responsive multi-tab editing and fast timeline actions.

### Patch Changes

- Updated dependencies [2abe981]
- Updated dependencies [2abe981]
  - @create-font/preact-konva@0.1.0
  - @create-font/states@0.1.0
