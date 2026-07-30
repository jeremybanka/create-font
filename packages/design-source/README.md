# @create-design/source

`@create-design/source` owns the deterministic source boundary for
`create-design`. It exposes the current complete `DesignDocument` model and a
repository-native directory codec that splits independently editable facts
into validated JSON units.

## Version-one directory

The first directory version deliberately matches the current application
model: one artboard, one layer, ordinary path objects, one palette, and empty
group, asset, and font inventories.

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
- the sole artboard unit owns page dimensions;
- the sole layer unit owns object stacking order;
- the object inventory maps stable object IDs to stable source paths; and
- each object unit owns one complete object.

Object inventory order has no scene meaning. Renaming or editing an object
therefore changes only its object unit, while reordering changes only the layer
unit. IDs, display names, source paths, and stacking order are independent.

Groups, placed assets, embedded fonts, multiple layers, and multiple artboards
already have explicit inventories, but source version one requires them to be
empty or singular where the current `DesignDocument` cannot faithfully
represent them. Later document/source versions can activate those inventories
without inventing a competing storage boundary.

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
