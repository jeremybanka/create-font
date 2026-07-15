# @trigraph/editor

`@trigraph/editor` is the first interactive client for the Trigraph font state
model. It is a Vite/Preact application with a Glyphs-style workspace centered
on one multiline text canvas. The same glyph occurrence that participates in
the live variable layout becomes the outline editor in place, alongside glyph
navigation, an inspector, and glyph-scoped history.

The included document deliberately stays tiny. Both `.notdef` and `O` are a
geometric O with identical topology. The `wght` axis travels from a nearly
razor-thin counter at 100 to a nearly pitch-black counter at 900. U+0041 maps
to a geometric `A` drawn with the editor's pen, and U+004F maps to `O`; every
other character in the preview visibly exercises `.notdef`.

## Stack

- Vite+ runs Vite with the Preact preset. The application shell and all DOM UI
  are Preact; React 18 is reserved for the deliberately isolated canvas root.
- `@trigraph/states` owns all editable font facts, its isolated atom.io Silo,
  transactions, selector graph, ingestion proof, and one undo timeline per
  glyph.
- A small set of UI atoms lives in that same Silo: active glyph and master,
  multiline text, caret and editing occurrence, axis coordinates, node
  selection, and node visibility.
- `react-konva` renders the unified canvas inside a real React 18 island
  mounted with `react-dom/client`. Plain props and declarative Konva shape
  descriptors are the only values that cross from Preact. This separation is
  required because react-konva's private reconciler cannot run on Preact
  compatibility internals.
- Lasertag supplies the structural CSS Modules convention and validation. Each
  exported component owns one sibling stylesheet and a matching custom root;
  its complete seven-rule ESLint plugin and CSS reachability check run in CI.

## State flow

The canvas lays out solved `glyphSource` projections and explicit line breaks
in font units. An invisible native textarea owns text input and selection while
Konva renders the actual glyphs and virtual caret. Scrolling pans the world;
Command/Control/Option/Alt-wheel and toolbar controls zoom about a stable focal
point.

Double-clicking one positioned glyph occurrence changes only the interaction
mode: that occurrence is replaced in place by the active master's high-level
cubic `layerNode` projection. Nodes own relative incoming and outgoing handles.
Dragging keeps a temporary node or handle position locally, then commits one
`movePoints` or `moveHandle` transaction on pointer release. Escape removes the
editing target and restores textarea focus and the virtual caret.

Axes, names, and metrics are exposed through the workspace document structure;
the glyph list and cmap can grow through the add-glyph dialog. Components
subscribe only to narrow atoms and selectors. An edit to `.notdef`, for
example, does not invalidate an `O` preview. A tiny Preact-native adapter
observes the custom Silo through its public get, set, and subscribe methods;
React is never mixed into the DOM UI.

Toolbar and keyboard history controls select the active glyph from the
workspace's timeline family and call the custom Silo's `undo()` and `redo()`
methods directly. Switching glyphs switches timeline cursors without combining
their edits.

## Run

From the workspace root:

```sh
pnpm --filter @trigraph/editor dev
pnpm --filter @trigraph/editor test
pnpm --filter @trigraph/editor check
pnpm --filter @trigraph/editor build
```

The initial slice intentionally has no inert save or export affordances. A
server-backed source workflow will provide persistence later; the UI currently
loads its self-contained `EditorFontSource` fixture and edits that live state.

## Interaction

- Type directly into the multiline canvas and adjust every variation-axis
  control through the design space.
- Scroll or trackpad-pan around the text; use Command/Control/Option/Alt-wheel
  or the toolbar to zoom.
- Double-click a positioned glyph to replace that occurrence with its editable
  outline. Press Escape to clear the target and resume typing at its position.
- Choose a master to edit its concrete layer; choose an instance to move the
  preview to that named location.
- Once an occurrence is being edited, drag a node or either of its anchored
  Bézier handles in one gesture.
- Choose Pen in the floating toolbar (or press Q), click to place hard corner
  nodes, and click the first node after placing at least three points to close
  the contour. Press V to return to Select.
- Use the + button in the glyph panel or Command/Control-Shift-N to add one or
  more space-separated glyph names. Enter confirms and Escape cancels.
- Drag an empty canvas region to box-select nodes and handle endpoints. Hold
  Shift, Command, or Control to add controls to the existing selection;
  Command/Control-A selects every visible node and handle.
- Delete or Backspace removes selected handles independently and removes
  selected nodes while keeping their contours closed. Hold Option/Alt while
  deleting nodes to split the remaining regions into open, loose-ended paths;
  with a selected handle, it removes the adjoining segment and breaks or splits
  the path there.
- Switch a selected node between Soft (collinear handles) and Hard (independent
  or one-sided handles) in the inspector.
- Double-click a node, or press Enter while it is selected, to toggle Soft and
  Hard directly in the canvas. Soft nodes are circles; interior Hard nodes are
  squares. Open-path endpoints are short bars normal to their path tangent.
- Editor contours are intentionally unfilled. The triangular first node marks
  each contour's direction.
- Focus the canvas and use bracket keys to traverse nodes, then arrow keys to
  nudge every selected node. Hold Shift for ten font units.
- Use the toolbar, Command-Z / Shift-Command-Z, or Control-Z equivalents for
  undo and redo.

The layout hides the inspector first on narrower screens, then turns the left
navigator into a horizontal strip. Native controls retain keyboard focus
styles, the canvas exposes an application label and instructions, status is
communicated with text as well as color, and all icon-only buttons have names.
The dark palette is the default token set; a system light-mode preference
activates the original light palette, including the Konva canvas.
