# create-design

`create-design` is a proof-of-concept vector design application related to
`create-font`. It shares the editor command palette and responsive workspace
allocation logic, uses the same Bézier point representation, and exchanges
vectors with `create-font` through its versioned outline clipboard format.

The package owns the CLI, filesystem-backed source service, and workspace
server. The browser application and design interaction model live in
[`@create-design/editor`](../../packages/create-design/editor/README.md), while
product-neutral editor foundations live in
[`@create-art/editor`](../../packages/create-art/editor/README.md).

## CLI workflow

Create a new workspace and its first design with the initializer:

```sh
npm create design@latest campaign-poster
cd campaign-poster
```

The package also supports direct `create-design campaign-poster` invocation.
Running `create-design second-poster` from an existing create-design workspace
adds `designs/second-poster` without replacing the workspace. New workspaces
contain `build` and `dev` package scripts backed by the separate `design`
project CLI:

Import a modern, PDF-compatible Adobe Illustrator file directly into native
source while creating a workspace:

```sh
create-design campaign-poster --from ./campaign.ai --no-install
```

Omit the design name to derive it from the `.ai` filename. Import parses and
validates the complete input before project creation, then stages all native
source beside the destination and renames it into place. A failed import never
leaves a partial design project. Advisory fidelity diagnostics are written to
stderr and successful creation continues. The command is CLI-only; the browser
editor does not currently expose file selection or drag-and-drop import.

Illustrator import uses the visible PDF-compatible representation, not Adobe's
private editing graph. It preserves PDF pages as horizontally arranged
artboards, editable vector paths, process-color swatches, strokes, transforms,
Form XObjects, clipping, and best-effort optional-content layer names. Text,
images, gradients, ICC/spot colors, transparency, masks, effects, symbols,
brushes, appearance stacks, and private object hierarchy are diagnosed at the
explicit fidelity boundary. See
[`@create-design/ai`](../../packages/create-design/ai/README.md) for the exact
support matrix, safety limits, and re-save guidance.

```sh
design check
design build
design dev
```

When a workspace contains multiple projects, pass the design name, for example
`design build second-poster`. `design build` writes the default PDF artifact to
`artifacts/<design>/<design>.pdf`; `design export` retains explicit PDF, SVG,
and PNG output control.

Output targets live in the headless
[`@create-design/pdf`](../../packages/create-design/pdf/README.md) and
[`@create-design/svg`](../../packages/create-design/svg/README.md) packages.
PDF uses `mondrian.pdf`'s validated object IR. RGB-authored fills and strokes
are emitted with PDF RGB operators and CMYK-authored paints with native PDF
CMYK operators. The browser editor and CLI export command consume the same
target-specific projection, preflight, and serialization APIs.

## Headless PDF export

Export every artboard in document order from a validated source project:

```sh
design export designs/workbench-poster \
  --output artifacts/workbench-poster.pdf
```

Select particular artboards by stable ID and include their authored bleed:

```sh
design export designs/workbench-poster \
  --output artifacts/workbench-cover.pdf \
  --artboards artboard:cover,artboard:back \
  --include-bleed
```

The output path must end in `.pdf` and remain outside the source project. This
keeps generated files from becoming invalid unknown source units. The exporter
creates missing output directories, runs the same preflight as the browser,
and publishes the completed PDF atomically. Existing files are preserved by
default; pass `--force` to atomically replace one. Blocking diagnostics and
invalid source exit with status 1 without publishing partial output. Advisory
preflight notices are written to stderr while a successful export still exits
with status 0. Run `design export --help` for the complete option list.

## Headless SVG export

The same command exports one artboard through the browser editor's deterministic
`@create-design/svg` projection and serialization path when the output ends in
`.svg`:

```sh
design export designs/workbench-poster \
  --output artifacts/workbench-poster.svg \
  --artboards artboard:page
```

