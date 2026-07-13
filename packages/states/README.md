# @trigraph/states

`@trigraph/states` is the high-level, editable design-space model for
[trigraph](../trigraph/README.md). It stores the information a font editor needs
while a design is in progress, then incrementally projects that state into
trigraph's low-level `VariableFontSource` representation.

The distinction is deliberate:

- editor state has stable entity IDs, source masters, shared glyph topology,
  per-master coordinates, selection-friendly diagnostics, and editor-only
  annotations;
- the trigraph IR has resolved glyph order, axis-tagged locations, default
  outlines and metrics, complete variation tuples, numeric glyph IDs, and no
  editing metadata.

A document does not need to be exportable after every edit. Projection results
carry structured errors and warnings until the state is complete. Once the
whole-font compilation result reaches `stage: "compiled"`, the generated source
has also passed `trigraph` ingestion and the returned `font` is the branded,
deeply frozen low-level representation.

## Document model

`EditorFontSource` is the serializable boundary of the package. Its arrays
preserve author order, while every addressable entity has a kind-prefixed,
serialization-safe ID such as `axis:wght`, `master:black`, or `point:o-inner-0`.
References use those IDs rather than array indexes or mutable names.

The principal entities are:

- axes in user-space coordinates, with optional `avar` mappings;
- one default master plus source masters, including optional intermediate
  support regions;
- named instances keyed by stable axis IDs;
- glyph records containing export intent and editor-only note and color;
- one ordered open-or-closed contour/node topology per glyph, with `soft` or
  `hard` editing behavior shared by every master;
- one coordinate, relative incoming/outgoing handle, and metrics layer per
  glyph and master;
- a character map from Unicode code points to stable glyph IDs.

Sharing topology is an important constraint. A node's identity, contour
membership, order, and soft/hard behavior live once; its `x` and `y`
coordinates and optional handles vary by master. Handles are vectors relative
to their owning node, so moving a node carries its handles without rewriting
them. A structural node edit can therefore update every layer atomically, and
lowering never has to guess whether master contours correspond.

Soft nodes require two handles in every layer, lying on opposite rays of one
line. Moving either handle rotates the other while preserving its length.
Deleting one handle leaves its mate intact and makes the node hard. Changing a
one-sided hard node to soft reconstructs its missing handle from the adjacent
segment on that side and aligns both handles; a handleless node remains hard.
Hard nodes permit independent and one-sided handles.

## Atom graph

Call `createFontEditorState` once per open document. It constructs a fresh,
ephemeral atom.io `Silo`; no module-level or implicit store is used. The
required `key` namespaces every token, so two documents with the same entity
IDs remain isolated.

Independent editor facts are atoms. Ordered ID indexes are small atoms, and
entities, coordinates, metrics, and mappings live in keyed atom families. In
particular, layer node `x` and `y` values and each handle component are separate
hot atoms, so dragging a node or handle does not replace an entire glyph or
master. Notes and color labels are also separated from export-bearing atoms,
so annotation changes do not invalidate glyph lowering.

Selectors form a lowering graph rather than one monolithic compiler:

1. axis selectors quantize user-space values and validate axis maps;
2. master selectors normalize locations and build OpenType support regions;
3. the variation-model selector builds the master scalar matrix;
4. segment-plan selectors choose one cubic-to-quadratic subdivision depth from
   the worst approximation bound across every master;
5. layer selectors combine shared topology with one master's coordinates,
   handles, and metrics, following the shared segment plan;
6. glyph selectors solve source-master differences into complete `gvar`
   tuples, including horizontal phantom-point deltas;
7. instance and character-map selectors replace stable editor IDs with axis
   tags and numeric glyph IDs;
8. the font-source selector composes those pieces into `VariableFontSource`;
9. the compilation selector passes that source through `ingestVariableFont`.

This decomposition lets an editor subscribe close to the work being shown. A
glyph view can read a layer or glyph projection without recompiling unrelated
glyphs; export can read the final composition of the same selectors.

Multi-master deltas are solved against the scalar contributions of all source
regions. They are not assumed to be independent differences from the default
master, which would be incorrect when supports overlap.

### Cubic editing over a quadratic IR

The editor model owns ordinary cubic Bézier handles, while trigraph v1 targets
TrueType quadratic outlines. Lowering is deterministic and coordinated across
masters. Each cubic subcurve is approximated by
`Q = (3(C1 + C2) - P0 - P3) / 4`; the distance between its two interior
controls and the degree-raised quadratic controls gives a convex-hull error
bound. Every segment selects one power-of-two subdivision depth that satisfies
a 0.5 font-unit bound for all masters, up to a fixed depth of 8. Each layer
then emits the same on/off-curve topology. A straight layer in a segment that
is curved elsewhere emits midpoint controls under that shared plan.

