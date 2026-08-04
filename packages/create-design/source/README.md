# @create-design/source

`@create-design/source` owns the deterministic source boundary for
`create-design`. It exposes the current complete `DesignDocument` model and a
repository-native directory codec that splits independently editable facts
into validated JSON units.

## Complete document versions

Complete documents use a strict, version-dispatched codec. Version five is the
current schema. It replaces v4's singleton global page with a nonempty ordered
`artboards` collection. Each artboard persists a stable ID, display name,
global `{ x, y, width, height }` rectangle, and optional nonnegative
`bleed`/`safeArea` edge insets. Array order is canonical output order; active
artboard state is deliberately absent from the document.
`decodeDesignDocument()` accepts complete version-one through version-four
documents and deterministically migrates them to v5. Every legacy page becomes
the single equivalent `artboard:page` named `Artboard 1`. Existing object IDs,
global coordinates, geometry, transforms, and appearance are preserved.
Missing v1/v2 path IDs are derived from the owning object and source order, and
their artboard receives the legacy implicit origin `(0, 0)`. Prior width-only
strokes receive the renderer-neutral butt cap, miter join, miter limit 4, and
solid-dash defaults. The v1 decoder continues to accept both shipped object forms:
canonical geometry/transform/appearance objects are migrated, while older
`{ contours, fillId }` objects become path geometry with an identity transform
and fill appearance.
`validateDesignDocument()` validates only the current version, while
`parseDesignDocumentText()` additionally owns JSON decoding.

Malformed, partial, and future-version inputs fail with field-located
diagnostics. Callers must retain their last valid document when decoding fails;
`createInitialDocument()` provides the canonical new-authoring default shared
by browser and headless callers, while version-specific migration defaults
remain internal to the codec.

## Coordinate and identity contract

Canonical geometry lives in one unbounded global document plane measured in
points. X increases right and Y increases down. Object geometry is local to its
object and reaches the global plane only through the object's persisted affine
`transform`. Artboards are independent named rectangles in that plane;
ordinary objects are not artboard children. Artwork may intersect several
artboards or none. Adding, moving, resizing, renaming, or reordering an
artboard must therefore never rewrite object geometry or transforms. Guides
use the same global axis values.

Canvas world coordinates are identical to document coordinates; pan and zoom
are view-only transforms. Native create-design clipboard objects remain in the
global Y-down plane. Shared create-* vector and font-outline clipboard payloads
use an artboard-independent Cartesian Y-up plane, so their boundary conversion
is `(x, y) -> (x, -y)` for points and vectors. PDF lowering derives a
page-local, bottom-left Y-up transform from the selected artboard:
`[1 0 0 -1 -artboard.x artboard.y+artboard.height]`. These clipboard and PDF
transforms, including any deliberate paste offset, are projections and never
canonical geometry mutations.

Object IDs are document-wide. Contour and point IDs are required and unique
within their owning object. Edits preserve every unaffected identity. Copying
or deriving a distinct object assigns a new object ID and new path IDs;
transforming, renaming, restyling, reordering, editing an artboard, or
projecting to canvas/PDF does not. This is the foundation expected by
multi-selection work in #254 and global multi-artboard/output work in #283.

## Version-three directory

The third directory version matches the current application model: ordered
artboards, one layer, authored path/rectangle/ellipse geometry,
independent affine object transforms, optional fill/stroke appearance, one
palette, structural groups, and empty asset and font inventories. Path geometry
may persist an explicit `nonzero` or `evenodd` fill rule; omitted legacy rules
retain the original even-odd rendering behavior.

```text
create-design.json
document.json
palette.json
artboards/
  index.json
  page.json
scene/
  layers/
    index.json
    artwork.json
  groups/
    index.json
  objects/
    index.json
    <indexed path>.json
    <indexed path>.txt  # one adjacent raw unit per live-text object
assets/
  index.json
fonts/
  index.json
```

Each fact has one owner:

- `document.json` owns the title, guides, and live blend records;
- `palette.json` owns ordered swatches;
- the ordered artboard inventory owns output order and maps each stable ID to
  an independent unit that owns its name, global rectangle, and optional
  bleed/safe-area metadata;