Without `--artboards`, SVG export selects the first ordered artboard. Unlike
multi-page PDF, one SVG artifact represents one artboard. CMYK-authored paint is
converted through its deterministic RGB alternate and reported as a warning.
SVG output must remain outside the source project and uses the same atomic,
no-clobber publication behavior as PDF.

Design objects keep three authored concerns separate:

- `geometry` is a tagged path, live rectangle, or live ellipse;
- `transform` is an independent local-to-document affine transform; and
- `appearance` contains optional fill and stroke paints.

The Appearance tile authors fill and stroke independently from shared RGB and
CMYK swatches. Either paint can be none, the two paints can be swapped, and
mixed multi-object selections are edited atomically. With no selection, the
same controls set the appearance for new Pen paths, rectangles, and ellipses.
Swatches remain shared references, so editing one updates every painted object
without rewriting its geometry. Stroke width, caps, joins, miter limit, dash
pattern, and dash offset are independently authored and shared by canvas and
PDF rendering.

Move, scale, and rotate compose the object transform without rewriting source
points or converting live shapes. Canvas, selection, clipboard, and PDF use an
explicit document-space contour projection. Node-level vector replacement is
the deliberate bake boundary: it converts the projected result to path
geometry and resets the transform to identity.

Select (`V`) supports replacement, modifier-toggle, marquee, Select All, and
Escape across visible unlocked objects. A multi-object move or transform is a
single history entry. Direct Selection (`A`) targets ordinary path nodes,
handles, segments, or whole contours; modifier clicks and marquee extend the
control selection, arrow keys nudge it, and each gesture commits atomically.
Native selection inside text fields remains owned by the browser.

Group and Ungroup create and release structural containers without baking child
geometry, transforms, appearances, visibility, or locks. Normal selection and
stacking treat a group as one rigid unit; double-clicking enters a nested group
scope. Bring Forward, Send Backward, Bring to Front, and Send to Back reorder
only the selected sibling units, and every hierarchy command is one history
entry. The Layers tile provides explicit drag and keyboard controls for moving
complete objects or groups among parents and layers; cycles, partial-group
moves, and hidden or locked destinations are rejected before mutation.

