# @create-font/states

## 0.6.8

### Patch Changes

- c852f02: Declare the repository's MPL library boundary and AGPL application boundary, with explicit permissions for generated assets.
- Updated dependencies [8ed890a]
- Updated dependencies [c852f02]
- Updated dependencies [151d54a]
- Updated dependencies [3cbad6c]
- Updated dependencies [7471aca]
  - @create-art/vector-geometry@0.0.2
  - @create-font/server@0.2.3
  - @create-font/target@0.0.3

## 0.6.7

### Patch Changes

- c5b4ace: Back create-font cubic evaluation, subdivision, and bounds with the shared vector geometry kernel while preserving the existing states API contracts.
- 76d6aa0: Add shared revisioned source RPC infrastructure and source-backed create-design workspaces with atomic persistence and reliable live editor synchronization, including active glyph restoration after external filesystem resets. Run both editors and their APIs from the root development command on a configurable four-port block, with the checked-in Workbench Poster as create-design's default development source.
- Updated dependencies [d607691]
- Updated dependencies [05f8226]
- Updated dependencies [76d6aa0]
  - @create-art/vector-geometry@0.0.1
  - @create-font/server@0.2.2

## 0.6.6

### Patch Changes

- 13eda7d: Add shared authoritative vector gesture state machines and interactive scene components for font and design editing, including complete Pen drafts, Bézier handles, cancellation, shape placement, selection, and coordinate-correct transforms in both y-up and y-down canvases. Keep create-design persistence and history in its document adapter while deferring its Rule tool, and preserve create-font's responsive native Pen transactions and unselected preview marker. Add an issue-linked create-font tool itinerary, mounted interaction-lifecycle regressions, and CI-enforced Vitest coverage floors for the font-tool surface. Keep Pen commits responsive by using shallow revision dependencies for mounted font projections, compiling live fonts only while a Preview tile is present, coalescing whole-source persistence after an edit burst, and moving post-save full-font validation into an incremental source worker so edits do not block the renderer. Restore Shift-marquee selection inversion so every covered node or handle toggles its prior selection state, fully select pasted contours including their authored handles, and keep selected-contour fills, outlines, nodes, and screen-constant selection rings aligned with the pointer while controlled Konva nodes rerender. Let the full-width invisible edge hit target initiate the same selected-contour drag as the visible stroke.

## 0.6.5

### Patch Changes

- Updated dependencies [fbd5a2f]
  - @create-font/server@0.2.1

## 0.6.4

### Patch Changes

- 475f2f7: Replace SharedWorker source coordination with server-authoritative ordered unit deltas, direct revision-guarded writes, snapshot recovery, and faster dirty-edit persistence.
- Updated dependencies [475f2f7]
  - @create-font/server@0.2.0

## 0.6.3

### Patch Changes

- 6601452: Keep live font previews updating by freezing incompatible glyphs to their default master while preserving strict export validation.
- e610e37: Add persisted glyph measuring rules, derived one-dimensional form and counterform measures, and the Rule canvas tool.

## 0.6.2

### Patch Changes

- 5ff7ace: Add persisted pair kerning, canvas editing controls, and conventional GPOS Pair Adjustment compilation.
- f87a70c: Compile live editor fonts and render Preview tiles through managed browser FontFace resources.
- 04000ab: Compile Adobe feature sources into GSUB tables and apply enabled substitutions in the Canvas preview.
- Updated dependencies [5ff7ace]
- Updated dependencies [04000ab]
  - @create-font/target@0.0.2

## 0.6.1

### Patch Changes

- Updated dependencies [ed751e8]
  - @create-font/server@0.1.1

## 0.6.0

### Minor Changes

- 9f0fe7d: Store outlines independently per master, migrate v3/v4 shared topology to the
  v5 source model, validate interpolation compatibility explicitly, preserve
  authored paths during export, and add master comparison plus path-order tools.

## 0.5.0

### Minor Changes

- a325bed: Add a point-cut Knife tool and explicit drag-end joining for open contour endpoints, backed by atomic multi-master topology transactions.
- 7dfefd2: Add Rect and Ellipse outline tools with constrained square and circle gestures,
  multi-master projection, and atomic complete-contour history edits.

### Patch Changes

- b64038b: Move every selected outline node together during keyboard nudges, including repeated and modified Arrow presses.
- 829bcd6: Constrain Select handle drags, nudge selected handles, and slide soft nodes along fixed tangent controls.
- 585a2af: Toggle every eligible selected outline node between hard and soft in one atomic Enter action.

## 0.4.0

### Minor Changes

- 7c44ab6: Add modifier-aware Bézier Pen constraints, context-aware pointer-aligned drag-out handles, and atomic bidirectional endpoint handle authoring with clear replacement previews, drawing-direction-aware single-node path resumption, and click-to-harden dangling-handle cancellation for open contours.

### Patch Changes

- d2446a5: Support reversing open contours and add atomic horizontal and vertical path inversion actions.

## 0.3.0

### Minor Changes

- f51bcf5: Add the revision-consistent `SourceProjectSnapshot` service contract and version
  4 bulk snapshot RPC. Switch the editor SharedWorker to load and refresh every
  validated source unit through one atomic snapshot request while preserving the
  legacy manifest and individual-unit endpoints.

  Add correlated browser, SharedWorker, and filesystem source-service startup
  instrumentation, a reproducible profiling workflow, and measured development
  and production baselines.

- 0de6bd8: Visualize non-overlapping vertical-metric overshoot bands and distinguish exact
  metric-line alignment from overshoot-only alignment with canonical state
  classifiers and dedicated canvas halos.

### Patch Changes

- Updated dependencies [f51bcf5]
  - @create-font/server@0.1.0

## 0.2.0

### Minor Changes

- 4541636: Add conventional cubic Bézier Pen gestures with click-drag handle creation,
  curve previews, pointer capture, contour closure, and atomic multi-master state
  updates.
- 4541636: Add portable outline copy and paste for nodes, handles, and contours across
  glyphs, browser tabs, and windows, with atomic multi-master state updates.
- 4541636: Add Option/Alt-click conversion of straight segments into curves with
  one-third-length handles and atomic multi-master editing history.

### Patch Changes

- Updated dependencies [84cccb3]
  - @create-font/server@0.0.1
  - @create-font/target@0.0.1

## 0.1.0

### Minor Changes

- 2abe981: Add precise glyph metrics, node and metric snapping, mixed-control alignment,
  transform-selection bounds, whole-path selection, Pen segment splitting, path
  reversal, and first-node editing with atomic Undo/Redo history.
- 2abe981: Add configurable per-metric overshoot zones and a shared vertical-metric model
  for source round trips, canvas guides, snapping, and node alignment halos.
