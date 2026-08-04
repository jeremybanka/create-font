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
