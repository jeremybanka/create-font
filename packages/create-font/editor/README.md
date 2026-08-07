# @create-font/editor

`@create-font/editor` is the first browser client for the create-font font state
model. It exports the React `EditorApplicationRoot` consumed by the public
`create-font` application package. The Glyphs-style workspace centers on one
multiline text canvas. The same glyph occurrence that participates in the live
variable layout becomes the outline editor in place, alongside glyph navigation,
an inspector, and glyph-scoped history.

The included document deliberately stays tiny. Both `.notdef` and `O` are a
geometric O with identical topology. The `wght` axis travels from a nearly
razor-thin counter at 100 to a nearly pitch-black counter at 900. U+0041 maps
to a geometric `A` drawn with the editor's pen, and U+004F maps to `O`; every
other character in the preview visibly exercises `.notdef`.

## Stack

- The application shell and all DOM UI are React. Vite compiles the browser
  entry, TypeScript, JSX, global CSS, and CSS Modules for published assets and
  serves the same workspace sources during development.
- `@create-font/states` owns all editable font facts, its isolated atom.io Silo,
  transactions, selector graph, ingestion proof, and one undo timeline per
  glyph.
- A small set of UI atoms lives in that same Silo: active glyph and master,
  multiline text, caret and editing occurrence, axis coordinates, node
  selection, and node visibility.
- `react-konva` renders the unified canvas through the narrow renderer surface
  owned by `@create-art/editor`. That boundary registers only the Konva shapes
  shared by the product editors and preserves their full-size Stage host.
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
example, does not invalidate an `O` preview. The editor supplies its Silo to
atom.io's standard `StoreProvider` and uses its standard hooks directly in the
React UI. A conditional glyph-history component calls atom.io's streamlined
`useTL(family, glyphId)` overload only for a real active glyph. Kerning history
has its own component, while the no-history branch invokes no timeline hook.
Editor-owned revision bookkeeping stays at the undo and redo command
boundaries.

Each independently established interaction fact owns a narrow atom: selected
glyph, active and comparison masters, outline and rule selections, preview text,
caret and textarea selection, edit occurrence, active tool, and pathname.
Variation-axis preview coordinates use an atom family keyed by axis ID.
Selectors remain only for values derived from those facts, such as route,
active glyph, preview location, and active kerning pair. Coordinated commands
write the relevant atoms in atom.io transactions. Whole-source replacement
passes a validated tuple of those atom values into the font load transaction,
so document and interaction reconciliation share one rollback boundary.

Toolbar and keyboard history controls select the active glyph from the
workspace's timeline family with atom.io's `useTL`. Switching glyphs switches
timeline cursors without combining their edits.

## Run

From the workspace root:

```sh
pnpm --filter create-font dev
pnpm --filter @create-font/editor test
pnpm --filter @create-font/editor check
pnpm --filter @create-font/editor build
```

The editor is not a self-starting application. Its package build publishes
`dist/browser/editor.js` and `editor.css`. The `@create-font/editor/browser`
entry exposes `mountEditor`, `update`, and `unmount` through an imperative
boundary so this artifact owns its React root. `create-font` serves and
dynamically imports these files from its installed production dependency.

The initial slice intentionally has no inert save or export affordances. The UI
currently loads its self-contained `EditorFontSource` fixture and edits that
live state.

In the product architecture, this application is served by `create-font` from
the installed editor package beside the font repository. The same CLI process
owns project discovery, filesystem access,
watching, conditional persistence, compilation, and diagnostics. The browser
uses a versioned same-origin workspace protocol; it never receives arbitrary
filesystem or process access.

Local and remote workspaces use that same arrangement. For a remote repository,
the user runs the repository-local CLI through their normal SSH session and
forwards its loopback port to a local development browser. create-font does not
implement SSH or synchronize a second checkout. See the repository
[architecture](../../../docs/architecture.md) and
[roadmap](../../../docs/roadmap.md#3-workspace-server-and-browser-persistence).

## Shared tile controls

`@create-art/editor` exposes product-neutral tile controls for sibling
applications: `TileButton`, `TileButtonGroup`, `TileTextField`, `TileSelect`,
`TileCheckbox`, `TileNumericField`, and the lower-level `NumericInput`.
Applications keep tile layout and domain workflows locally, and compose these
controls for consistent focus, disabled, pressed, invalid, danger, compact,
light/dark, and forced-color states. Prefer `TileNumericField` for labeled
values: it keeps a draft until Enter or blur, accepts arithmetic, cancels with
Escape, and uses Arrow/Shift-Arrow/platform-modifier stepping without exposing
partial or invalid values to application state.

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
  the contour. Shift-drag constrains a new handle to 45° rays. Click or drag
  either loose endpoint to resume its contour; soft endpoints preserve the
  connected handle length and shared tangent, hard endpoints keep independent
  handles, and Option/Alt-drag breaks a soft tangent. Press V to return to
  Select.
- Use the + button in the glyph panel or Command/Control-Shift-N to add one or
  more space-separated glyph names. Enter confirms and Escape cancels.
- Drag an empty canvas region to box-select nodes and handle endpoints. Hold
  Command or Control to add controls to the existing selection, or hold Shift
  to remove enclosed controls from it. Shift wins when combined with Command or
  Control. Command/Control-A selects every visible node and handle.
- Command/Control-C, X, and V copy, cut, and paste selected outline nodes. Cut
  writes the same reusable outline payload as Copy before removing its source
  nodes; native text fields keep their normal clipboard behavior.
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
- Press Shift-Space to enter the separate tile-management mode. Columns 1 and
  2 belong to the left edge; columns 3 and 4 belong to the right. Use 1–4 to
  select a column, J/K to select a tile, Shift-J/K to reorder, M then 1–4 to
  move, A then T/B to pack a column, N to focus the tile pool, C to toggle a
  column, F to give a tile fill affinity, X to remove a tile, and S to
  explicitly save the workspace. R reverts to the explicitly saved layout;
  Delete and Backspace remain removal aliases. Click a column heading to
  collapse it at any time, or its compact heading to expand it. Tile-management
  undo and redo remain separate from font editing history.
- The tile pool is visible throughout management mode. Its entries can be
  clicked into the selected column or dragged to any numbered column target;
  existing tiles can likewise be dragged between columns. Unsaved layout edits
  are recovered locally after a reload without being treated as an explicit
  save.
- The canvas toolbar is itself a tile in column 3. Its design-space, zoom, and
  node-visibility controls share ephemeral viewport state with the canvas, so
  cloned toolbar instances remain synchronized. Saved version-one layouts are
  migrated with one toolbar instance automatically; after migration it can be
  moved, cloned, or removed like any other tile.
- Turn on the curvature comb while editing to see a color-mapped perpendicular
  visualization of cubic curvature. Gain controls its height, opacity controls
  its fill, and Side switches between the contour-oriented outside view and
  signed curve normals. The visualization updates with every live node and
  handle gesture. Use Command/Control-Shift-X to toggle it from the canvas or
  command palette.

The canvas always spans the application beneath the tiled panes. Four stable
logical columns page through one to four available edge slots as the viewport
widens, with odd slot counts favoring the right side. Native controls retain
keyboard focus styles, the canvas exposes an application label and
instructions, status is communicated with text as well as color, and all
icon-only buttons have names. The dark palette is the default token set; a
system light-mode preference activates the original light palette, including
the Konva canvas.
