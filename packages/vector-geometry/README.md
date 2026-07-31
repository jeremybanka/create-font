# @create-art/vector-geometry

Application-neutral, deterministic vector geometry primitives shared by
create-art design and font tooling. The package has no runtime dependencies and
does not import UI, document-model, canvas, or PDF types.

## Contract

The public boundary uses only immutable `Point`, `Cubic`, `Contour`, and
`Bounds` values:

- `flattenCubic`, `evaluateCubic`, `splitCubic`, and `cubicBounds`
- `intersectSegments`, `intersectPolylines`, `selfIntersections`, and
  `intersectCubicCurves`
- `signedArea`, `contourOrientation`, and `windingNumber`
- `normalizeContour` and `normalizeContours`
- `offsetContour` and `boundsOfPoints`

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

`offsetContour` creates a piecewise-linear parallel offset. Positive distance is
to the authored contour's left. It supports bevel and limited-miter joins, but
does not run boolean cleanup, remove loops, or reconstruct cubic curves after a
collapse or self-intersection. Those topology-changing operations belong in a
future Pathfinder backend behind this package's data boundary.

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
  sensitivity. It remains a candidate for mature boolean operations.
- **A Rust/Wasm backend using kurbo/lyon-style crates** was deferred. Rust is
  attractive for more demanding Pathfinder and outline workloads, but today it
  would add serialization, Wasm toolchain, and error-translation work without
  improving these small primitives. Representative fixtures should become the
  conformance suite if a Rust implementation is introduced.

The test fixtures cover nested holes, tangent contact, collinear overlap,
self-intersection, tiny segments, and coordinates translated to `1e12`.
