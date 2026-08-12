# `@create-design/editor`

The Export tile provides deterministic PDF and SVG downloads plus opt-in live
proofs of both generated artifacts. SVG import maps the source `viewBox` into
the active artboard, allocates fresh object/group/swatch identities, and commits
the complete supported import as one undoable document transaction. Unsupported
text, masks, filters, gradient paint, and external resources remain visible as
diagnostics instead of being silently deleted or rasterized.

The create-design browser editor. It owns canvas and selection behavior,
browser PDF/SVG interaction, editor UI, and the browser mounting API. Headless
document operations live in [`@create-design/model`](../model/README.md), PDF
compilation lives in [`@create-design/pdf`](../pdf/README.md), SVG interchange
lives in [`@create-design/svg`](../svg/README.md), and the canonical
document contract lives in [`@create-design/source`](../source/README.md).

## Pen and path editing

The Pen tool finishes an open draft with **Enter**, **Escape**, a double-click
at the last point, or a switch to another enabled tool. Clicking the first
point after at least three authored points closes the contour instead. Direct
Selection can delete individual nodes or non-adjacent node sets: surviving
connected runs remain in the same object as open contours, with unused endpoint
handles removed. Deleting every node removes the empty object from its
hierarchy.

## Layers and hierarchy

The Layers tile shows topmost-first layers with nested groups and objects. A
layer row is also the artwork target: selecting it makes subsequent drawing,
paste, import, blend expansion, and other authored insertions land in that
layer. Selecting artwork on the canvas or in the tree retargets its owning
layer. The target layer is per-user editor state and is not written to source.
Each layer also owns one of twelve authored UI colors. Its tree marker and the
outline plus faint selection fill of its objects use that color; a selection
spanning layers retains per-object colors while its aggregate bounds remain
neutral. The in-progress marquee is always neutral because it has no target
layer yet. These colors are editor metadata and never artwork paint.

Layer visibility and locking are inherited effective state. Hidden layers do
not render, hit-test, snap, preview, or export. Locked layers still render and
export, but their descendants are interaction-transparent and cannot be
mutated. The footer explains a rejected paste, hierarchy move, or other edit
and names the layer that must be shown or unlocked; descendant authored flags
are never rewritten by a layer toggle.

Drag an object or complete group onto a layer or group to move it to that
container's top, or onto an object to place it immediately above that object.
The selected hierarchy unit also exposes a parent selector plus **Move to
top**, **Move up**, and **Move down** controls as the keyboard and screen-reader
equivalent. Moves preserve IDs, geometry, transforms, and appearance, reject
cycles and unavailable destinations before mutation, and commit as one undo
step. Ordinary Bring/Send commands remain local to the current parent; only an
explicit hierarchy move crosses a group or layer boundary.

The `create-design` application supplies filesystem-backed source sessions and
serves the built browser artifact. Neither the source service nor the headless
model and export packages depend on this editor package.

## Live blend workflow

1. With Select, choose exactly two visible, unlocked, topology-compatible
   objects (Shift-click the second object in Layers or on the canvas).
2. Use **Make Blend** in the Blend tile or Command Palette. Five derived steps
   appear immediately; selecting any derived step selects the live blend as one
   unit.
3. In the Blend tile, edit **Specified steps**, reverse either unlocked path
   endpoint, or choose a closed contour's corresponding first point. The canvas
   and diagnostics update live, and each committed control action is one undo
   entry.
4. Choose **Expand Blend** to replace the live record with fresh, selected,
   ordinary path intermediates. Expansion deliberately retains both endpoint
   objects and inserts the intermediates immediately before the later-painted
   endpoint, matching live projection order.
5. Undo once to restore the exact live blend and correspondence options. Save
   and reload to verify the blend remains live; copy/paste a selected blend to
   verify its endpoints and swatches receive fresh identities.

The editor reports incompatible contour/point counts, direction, fill rule,
paint, and stroke-style conditions instead of resampling or silently changing
topology. First-point and direction controls are available only for ordinary
unlocked path endpoints.

Each mounted editor owns an ephemeral atom.io `Silo`. Authored document state is
normalized into ID-index atoms and keyed families for artboards, layers,
swatches, objects, groups, guides, contours, and points. Read-only selectors compose those
facts upward into entity and `DesignDocument` projections at the UI, source RPC,
and persistence boundaries; there is no monolithic document atom.

The authored atoms and families share one atom.io timeline, which the React UI
controls through `useTL`. A timeline effect retains the latest 100 complete undo
steps with `cullUndoSteps(100)`; multi-fact transaction checkpoints are never
split. Loading, resetting, or recovering a document reconciles the normalized
graph and rebases the timeline after the document and persistence transition
complete together.
