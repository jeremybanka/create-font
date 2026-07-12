# @trigraph/editor

`@trigraph/editor` is the first interactive client for the Trigraph font state
model. It is a Vite/Preact application with a small Glyphs-style workspace: a
live variable typing preview, concrete master layers, outline-node editing,
glyph navigation, an inspector, and document-scoped history.

The included document deliberately stays tiny. Both `.notdef` and `O` are a
geometric O with identical topology. The `wght` axis travels from a nearly
razor-thin counter at 100 to a nearly pitch-black counter at 900. Only U+004F
maps to `O`; every other character in the preview visibly exercises `.notdef`.

## Stack

- Vite+ runs Vite with the Preact preset. The application shell and all DOM UI
  are Preact; React 18 is reserved for two deliberately isolated canvas roots.
- `@trigraph/states` owns all editable font facts, its isolated atom.io Silo,
  transactions, selector graph, ingestion proof, and undo timeline.
- A small set of UI atoms lives in that same Silo: active glyph and master,
  preview text and axis coordinates, node selection, and node visibility.
- `react-konva` renders both canvas surfaces inside real React 18 islands
  mounted with `react-dom/client`. Plain props and declarative Konva shape
  descriptors are the only values that cross from Preact. This separation is
  required because react-konva's private reconciler cannot run on Preact
  compatibility internals.
- Lasertag supplies the structural CSS Modules convention and validation. Each
  exported component owns one sibling stylesheet and a matching custom root;
  its complete seven-rule ESLint plugin and CSS reachability check run in CI.

## State flow

The edit canvas subscribes to the active `glyphLayer` selector, so it always
shows one editable source master. Dragging keeps a temporary visual coordinate
locally, then commits one `movePoints` transaction on pointer release. That
keeps a full drag to one undo step. Arrow keys commit one- or ten-unit nudges.

The typing preview subscribes to solved `glyphSource` projections. It
normalizes the current user-space location, evaluates every OpenType support
region, and applies the solved `gvar` tuple deltas. It therefore shows real
interpolation, not a cross-fade or a nearest-master switch. Any master edit
invalidates both the editor layer and the preview through the shared atom.io
graph.

Immutable axes, cmap, glyph topology, names, and metrics are exposed once as
the workspace document structure. Components subscribe only to narrow atoms
and selectors. An edit to `.notdef`, for example, does not invalidate an `O`
preview. A tiny Preact-native adapter observes the custom Silo through its
public get, set, and subscribe methods; React is never mixed into the DOM UI.

Toolbar and keyboard history controls call the custom Silo's `undo()` and
`redo()` methods directly. The Preact timeline hook observes cursor metadata
without calling implicit-store helpers.

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

- Type into the preview and adjust every variation-axis control through the
  design space.
- Choose a master to edit its concrete layer; choose an instance to move the
  preview to that named location.
- Choose `.notdef` or `O`, then select and drag any on- or off-curve node.
- Focus the canvas and use bracket keys to traverse nodes, then arrow keys to
  nudge the selection. Hold Shift for ten font units.
- Use the toolbar, Command-Z / Shift-Command-Z, or Control-Z equivalents for
  undo and redo.

The layout hides the inspector first on narrower screens, then turns the left
navigator into a horizontal strip. Native controls retain keyboard focus
styles, the canvas exposes an application label and instructions, status is
communicated with text as well as color, and all icon-only buttons have names.
