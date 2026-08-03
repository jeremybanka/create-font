# `@create-design/editor`

The create-design browser editor. It owns canvas and selection behavior,
browser PDF interaction, editor UI, and the browser mounting API. Headless
document operations live in [`@create-design/model`](../model/README.md), PDF
compilation lives in [`@create-design/pdf`](../pdf/README.md), and the canonical
document contract lives in [`@create-design/source`](../source/README.md).

The `create-design` application supplies filesystem-backed source sessions and
serves the built browser artifact. Neither the source service nor the headless
model and export packages depend on this editor package.