If malformed coordinates or the subdivision limit prevent a bounded result,
projection returns a typed error. It never silently changes tolerance or lets
masters choose incompatible point counts.

## Projection and compilation

Intermediate selectors return `ProjectionResult<T>`:

```ts
type ProjectionResult<T> =
	| { ok: true; value: T; warnings: readonly ProjectionWarning[] }
	| {
			ok: false
			errors: NonEmptyReadonlyArray<ProjectionError>
			warnings: readonly ProjectionWarning[]
	  }
```

Projection issues have stable codes, JSONPath-like paths, and an optional
editor entity ID suitable for selecting the offending object in a UI. Numeric
editor values may produce quantization warnings when converted to Fixed16.16,
F2Dot14, or integer font units.

Loaded documents are copied into graph-owned, frozen values, and derived
snapshots are deeply frozen. Caller mutation therefore cannot change cached
state without an atom update or make a validated font proof disagree with the
source that produced it.

Whole-font compilation has three explicit outcomes:

- `projection-failed`: editor state could not form a complete low-level source;
- `ingestion-failed`: a source was formed, but trigraph's technical validity
  proof rejected it;
- `compiled`: projection and ingestion both succeeded.

Keeping these stages separate helps a UI distinguish an incomplete edit from a
font-format invariant that the composed source violates.

## Editing semantics

Structural operations are synchronous atom.io transactions. Inserting a shared
node, loading a document, moving several coordinates, dragging or deleting a
handle, deleting nodes, and changing node mode must either update the complete
affected structure or make no change. Ordinary node deletion reconnects and
keeps a contour closed. Breaking deletion splits remaining regions into open
contours and removes the outward handles from their loose ends. Open contours
remain valid, serializable editor state but produce a typed
`topology.open_contour` projection error until closed. Each glyph receives its
own timeline over only that glyph's family members, while projections remain
derived state. Undoing `glyph:O` therefore cannot rewind `.notdef`, even though
both histories live in the document's isolated `Silo`.

Loading is intended for trusted `EditorFontSource` values already constructed
or decoded by an application. It checks structural requirements needed to
populate the graph, such as unique stable IDs, a valid default-master reference,
and layer coordinates that refer to known points. Export validity remains the
job of the projection and ingestion stages, where failures are data rather than
thrown exceptions.

## Minimal use

The complete public graph is returned by `createFontEditorState`, including its
Silo-bound atoms, selector families, transactions, per-glyph timelines, and
convenience actions. A typical application creates an isolated graph, loads a
serializable document, performs edits through transactions, and reads only the
projection it currently needs:

<!-- This example is kept in sync with the concrete return surface in state.ts. -->

```ts
import { createFontEditorState, type EditorFontSource } from "@trigraph/states"

declare const source: EditorFontSource

const editor = createFontEditorState({ key: "document/geometric-o" })

// Load, edit, and read through the methods returned by this document graph.
// See the exported CreateFontEditorState result for the complete token surface.
editor.actions.load(source)
editor.actions.movePoints({
	masterId: "master:black",
	glyphId: "glyph:O",
	points: [{ pointId: "point:o-inner-0", x: 300, y: 300 }],
})

const glyph = editor.read.glyphSource("glyph:O")
const compilation = editor.read.compilation()

if (!compilation.ok) {
	console.error(compilation.stage)
} else {
	// Ready for trigraph's deterministic lowering layer.
	console.log(compilation.font)
}

editor.undo("glyph:O")
editor.redo("glyph:O")
```

The IDs in this example are ordinary template-literal typed strings. Real
documents should generate them once and preserve them across renames,
reordering, serialization, and collaborative edits.

## Scope

The state model currently targets the same deliberately narrow profile as
trigraph v1: one TrueType-flavored variable font with high-level cubic editing,
bounded quadratic projection, horizontal metrics, complete point deltas, and a
Unicode character map. It does
not model binary table layout. Composite glyphs, hinting, OpenType Layout,
vertical metrics, color, CFF/CFF2, sparse IUP deltas, and binary serialization
belong to future profiles or other layers.

Editor-only fields such as notes, color labels, and soft/hard handle behavior
are never projected into the IR. Conversely, low-level facts such as glyph IDs,
complete tuple deltas, normalized tag-keyed regions, and phantom-point metric
deltas are derived rather than edited directly.
