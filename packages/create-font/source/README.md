# @create-font/source

`@create-font/source` is the deterministic file boundary for
[`@create-font/states`](../states/README.md). It defines both:

- a complete-document codec for interchange, migrations, and in-memory
  backends;
- the repository directory contract used by the development server.

Both representations map directly to `EditorFontSource`.
Stable IDs, author ordering, master-local outlines, locations, cmap
references, relative incoming/outgoing handles, soft/hard node modes, and
each contour's explicit `closed` state, plus editor-only note and color fields,
all cross the boundary in the same form emitted by the state graph.

## External source importers

The native directory and document codecs stay format-focused. Glyphs.app text
parsing, its source AST, and explicit lowering into this format live in
[`@create-font/glyphs`](../glyphs/README.md).

## Project source directory

The directory is deliberately shaped around the state graph's useful remote
loadable identities:

```text
create-font.json
metadata.json
names.json
metrics.json
style.json
axes/
  index.json
  <indexed path>.json
masters/
  index.json
  <indexed path>.json
instances/
  index.json
  <indexed path>.json
glyphs/
  index.json
  <indexed path>.json
cmap/
  index.json
  <indexed path>.json
```

- `create-font.json` has its own `create-font.source` format/version and separately
  declares the editor snapshot format/version it assembles.
- `metadata.json`, `names.json`, `metrics.json`, and `style.json` correspond
  directly to the state graph's compact singleton atoms.
- each entity family has an ordered `index.json` whose entries pair an
  identity with an explicit safe relative path.
- `masters/index.json` also owns the default-master reference.
- axes, masters, instances, and character mappings each have one unit per
  atom-family identity.
- each indexed glyph file is one complete glyph timeline unit: glyph facts,
  complete independently authored outlines for all master layers.

The explicit indexes mean IDs and code points remain application identities
rather than being treated as raw filenames. Existing repositories can retain
arbitrary indexed paths through renames and reordering. The exported
`default*UnitPath` functions are only portable initial-path policies.

`sourceUnitDescriptors` exposes unit kinds, singleton paths, collection
inventory, and validators for server/RPC routing. Each file kind has a named
Zod schema, and `jsonSchemaForSourceUnit(kind)` generates its JSON Schema
Draft 2020-12 representation.

Server and tooling code should import the package root. Browser code should
import `@create-font/source/browser`, which exposes directory assembly, splitting,
path helpers, and structural file types without including Zod or the per-unit
schema implementation. The workspace server validates every unit before the
browser receives it; the browser codec verifies index relationships and runs
the whole-editor-source validator after assembly.

Adobe feature source is parsed by upstream `fea-rs` through
`@create-font/fea-rs-wasm`. `parseFeaSyntax(source)` returns a JSON projection
of its complete lossless concrete syntax tree, including trivia and UTF-8 byte
ranges. `parseFea(source)`
projects the substitution forms currently consumed by create-font into the
existing source-located IR, whose ranges use JavaScript UTF-16 offsets. Node
imports initialize the parser synchronously; browser consumers initialize it
once before parsing:

```ts
import {
	initializeFeaParser,
	parseFea,
	parseFeaSyntax,
} from "@create-font/source/browser"

await initializeFeaParser()
const syntax = parseFeaSyntax("feature liga { sub f i by f_i; } liga;")
const substitutions = parseFea("feature liga { sub f i by f_i; } liga;")
```

`analyzeFeaProject({ entries, sources, glyphs })` is the reusable,
filesystem-independent project analysis boundary used by build, live source
validation, `font check`, and the feature language server. `entries` contains
indexed project-relative paths, `sources` includes entry and include-only
source text, and `glyphs` supplies stable IDs, names, and export state. Its
deterministic result separates source-located diagnostics, analyzed documents,
and validated compiler IR. `FeaLineIndex` converts the Rust ABI's UTF-8 byte
ranges to JavaScript/LSP UTF-16 offsets and positions.

Includes are preserved by the Wasm syntax tree and resolved only by this host
analysis layer. Missing files, cycles, and project escapes are errors. Syntax
recognized by `fea-rs` but not representable by create-font remains an
actionable `fea.unsupported` semantic diagnostic and is never silently lowered.

```ts
import {
	assembleEditorFontSource,
	jsonSchemaForSourceUnit,
	sourceUnitDescriptors,
	splitEditorFontSource,
} from "@create-font/source"

const directory = splitEditorFontSource(editor.read.editorSource()!)
if (!directory.ok) throw new Error(directory.errors[0].message)

await writeJsonUnits(directory.value)

const glyphSchema = jsonSchemaForSourceUnit("glyph")
const glyphInventoryPath = sourceUnitDescriptors.glyph.inventoryPath
const axisInventoryPath = sourceUnitDescriptors.axis.inventoryPath

const assembled = assembleEditorFontSource(await readJsonUnits())
if (assembled.ok) editor.actions.load(assembled.value)
```

`assembleEditorFontSource` validates every unit, checks inventories for
duplicate identities and paths, rejects missing or orphan units, verifies that
indexed and contained identities agree, then passes the composed snapshot
through the existing whole-document structural and relational validation.

