# `@create-design/editor`

The create-design browser editor. It owns canvas and selection behavior,
browser PDF interaction, editor UI, and the browser mounting API. Headless
document operations live in [`@create-design/model`](../model/README.md), PDF
compilation lives in [`@create-design/pdf`](../pdf/README.md), and the canonical
document contract lives in [`@create-design/source`](../source/README.md).

The `create-design` application supplies filesystem-backed source sessions and
serves the built browser artifact. Neither the source service nor the headless
model and export packages depend on this editor package.

Each mounted editor owns an ephemeral atom.io `Silo`. Authored document state is
normalized into ID-index atoms and keyed families for artboards, swatches,
objects, groups, guides, contours, and points. Read-only selectors compose those
facts upward into entity and `DesignDocument` projections at the UI, source RPC,
and persistence boundaries; there is no monolithic document atom.

The authored atoms and families share one atom.io timeline, which the React UI
controls through `useTL`. A timeline effect retains the latest 100 complete undo
steps with `cullUndoSteps(100)`; multi-fact transaction checkpoints are never
split. Loading, resetting, or recovering a document reconciles the normalized
graph and rebases the timeline after the document and persistence transition
complete together.
