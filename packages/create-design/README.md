# create-design

`create-design` is a proof-of-concept vector design application related to
`create-font`. It shares the editor command palette and responsive workspace
allocation logic, uses the same Bézier point representation, and exchanges
vectors with `create-font` through its versioned outline clipboard format.

The first output target is PDF through `mondrian.pdf`'s validated object IR.
RGB-authored fills and strokes are emitted with PDF RGB operators and
CMYK-authored paints with native PDF CMYK operators.

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
[`@create-design/source`](../design-source/README.md#coordinate-and-identity-contract).

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
sample to its reconstructed cubic at the fitted parameter. This is a stated,
deterministic construction metric rather than a formal continuous Hausdorff
bound. Points within `1e-7` local units are coincident. Generated curve samples
remain smooth while authored corners keep their cap/join/miter behavior; dash
boundaries remain independent capped regions. The command retains the affine
transform, promotes stroke paint to fill, and assigns fresh stable
contour/control IDs. A source fill is preserved as a fill-only sibling
immediately below the expanded stroke. Wholly zero-length strokes fail without
a history entry; coincident spans are discarded; invalid values fail without
mutation; and self-crossing centerlines fail without mutation at the separate
cleanup/Pathfinder boundary.

The versioned repository source boundary lives in
[`@create-design/source`](../design-source/README.md). Its second directory
format splits document metadata, palette, ordered artboards, layer ordering,
and each design object into independently validated units. Artboard order lives
only in its inventory while each artboard's stable ID, name, global bounds,
bleed, and safe-area metadata live in its own unit. Object IDs, display names,
source paths, and stacking order remain independent so ordinary edits produce
narrow Git diffs. Group, asset, and font inventories reserve future source
boundaries without duplicating facts the current document model cannot yet
represent.

The repository's [`designs/workbench-poster`](../../designs/workbench-poster)
project is a complete source-format example and the default development
workspace.

The Export tile offers an opt-in live PDF proof rendered by the browser's PDF
viewer. PDF lowering is memoized at object, page, and document boundaries, so
ordinary geometry edits reuse unrelated object streams. The last successfully
loaded proof remains visible while a replacement compiles or if an edit makes
the document temporarily invalid.

```sh
pnpm --filter create-design dev
pnpm --filter create-design test
pnpm --filter create-design build
pnpm --filter create-design profile:pdf
```

The profile command reports cold and warm projection and serialization timings
for a 500-object document without asserting machine-dependent thresholds.
