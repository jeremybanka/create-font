# @create-font/states

`@create-font/states` is the high-level, editable design-space model for
[`@create-font/target`](../target/README.md). It stores the information a font
editor needs while a design is in progress, then incrementally projects that
state into the target's low-level `VariableFontSource` representation.

The distinction is deliberate:

- editor state has stable entity IDs, independently authored master outlines,
  explicit interpolation compatibility, selection-friendly diagnostics, and editor-only
  annotations;
- the target IR has resolved glyph order, axis-tagged locations, default
  outlines and metrics, complete variation tuples, numeric glyph IDs, and no
  editing metadata.

A document does not need to be exportable after every edit. Projection results
carry structured errors and warnings until the state is complete. Once the
whole-font compilation result reaches `stage: "compiled"`, the generated source
has also passed `@create-font/target` ingestion and the returned `font` is the branded,
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
- one ordered list of open-or-closed contours per glyph and master;
- layer-local contour and point IDs, `soft` or `hard` editing behavior,
  coordinates, relative incoming/outgoing handles, and metrics;
- a character map from Unicode code points to stable glyph IDs.

Topology is master-local. A structural edit receives a `masterId` and changes
only that layer; another master may use different contour IDs, point IDs,
orders, or node counts. Handles are vectors relative to their owning node, so
moving a node carries its handles without rewriting them.

Interpolation correspondence is ordinal and explicit: corresponding paths and
nodes occupy the same indexes. `glyphCompatibility` reports path-count,
open/closed, node-count, and projected on/off-curve-pattern mismatches with
locations in both masters. Lowering preserves authored path boundaries and
order and fails on incompatibility instead of merging or reordering outlines.

Soft nodes require at least one handle in every layer. When both handles are
present, they lie on opposite rays of one line, and moving either rotates the
other while preserving its length. Deleting one handle leaves its mate intact
and makes the node hard. Changing a one-sided hard node to soft projects its
existing handle onto the tangent established by the adjacent segment without
creating the missing handle; a handleless node remains hard. Hard nodes permit
independent handles. For a one-handle soft node, only handle length is stored
geometry: its angle is derived from the adjacent segment on the handleless
side, using that segment's neighboring control point when present and its
on-curve node otherwise. Moving either endpoint keeps the handle on that
tangent.

## Atom graph

Call `createFontEditorState` once per open document. It constructs a fresh,
ephemeral atom.io `Silo`; no module-level or implicit store is used. The
required `key` namespaces every token, so two documents with the same entity
IDs remain isolated.

Independent editor facts are atoms. Ordered ID indexes are small atoms, and
entities, coordinates, metrics, and mappings live in keyed atom families. Each
layer node position is one coherent `{ x, y }` family member because callers
observe and move both coordinates together. Advance width is a separate
layer-keyed family, and each handle component remains an independent hot atom.
Dragging a node or handle therefore does not replace unrelated point geometry,
an entire glyph, or a master. Notes and color labels are also separated from
export-bearing atoms, so annotation changes do not invalidate glyph lowering.

The expensive aggregate source selectors intentionally depend on a shallow
document revision edge. Every exported core transaction advances that revision
inside the same atomic commit, so direct transaction callers cannot leave those
projections stale. Imperative atom writes outside core transactions must call
`markDocumentChanged` after completing their logical edit.

Whole-document replacement is deliberately available through `actions.load`
rather than the public transaction collection. Loading clears each surviving
glyph history, disposes histories for removed glyphs, and clears kerning history
after the atomic state replacement. A raw transaction cannot perform that
timeline lifecycle safely, so consumers that previously ran
`transactions.replaceFont` should call `actions.load` instead.

### Remote source cache

`createRemoteFontSourceState` is the RPC-facing companion to the hot editor
model. It stores the source manifest in one `Loadable` atom and each JSON file
in a `Loadable` atom-family member keyed by its relative source-unit path.
Reading a member performs that unit's request; the path is its cache identity;
`refreshUnit` explicitly invalidates only that member.

This cache is deliberately outside `glyphHistoryTimelines`. Remote hydration,
server revisions, and persistence acknowledgements are not user edits and must
not appear in undo history. Supply a `hydrate` callback to decode each unit and
install its narrow local facts. The loadable's path identity ensures that
callback runs once for the cached read, not once per component observer.

The intended flow is:

1. a component reads the loadable for the file it needs;
2. `hydrate` runs a dedicated transaction that establishes local atoms as a
   baseline; a concrete glyph hydrator then clears only that glyph's timeline;
3. visual edits remain synchronous local transactions;
4. persistence runs after the edit, stores the server's canonical response, and
   refreshes only remotely owned indexes or revisions.

`@create-font/source` now defines the concrete directory paths and per-file
validators. The next integration step is a hydration adapter that validates
each unit by descriptor and installs its facts into the corresponding local
atoms. The RPC remains intentionally chatty: individual loadables issue
individual requests rather than depending on aggregate query endpoints.

Selectors form a lowering graph rather than one monolithic compiler:

1. axis selectors quantize user-space values and validate axis maps;
2. master selectors normalize locations and build OpenType support regions;
3. the variation-model selector builds the master scalar matrix;
4. compatibility and segment-plan selectors map paths and nodes ordinally and
   choose one cubic-to-quadratic subdivision depth from every corresponding
   master segment;
5. layer selectors lower one master's authored paths in their original order,
   following the corresponding segment plan;
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

The editor model owns ordinary cubic Bézier handles, while target v1 uses
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

### Shared cubic geometry boundary

The public `evaluateCubicCurve`, `splitCubicCurve`, and `cubicCurveBounds`
functions retain their `@create-font/states` names, types, return shapes, and
legacy malformed-input behavior, while finite cubic geometry delegates to
`@create-art/vector-geometry`. Callers do not need to import kernel types.

Related algorithms remain local until a feature can migrate their complete
behavior:

- `editor/src/geometry.ts` keeps its fixed sampling and nearest-point refinement
  because those values define pointer hit-testing;
- `editor/src/rule-geometry.ts` keeps rule-line roots, fixed contour flattening,
  signed-area classification, and point containment together because they
  define one measurement model;
- the states cubic-to-quadratic compatibility pipeline remains coordinated
  across masters and is not ordinary display flattening.

Those routines are candidates for later kernel-backed changes with dedicated
interaction and compatibility coverage. Create-design geometry is outside this
adoption.

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
- `ingestion-failed`: a source was formed, but the target's technical validity
  proof rejected it;
- `compiled`: projection and ingestion both succeeded.

Keeping these stages separate helps a UI distinguish an incomplete edit from a
font-format invariant that the composed source violates.

## Editing semantics

Structural operations are synchronous atom.io transactions. Inserting a
master-local node, loading a document, moving several coordinates, dragging or deleting a
handle, deleting nodes, and changing node mode must either update the complete
affected structure or make no change. Ordinary node deletion reconnects and
keeps a contour closed. Breaking deletion splits remaining regions into open
contours and removes the outward handles from their loose ends. Open contours
remain valid, serializable editor state but produce a typed
`topology.open_contour` projection error until closed. A keyed timeline family
routes each glyph-owned atom-family member to that glyph's independent history,
including layer-local points and contours created after loading. Path restacking
is one transaction and therefore one undo step. Projections remain derived
state. Undoing `glyph:O` therefore cannot rewind `.notdef`, even though both
histories live in the document's isolated `Silo`.

Loading is intended for trusted `EditorFontSource` values already constructed
or decoded by an application. It checks structural requirements needed to
populate the graph, such as unique stable IDs, a valid default-master reference,
and internally consistent master layers. Export validity remains the
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
import {
	createFontEditorState,
	type EditorFontSource,
} from "@create-font/states"

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
	// Ready for the target's deterministic lowering layer.
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
`@create-font/target` v1: one TrueType-flavored variable font with high-level cubic editing,
bounded quadratic projection, horizontal metrics, complete point deltas, and a
Unicode character map. It does
not model binary table layout. Composite glyphs, hinting, OpenType Layout,
vertical metrics, color, CFF/CFF2, sparse IUP deltas, and binary serialization
belong to future profiles or other layers.

In the larger [toolchain architecture](../../../docs/architecture.md), this state
graph remains the hot model for visual editing and design-space projection.
Textual OpenType Layout rules and other programmable behavior can compile in a
separate layer and join the deterministic build pipeline without becoming
mutable atom-by-atom editor state.

Editor-only fields such as notes, color labels, and soft/hard handle behavior
are never projected into the IR. Conversely, low-level facts such as glyph IDs,
complete tuple deltas, normalized tag-keyed regions, and phantom-point metric
deltas are derived rather than edited directly.
