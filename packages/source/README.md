# @trigraph/source

`@trigraph/source` is the deterministic file boundary for
[`@trigraph/states`](../states/README.md). In the current codec, one JSON
document represents one complete `EditorFontSource` snapshot: the JSON root is
the state document itself, with the existing `format: "trigraph.editor"` and
`editorVersion: 3` discriminants. There is no second envelope and no file-only
identity layer.

That direct correspondence is important for a future server-backed editor.
Stable IDs, author ordering, shared topology, master layers, locations, cmap
references, relative incoming/outgoing handles, soft/hard node modes, and
each contour's explicit `closed` state, plus editor-only note and color fields,
all cross the boundary in the same form emitted by the state graph. Decoding returns the
public type that can be passed to `createFontEditorState().actions.load`.

## Relationship to project source

This complete-document codec is not the eventual storage contract for a
Trigraph repository. The product architecture calls for a directory of
reviewable JSON source units so a glyph edit does not rewrite unrelated font
data. A future workspace source layer will discover and validate those units,
compose them into editor state, and encode only changed units on save.

The existing codec remains useful as the canonical boundary for a complete
snapshot, in-memory backends, interchange fixtures, migrations, and validation.
Directory layout, manifests, cross-file references, per-unit revisions, and
atomic persistence belong to the workspace layer rather than being inferred by
this package. See the repository's
[architecture](../../docs/architecture.md#project-source) and
[roadmap](../../docs/roadmap.md#1-repository-source-workspace).

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
} from "@trigraph/source"
import { createFontEditorState } from "@trigraph/states"

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
- each glyph layer's point records follow the glyph's shared topology order;
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

Version 3 is a closed schema. Earlier versions are rejected explicitly rather
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
`@trigraph/states` selectors and `trigraph` ingestion. A decoded value proves
that it can be represented and addressed safely by the editor state model, not
that it is already exportable.
