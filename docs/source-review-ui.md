# Source review UI boundary

Issue #311 evaluated the create-font Version Control tile after comparison and
selective commits became product-neutral in `@create-art/source-rpc`.

## Decision

Share a **source review surface**, not a universal Version Control tile.

The shared boundary in `@create-art/editor` owns:

- UI-facing comparison endpoints and semantic change rows;
- comparison loading, unavailable, empty, and error presentation;
- reference inputs;
- change counts and adapter-provided review actions;
- coherent-group selection and deduplicated commit paths;
- the two-step commit/message flow, optimistic comparison identity, error
  retention, and dialog focus behavior; and
- extension points for product row rendering, review navigation, and adjacent
  product controls.

Applications own their registered tile wrapper and supply a
`SourceReviewAdapter`. The adapter decides whether and how a semantic row is
reviewable; shared code treats `kind` as an open string and never switches on
glyph, object, palette, artboard, asset, or another product concept.

create-font keeps a font-specific comparison type that adds
`EditorFontSource` snapshots to the product-neutral endpoints. Its adapter
recognizes glyph rows, calls the existing focused glyph navigation, and leaves
source-only rows non-navigable. The font tile wrapper owns the Diff View toggle,
while the glyph canvas continues to render font snapshots. create-design can
use the same surface with design semantic rows and its own navigation adapter
in #312; no create-design tile is registered by this change.

## Rejected alternatives

### One universal tile with product-kind cases

Rejected because a global kind union would make shared code depend on every
application and would immediately reintroduce the glyph/object branching that
the source RPC removed. Product navigation and visual comparison do not have a
single meaningful implementation.

### Move the complete create-font tile unchanged

Rejected because the existing component coupled durable commit behavior to
`GlyphId`, `onReviewGlyph`, and a glyph-only Diff View toggle. Renaming that
component would not create a reusable boundary.

### Share types and a hook, duplicate all presentation

Rejected because comparison states, semantic-row accessibility, coherent
selection, commit error retention, and dialog focus are durable interaction
behavior. Duplicating them in #312 would invite drift. Product wrappers still
retain presentation and workflow controls that are genuinely product-owned.

### Put editor snapshots in the shared comparison contract

Rejected because design and font snapshots have unrelated shapes and are not
needed by review and commit controls. Snapshot-bearing endpoints remain a
create-font extension used only by glyph review and Diff View.
