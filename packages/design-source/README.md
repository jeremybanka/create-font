# @create-design/source

`@create-design/source` owns the deterministic source boundary for
`create-design`. It exposes the current complete `DesignDocument` model and a
repository-native directory codec that splits independently editable facts
into validated JSON units.

## Complete document versions

Complete documents use a strict, version-dispatched codec. Version four is the
current schema. It retains v3's explicit global page position and required
stable contour/point IDs, and expands strokes from width-only paint to authored
width, cap, join, miter limit, dash array, and dash offset.
`decodeDesignDocument()` accepts complete version-one, version-two, and
version-three documents and deterministically migrates them to v4. Existing
IDs, global coordinates, geometry, and transforms are preserved. Missing v1/v2
path IDs are derived from the owning object and source order, and their page
receives the legacy implicit origin `(0, 0)`. Prior width-only strokes receive
the renderer-neutral butt cap, miter join, miter limit 4, and solid-dash
defaults. The v1 decoder continues to accept both shipped object forms:
canonical geometry/transform/appearance objects are migrated, while older
`{ contours, fillId }` objects become path geometry with an identity transform
and fill appearance.
`validateDesignDocument()` validates only the current version, while
`parseDesignDocumentText()` additionally owns JSON decoding.

Malformed, partial, and future-version inputs fail with field-located
diagnostics. Callers must retain their last valid document when decoding fails;
new-authoring defaults remain an application concern; only explicit versioned
migration defaults are constructed by the codec.

## Coordinate and identity contract

Canonical geometry lives in one unbounded global document plane measured in
points. X increases right and Y increases down. Object geometry is local to its
object and reaches the global plane only through the object's persisted affine
`transform`. Pages are independent rectangles `{ x, y, width, height }` in that
plane; ordinary objects are not page children. Moving or resizing a page must
therefore never rewrite object geometry or transforms. Guides use the same
global axis values.

Canvas world coordinates are identical to document coordinates; pan and zoom
are view-only transforms. Native create-design clipboard objects remain in the
global Y-down plane. Shared create-* vector and font-outline clipboard payloads
use a page-independent Cartesian Y-up plane, so their boundary conversion is
`(x, y) -> (x, -y)` for points and vectors. PDF lowering derives a page-local,
bottom-left Y-up transform from the selected page:
`[1 0 0 -1 -page.x page.y+page.height]`. These clipboard and PDF transforms,
including any deliberate paste offset, are projections and never canonical
geometry mutations.

Object IDs are document-wide. Contour and point IDs are required and unique
within their owning object. Edits preserve every unaffected identity. Copying
or deriving a distinct object assigns a new object ID and new path IDs;
transforming, renaming, restyling, reordering, moving a page, or projecting to
canvas/PDF does not. This is the foundation expected by multi-selection work
in #253 and global multi-artboard/output work in #283.

## Version-one directory

The first directory version deliberately matches the current application
model: one artboard, one layer, authored path/rectangle/ellipse geometry,
independent affine object transforms, optional fill/stroke appearance, one
palette, and empty group, asset, and font inventories.

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
assets/
  index.json
fonts/
  index.json
```

Each fact has one owner:

- `document.json` owns the title and guides;
- `palette.json` owns ordered swatches;
- the sole artboard unit owns the page's global rectangle;
- the sole layer unit owns object stacking order;
- the object inventory maps stable object IDs to stable source paths; and
- each object unit owns one complete object.

Object inventory order has no scene meaning. Renaming or editing an object
therefore changes only its object unit, while reordering changes only the layer
unit. IDs, display names, source paths, and stacking order are independent.

Groups, embedded fonts, multiple layers, and multiple artboards already have
explicit inventories, but source version one requires them to be empty or
singular where the current `DesignDocument` cannot faithfully represent them.
Asset inventory entries are active: each records a stable ID, safe path, media
type, byte length, and SHA-256 digest. Asset bytes remain outside the JSON
directory codec and are transferred atomically through
`@create-art/source-rpc`; image decoding and placement semantics remain editor
concerns.

Version-one directory readers also accept the earlier `{ contours, fillId }`
object-unit shape and deterministically normalize it to path geometry, an
identity transform, and a fill appearance. They accept the originally shipped
implicit `(0, 0)` artboard origin and missing path IDs, then assign the same v3
migration defaults as the complete-document decoder. Readers also normalize
prior width-only stroke object units. Writers emit the explicit
global page rectangle, stable path IDs, and canonical separated object shape,
and mark the assembled complete document as version four.

Authored path contours and points always carry stable `id` fields after
assembly. Expansion and paste assign fresh identities so selection and later
path edits never depend on array indexes.

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
[`@create-art/source-format`](../source-format/README.md) dprint contract. It
emits readable, recursively key-sorted JSON with author array order, negative
zero, and exactly one trailing newline preserved. Call it only from the
trusted Node source-service boundary; browser code parses, validates, and
submits semantic unit values without formatting them. Derived canvas state,
selection, bounds, blend steps, shaped glyphs, PDF data, previews, and export
artifacts do not belong in canonical source.
