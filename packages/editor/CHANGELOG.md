# @create-font/editor

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