- the sole layer unit owns root stacking order;
- each group unit owns its ordered object or nested-group children;
- the object inventory maps stable object IDs to stable source paths; and
- each object JSON owns geometry, typography, frame, transform, and appearance;
  for a live-text object its durable `geometry.contentPath` references the
  exactly adjacent `.txt` unit that owns the authored characters.

For example, `object:headline` has a deterministic safe adjacent pair such as
`scene/objects/object%3Aheadline~72f07290.json` and
`scene/objects/object%3Aheadline~72f07290.txt`. The raw unit is UTF-8 text, not
JSON: it has no quoting or wrapper, receives no automatic terminal newline,
and preserves authored LF, CRLF, lone CR, whitespace-only/empty content, bidi
text, Unicode scalars, and terminal newlines. Writers do not add a transport
BOM; an authored leading U+FEFF is content and round-trips unchanged.

Object inventory order has no scene meaning. Renaming or editing structured
object properties changes only its JSON unit, while a content-only text edit
produces a narrow `.txt` diff. Reordering changes only the layer unit. IDs,
display names, source paths, and stacking order are independent.

Structural groups, embedded fonts, and multiple layers have explicit
inventories. Groups are active and may nest; every object and group must have
exactly one structural parent. Source version three still requires one layer and
an empty font inventory where the current `DesignDocument` has no faithful
model.
Asset inventory entries are active: each records a stable ID, safe path, media
type, byte length, and SHA-256 digest. Asset bytes remain outside the JSON
directory codec and are transferred atomically through
`@create-art/source-rpc`; image decoding and placement semantics remain editor
concerns.

Directory readers also accept source versions one and two and the earlier
`{ contours, fillId }`
object-unit shape and deterministically normalize it to path geometry, an
identity transform, and a fill appearance. They accept the originally shipped
implicit `(0, 0)` artboard origin and missing path IDs, then assign the same v3
migration defaults as the complete-document decoder. Readers also normalize
prior width-only stroke object units. Inline `geometry.text` from earlier
sources hydrates without loss; the next canonical save atomically migrates it
to object-version-two JSON plus the raw `.txt` sidecar. Writers emit the explicit
ordered named global artboards, stable path IDs, and canonical separated object
shape, and mark the assembled complete document as version five. Splitting an
artboard edit changes only that artboard unit; reordering changes only
`artboards/index.json`; and object units retain byte-equivalent semantic values.

Authored path contours and points always carry stable `id` fields after
assembly. Expansion and paste assign fresh identities so selection and later
path edits never depend on array indexes.

Live blend records persist a stable blend ID, two ordinary object IDs, the
number of intermediate steps, and explicit contour/point correspondence. They
never persist derived intermediate objects. Missing endpoints and stale
correspondence remain schema-valid so the model can report a recoverable,
entity-located diagnostic instead of making a project unreadable.

## Use

```ts
import {
	assembleDesignDocument,
	splitDesignDocument,
} from "@create-design/source"

const split = splitDesignDocument(document)
if (!split.ok) throw new Error(split.errors[0].message)

const assembled = assembleDesignDocument(split.value)
if (!assembled.ok) throw new Error(assembled.errors[0].message)
```

Collection indexes explicitly pair IDs and safe relative paths. Assembly
rejects missing and orphan units, unknown files, duplicate IDs and paths,
indexed/contained identity mismatches, missing swatches, and objects without
exactly one structural parent. Diagnostics retain both a source-unit path and
a JSONPath-like field location.

`formatSourceUnit()` uses the versioned
[`@create-art/source-format`](../../create-art/source-format/README.md) dprint contract. It
emits readable, recursively key-sorted JSON with author array order, negative
zero, and exactly one trailing newline preserved. Call it only from the
trusted Node source-service boundary; browser code parses, validates, and
submits semantic unit values without formatting them. Raw text units bypass
JSON formatting and are written directly from the authored string. Derived canvas state,
selection, bounds, blend steps, shaped glyphs, PDF data, previews, and export
artifacts do not belong in canonical source.