The server owns filesystem discovery, atomic persistence, revisions, and
watching. This package owns the directory's portable data contract.

Every application-owned JSON unit is serialized through the versioned
[`@create-art/source-format`](../../create-art/source-format/README.md) dprint contract after
validation and semantic normalization. Adobe feature writes use the same
contract's FEA plugin. Revisions identify the final formatted bytes written to
disk. Formatting is a trusted Node source-service responsibility; browser
consumers parse, assemble, validate, and submit semantic values without
formatting them. Noncanonical external source remains untouched until that
logical unit is next written.

## Complete-document codec

One JSON document can still represent one complete `EditorFontSource`
snapshot: the JSON root is the state document itself, with
`format: "create-font.editor"` and `editorVersion: 5` discriminants. Version 3
and 4 files and directory manifests are migrated on read; every new write emits
version 5. Version 3 gains zero-depth alignment overshoots. Version 4 shared
topology is joined to each layer by `pointId`: the default layer preserves IDs,
other layers receive deterministic master-qualified IDs, and missing,
duplicate, or unknown joins produce actionable diagnostics. There is no
second envelope and no file-only identity layer. Decoding returns the public
type that can be passed to `createFontEditorState().actions.load`.

## The one JSON adaptation

JavaScript `bigint` is not a JSON scalar. The optional
`metadata.createdAt` and `metadata.modifiedAt` fields therefore have one
specified wire mapping:

- in `EditorFontSource`: `bigint`;
- in `EditorFontFile`: a canonical base-ten string, such as `"0"`, `"-1"`, or
  `"18446744073709551615"`.

Leading zeroes, a leading plus, and `"-0"` are rejected. This makes the mapping
bijective: decode followed by encode always returns the same timestamp text.
No other state field is transformed.

## API

The codec is result-based. Malformed external data never needs to be caught as
an exception:

```ts
import {
	decodeEditorFontSource,
	encodeEditorFontSource,
} from "@create-font/source"
import { createFontEditorState } from "@create-font/states"

const decoded = decodeEditorFontSource(await response.text())

if (!decoded.ok) {
	for (const error of decoded.errors) {
		console.error(error.code, error.path, error.message)
	}
} else {
	const editor = createFontEditorState({ key: "document/geometric-o" })
	editor.actions.load(decoded.value)

	const encoded = encodeEditorFontSource(decoded.value)
	if (encoded.ok) await sendToServer(encoded.value)
}
```

`decodeEditorFontSource` accepts JSON text. `fromEditorFontFile` validates an
already parsed value. In the other direction, `validateEditorFontSource`
checks and clones an in-memory snapshot, `toEditorFontFile` produces the
JSON-compatible object type, and `encodeEditorFontSource` emits text.
`canonicalizeEditorFontSource` accepts any valid property layout and returns
the canonical one.

All successful object values and result records are deeply frozen. They do not
share mutable arrays or objects with caller-owned input.

## Canonical text

Canonical encoding has deliberately small rules:

- object properties are sorted recursively by JavaScript string order;
- array order is preserved exactly;
- each glyph layer preserves its authored contour and point order;
- strings use the platform's well-formed `JSON.stringify` escaping;
- finite numbers use JSON's shortest round-tripping representation, with
  negative zero explicitly retained as `-0`;
- there is no insignificant whitespace;
- the document ends with one line feed.

Thus the same state snapshot has exactly one encoded representation, useful
for content hashes, optimistic concurrency, diffs, and server-side caching.

The state graph intentionally erases some explicit defaults. Canonical source
does the same: `hidden: false`, `elidable: false`, `overlap: false`, and
`note: ""` are omitted. Distinctions retained by state are
retained here too, including an empty color string, an empty axis map, and an
empty PostScript name. Consequently, encoding a source before and after
`load(source) -> read.editorSource()` produces identical bytes.

## Validation boundary

Versions 3 and 4 are closed legacy schemas. Earlier versions are rejected explicitly rather
than silently reinterpreted: version 2 did not record whether contours were
open or closed and allowed handleless soft nodes. The decoder rejects invalid syntax, duplicate object keys,
prototype-sensitive keys, unknown properties, missing or wrongly typed fields,
non-finite in-memory numbers, noncanonical timestamp strings, wrong ID kinds,
duplicate identities, dangling references, handleless or non-collinear
soft nodes, and topology that cannot be loaded into the state graph.
Diagnostics have stable codes and
JSONPath-like paths. Lexical key inspection is iterative, and array inspection
walks actual own entries rather than trusting or iterating a hostile declared
length, so untrusted depth and sparse inputs fail as data instead of exhausting
the JavaScript call stack.

This is structural source validation, not font compilation. An editor must be
able to persist work in progress, so values that are structurally sound may
still contain open contours, invalid OpenType ranges, incomplete master
coverage, or other projection and ingestion errors. Open contours are
deliberately accepted for broken-path editing and must be closed before export.
Those export constraints remain the responsibility of
`@create-font/states` selectors and `@create-font/target` ingestion. A decoded value proves
that it can be represented and addressed safely by the editor state model, not
that it is already exportable.
