# @create-font/states

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
