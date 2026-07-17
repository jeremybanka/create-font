# @create-font/editor

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
