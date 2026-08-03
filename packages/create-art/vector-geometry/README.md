# @create-art/vector-geometry

Application-neutral, deterministic vector geometry primitives shared by
create-art design and font tooling. The package uses the BSL-1.0-licensed,
exact-pinned `clipper2-ts` integer kernel for topology cleanup, and does not
import UI, document-model, canvas, or PDF types.

## Contract

The public boundary uses only immutable `Point`, `Cubic`, `Contour`, and
`Bounds` values:

- `flattenCubic`, `evaluateCubic`, `splitCubic`, and `cubicBounds`
- `intersectSegments`, `intersectPolylines`, `selfIntersections`, and
  `intersectCubicCurves`
- `signedArea`, `contourOrientation`, and `windingNumber`
- `normalizeContour` and `normalizeContours`
- `resolveFilledContours`, `booleanContours`, and `partitionContours`
- `offsetContour` and `boundsOfPoints`
- `expandStroke` and `fitCubicContour`

Every tolerance is an absolute, caller-visible value. Pass any subset of
`GeometryTolerances` to override the defaults:

| Setting         | Default | Meaning                                                        |
| --------------- | ------: | -------------------------------------------------------------- |
| `distance`      |  `1e-8` | Coordinate coincidence and boundary tolerance                  |
| `flatness`      |  `0.25` | Maximum control-to-chord distance accepted by cubic flattening |
| `parameter`     |  `1e-9` | Comparison tolerance in normalized parameter space             |
| `normalization` |  `1e-9` | Coordinate canonicalization grid                               |
| `maxDepth`      |    `20` | Adaptive-subdivision limit                                     |
| `miterLimit`    |     `4` | Miter length divided by absolute offset distance               |

`GeometryError` exposes a stable `code`:

- `INVALID_ARGUMENT`
- `NON_FINITE_COORDINATE`
- `DEGENERATE_CONTOUR`
- `MAX_DEPTH_EXCEEDED`

Normalization snaps coordinates when the requested grid is representable,
removes adjacent/tiny and collinear segments, gives closed contours a canonical
start vertex, assigns outer/island contours counter-clockwise and holes
clockwise, and sorts contour sets by nesting and coordinates. Rotated, reversed,
and reordered equivalent contour sets therefore produce byte-identical JSON.
At coordinates where the requested grid is smaller than IEEE-754 can represent,
the original coordinate is retained instead of introducing a one-ULP rounding
error.

## Exact and approximate operations

Line-segment intersections, winding, signed polygon area, point bounds, and
cubic extrema bounds are analytic within IEEE-754 arithmetic.

Adaptive cubic flattening uses a deterministic left-first de Casteljau
traversal. Its acceptance rule bounds control-to-chord distance; it is a useful
rendering/geometry criterion, not a formal Hausdorff-distance proof. Cubic
intersections are line intersections over those flattened spans and inherit the
configured flattening error.

`booleanContours` resolves each authored contour group independently with
even-odd fill semantics, then combines those regions with integer Unite,
Difference, Intersection, or pairwise Xor topology. Intersection retains
coverage shared by every region, while Xor retains odd object coverage. This
two-stage contract preserves compound holes without
turning overlap between separate objects into XOR. Coordinates are quantized to
at least a `1e-6` grid (or the caller's larger normalization tolerance), unsafe
integer ranges and empty operands fail before returning output, and results use
canonical nesting-aware winding, contour starts, and ordering. Cubic sampling
and reconstruction remain explicit caller responsibilities.

`resolveFilledContours` makes a single compound region's authored `evenodd` or
`nonzero` fill rule explicit, returning canonical even-odd boundary contours
that downstream Boolean operations can consume without losing that intent.

`partitionContours` uses the same filled-region and integer-grid contract to
split every authored region at every other region boundary. Each result is one
connected, non-zero-area component (with any enclosed holes) and carries the
ascending indexes of all source regions that cover it. This makes stacking and
appearance policy an explicit caller concern: Divide can materialize every
piece, while Trim, Merge, and Crop can select or regroup pieces by contributor.
Coincident boundaries are emitted once and tangent contacts do not create
zero-area pieces. A runtime-neutral cancellation signal is checked between
region passes, and progress is reported initially and after each pass so large
multi-object work can run interruptibly in a worker.

`offsetContour` creates a piecewise-linear parallel offset. Positive distance is
to the authored contour's left. It supports bevel and limited-miter joins, but
does not run boolean cleanup, remove loops, or reconstruct cubic curves after a
collapse or self-intersection. Those topology-changing operations belong at the
Boolean cleanup boundary behind this package's data boundary.

`expandStroke` converts a polyline centerline to closed fill contours with
butt, round, or square caps; bevel, limited-miter, or round joins; and SVG/PDF
dash phase semantics. Round pieces use the configured `flatness` as their
maximum chord error. Callers that flatten curves may supply `vertexJoins` so
generated smooth samples use miter intersections while authored corners keep
their requested joins, including after dash splitting. Join intersections are
accepted only on their intended offset rays; inner trims must also stay within
both adjacent segments and the miter limit, otherwise expansion emits a bounded
cusp at the authored vertex. Adjacent points within `distance` are coincident,
a wholly zero-length centerline produces no contours, and invalid style or
non-finite coordinate input throws `GeometryError` before output is returned.
Simple closed strokes produce separate outside and hole contours. If locally
constructed offsets overlap, expansion reruns that centerline through a
quantized integer offset and filled-union cleanup so the painted sweep is
simple while genuine counterforms remain holes. Self-crossing centerlines still
fail deterministically before expansion because their authored fill intent is
ambiguous.

`fitCubicContour` reconstructs a compact cubic contour from sampled points.
`maxError` is checked as a bidirectional nearest-segment envelope between the
source polyline (including segment midpoints) and an adaptively flattened fit;
the fit's own flattening allowance is reserved inside that budget. This
deterministic discrete construction metric is not a formal continuous
Hausdorff proof. A candidate that loops, introduces a self-intersection absent
from the source, or reverses closed-contour winding is split and refitted
locally until it is safe. Turns at or above 30 degrees are exact anchors by
default, while smooth closed contours receive deterministic quarter-length
anchors.

`normalizeContours` infers ordinary hole nesting with nonzero point
classification. Touching and partially overlapping contours are kept
deterministic but are not treated as a boolean arrangement.

## Backend decision

The initial backend is local TypeScript:

- the primitives needed now are small enough to audit against fixtures;
- traversal and sorting decisions are explicit and byte-stable;
- there is no Wasm startup, binary distribution, or cross-language error
  boundary;
- the immutable application-neutral API can remain in place if individual
  operations later move to another backend.

Alternatives evaluated:

- **Paper.js** was rejected because its mutable scene/path model and browser
  heritage are a much larger boundary than these numeric primitives. Its
  normalization and ordering are not the package's explicit contract.
- **PathKit/Skia Wasm** was rejected for the current scope because of binary
  size, initialization, build/distribution maintenance, and backend-version
  sensitivity.
- **A Rust/Wasm backend using kurbo/lyon-style crates** was deferred. Rust is
  attractive for more demanding Pathfinder and outline workloads, but today it
  would add serialization, Wasm toolchain, and error-translation work without
  improving these small primitives. Representative fixtures should become the
  conformance suite if a Rust implementation is introduced.

The test fixtures cover nested holes, tangent contact, collinear overlap,
self-intersection, tiny segments, and coordinates translated to `1e12`.