The canonical document plane is global, point-based, and Y-down. Ordered named
artboards are positioned rectangles in that plane, not parents of ordinary
objects. Artwork can cross several artboards or sit outside all of them. The
active artboard is UI state, never canonical document source. Canvas world
coordinates use the plane directly. Native design
clipboard data stays global; shared vector/font clipboard data crosses an
explicit artboard-independent Y-up boundary; and PDF applies the active
artboard's Y flip and translation at the page stream boundary. Moving,
resizing, or reordering an artboard therefore changes canvas framing or PDF
placement without invalidating object geometry. Multi-page composition and
artboard editing gestures remain separate follow-up features. The full
downstream contract is documented in
[`@create-design/source`](../../packages/create-design/source/README.md#coordinate-and-identity-contract).

The Object tile exposes the exact local rectangle/ellipse parameters, exact
geometric document-space bounds, and separate visible painted bounds.
Selection, marquee handles, and snapping use the visible fill/stroke extent,
including authored caps, joins, miters, and dash runs. **Expand Shape** is the
deliberate live-shape boundary:
it replaces only the local rectangle or ellipse geometry with visually
equivalent ordinary cubic contours, assigns fresh stable contour/control IDs,
and keeps the object ID, affine transform, appearance, stacking position, and
selection. The replacement is one history entry. Native create-design
copy/paste retains live parameters; generic vector and create-font clipboard
formats remain intentional path interoperability boundaries. Native clipboard
payload version three retains complete appearance; the create-font outline
flavor deliberately carries only projected geometry.

**Expand Stroke** uses a `0.05` local-unit construction budget: at most `0.025`
for centerline/round-geometry sampling and at most `0.025` from every generated
sampled outline to its reconstructed cubic envelope in both nearest-distance
directions. This is a stated, deterministic discrete construction metric rather
than a formal continuous Hausdorff bound. The refit locally subdivides any span
that overshoots the envelope, loops, introduces a self-intersection absent from
the sampled outline, or reverses winding. Points within `1e-7` local units are
coincident. Generated curve samples remain smooth while authored corners keep
their cap/join/miter behavior; dash boundaries remain independent capped
regions. The command retains the affine transform, promotes stroke paint to
fill, and assigns fresh stable contour/control IDs. A source fill is preserved
as a fill-only sibling immediately below the expanded stroke. Wholly zero-length
strokes fail without a history entry; coincident spans are discarded; invalid
values fail without mutation; and self-crossing centerlines fail without
mutation at the separate cleanup/Pathfinder boundary.

Path commands operate on the exact directly selected contours, or on every
contour of the selected path objects when there is no direct selection. Reverse,
Join, Close, Simplify, Make Compound Path, Release Compound Path, and Normalize
Compound Winding each report why the current selection is ineligible before
editing. Simplify first removes only zero-length cubic spans whose complete
control polygon is coincident within `1e-6` document units. An optional refit
uses a `0.25` unit bidirectional reconstruction budget, preserves authored
corners at or above 30 degrees, and is accepted only when it has strictly fewer
anchors, introduces no crossing, and retains closed-path winding. Otherwise the
cleaned or original contour is returned unchanged, without allocating IDs or
rewriting handles; Simplify therefore never increases anchor count. Retained
authored anchors keep their stable IDs, and direct selections are repaired by
surviving point and segment-endpoint identities. Joining uses the same
coincidence tolerance and otherwise adds an ordinary straight bridge. Making a
compound path bakes the selected closed paths into the topmost selected
object's coordinate space and appearance without silently changing contour
winding. It authors an explicit even-odd fill rule; ordinary paths may instead
author nonzero winding. Canvas hit testing, canvas paint, and PDF lowering all
use that same persisted rule, so nested counterforms agree before and after the
separate winding-normalization command. Every successful command is committed
as one immutable history entry.

Pathfinder commands operate on actual authored filled regions, not bounding
boxes or stroke centerlines. Explicit even-odd and nonzero compound fill rules
are resolved before topology work. Filled outputs use a `0.05` document-unit
construction budget: `0.0125` for adaptive cubic sampling and `0.0375` for
deterministic cubic reconstruction after integer topology resolution on a
`1e-6` document-unit grid. Outline uses the same sampling and topology grid but
keeps its noded straight segments directly rather than refitting them. Unite combines all selected fills.
Intersect retains only regions shared by every selected object. Exclude retains
regions covered by an odd number of selected objects, after each object's own
authored compound fill has been resolved independently. Unite, Intersect, and
Exclude produce one ordinary compound path at the topmost selected object's
stack position and inherit that object's complete appearance. Subtract Front treats the
backmost selected fill as the subject, subtracts every selected object above it,
and preserves the backmost object's stack position and appearance. Affine
transforms are baked at this explicit editing boundary. Inputs with no fill,
open or empty geometry, or hidden/locked objects are rejected without mutation.
Successful output receives canonical contour ordering and fresh stable contour
and control IDs, replaces all sources in one history entry, and becomes the
sole selection. Any mathematically empty operation commits the source deletion
with an empty selection. Canvas, bounds, hit testing, clipboard, and PDF consume the same
ordinary even-odd path output.

Divide, Trim, Merge, Crop, and Outline share a deterministic coverage
partition. The partition emits connected non-zero-area faces in canonical
geometry order, associates every face with its source coverage, emits
coincident boundaries once, and ignores tangent zero-area intersections. A
progress callback reports each source-region pass, and callers may interrupt
between passes. All five commands bake affine transforms, replace complete
sibling objects or groups at the topmost selected hierarchy position, allocate
fresh object, contour, and point identities, select every result, and commit as
one undoable history entry. Results are ordered by source paint position and
then canonical geometry. An empty result deletes the selected sources and
leaves an empty selection.

The application runs those five partition-based commands in a dedicated module
worker. The footer streams partition and materialization progress and exposes a
Cancel action that terminates the worker, including during synchronous result
materialization, without committing history. A completed result is committed
only when the document, object selection, direct selection, and active group
editing scope still match the worker request; otherwise the stale result is
discarded.

Divide materializes every face independently with the complete appearance of
its topmost covering source, including stroke. Trim also materializes every
topmost visible face independently but retains only its fill. Merge starts from
those fill-only visible faces, unions faces with the same fill swatch, and emits
one object per connected merged component at that swatch's topmost participant.
Crop treats the topmost selected fill strictly as a mask: the mask contributes
no appearance or output of its own, mask-only area is discarded, and underlying
visible faces retain only the fill of their topmost non-mask source.

Outline has an intentionally explicit editable-path contract. It nodes every
selected filled boundary at partition intersections, canonicalizes each
undirected straight segment, and emits that segment exactly once as an open
two-anchor path. Each segment uses the authored stroke of its topmost adjacent
source when one exists; otherwise it receives a one-unit solid stroke in that
source's fill swatch. Outline output has no fill. Keeping the noded segments
separate avoids ambiguous branching and makes every shared or exterior
boundary directly selectable.

The versioned repository source boundary lives in
[`@create-design/source`](../../packages/create-design/source/README.md). Its fourth directory
format splits document metadata, palette, ordered artboards, ordered layers,
and each design object into independently validated units. Artboard order lives
only in its inventory while each artboard's stable ID, name, global bounds,
bleed, and safe-area metadata live in its own unit. Object IDs, display names,
source paths, and stacking order remain independent so ordinary edits produce
narrow Git diffs. Layer order lives only in its inventory; each layer unit owns
its stable ID, name, visibility, lock state, and direct children. Structural
groups have their own units and recursively
reference ordered object or group children. Asset and font inventories reserve
their separate source boundaries. Browser saves preserve every indexed layer,
group, artboard, and object path. Source review labels isolated layer metadata,
layer order, and coordinated hierarchy changes separately while keeping every
old/new parent required by a selective Git commit in one atomic review group.

The repository's [`designs/workbench-poster`](../../designs/workbench-poster)
project is a complete multi-layer source-format example and the default
development workspace. Its Background, Composition, and Lettering layers retain
the singleton fixture's exact PDF, SVG, and PNG output.

The Export tile offers opt-in live PDF and SVG proofs rendered from the actual
generated artifacts. SVG download, preview, and CLI output share one headless
projection and serializer. The SVG proof uses the same coalesced,
generation-safe replacement lifecycle as PDF, keeping the last good artifact
visible and releasing superseded object URLs.

The PDF proof is rendered by the browser's PDF
viewer. PDF lowering is memoized at object, page, and document boundaries, so
ordinary geometry edits reuse unrelated object streams. The last successfully
loaded proof remains visible while a replacement compiles or if an edit makes
the document temporarily invalid.

PDF output runs the shared runtime preflight contract before preview or
download. Invalid page scopes and unsupported material block output. Warnings
and notices remain advisory and never suppress output; the Export tile offers an
ephemeral opt-in check for artwork outside the requested page-region union.
Diagnostics remain separate from canonical source validity and carry stable
target, capability, entity, artboard, and action data for browser and
noninteractive consumers. Exporter extension rules are documented in
[`docs/export-preflight.md`](../../docs/export-preflight.md).

```sh
pnpm --filter create-design dev
pnpm --filter create-design test
pnpm --filter create-design build
pnpm --filter create-design profile:pdf
```

The profile command reports cold and warm projection and serialization timings
for a 500-object document without asserting machine-dependent thresholds.
