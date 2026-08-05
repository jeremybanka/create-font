# @create-design/model

Headless document operations shared by create-design editors, exporters, and
automation. This package owns geometry projection, painted bounds, color
resolution, artboard lookup, and coordinate transforms without depending on a
browser or editor runtime.

## Live contour blends

`createDesignBlend()` captures explicit contour and point correspondence for
two endpoint objects. `resolveDesignBlend()` deterministically derives the
requested intermediate path objects, aggregate diagnostics, and transient
paint swatches without mutating the document. `projectDesignDocumentBlends()`
inserts ready intermediates immediately before the later-painted endpoint;
reordering endpoints therefore moves the derived stack while keeping stable
references.

Compatible contours have equal contour and point counts, equal open/closed
state and fill rules, the persisted first point/order, and the same direction.
Positions, optional handles (missing means a zero-length handle), all six
affine-transform components, stroke metrics, and compatible colors interpolate
linearly. Two CMYK paints remain CMYK. RGB/RGB and mixed RGB/CMYK pairs
interpolate in normalized RGB. A missing fill or stroke and categorical
cap/join differences switch at the midpoint with a warning; unequal dash-array
lengths are errors. Missing endpoints, contours, points, or swatches and
topology mismatches are recoverable errors that suppress only that blend.

A hidden blend or endpoint suppresses intermediates. A locked blend or
endpoint makes all derived steps locked. Bounds cover the intermediate steps,
and selection treats the blend as one unit. Native blend clipboard helpers copy
both endpoints, correspondence, and referenced swatches, then paste fresh
object/contour/point/blend identities as one document edit.

`updateDesignBlend()`, `reverseDesignBlendEndpoint()`, and
`setDesignBlendFirstPoint()` author deterministic live options and endpoint
correspondence without importing the editor. `expandDesignBlend()` retains both
ordinary endpoints, assigns fresh object/contour/point/swatch identities to the
resolved intermediate paths, inserts them at the live projection position, and
removes the live record as one immutable document replacement.

## Output projection

`projectDesignOutput()` is the shared flattening boundary for renderers,
exporters, previews, and interchange. It walks layers and nested groups in
canonical paint order, omits objects hidden by either their object or layer,
keeps locked-layer artwork output-visible, and lowers live blend steps into the
later-painted endpoint's layer and group slot. The returned entries retain
their containing layer and group ancestry for structured output and
diagnostics; formats without editable layers flatten the entry order exactly.
