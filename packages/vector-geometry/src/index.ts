export {
	contourOrientation,
	normalizeContour,
	normalizeContours,
	signedArea,
	windingNumber,
	type NormalizeContourOptions,
	type WindingResult,
} from "./contours.ts"
export {
	cubicBounds,
	evaluateCubic,
	flattenCubic,
	splitCubic,
	type CubicSplit,
} from "./cubic.ts"
export {
	intersectCubicCurves,
	intersectPolylines,
	intersectSegments,
	selfIntersections,
	type CubicIntersection,
	type OverlapIntersection,
	type PointIntersection,
	type PolylineIntersection,
	type SegmentIntersection,
} from "./intersections.ts"
export { offsetContour, type OffsetContourOptions } from "./offset.ts"
export {
	DEFAULT_GEOMETRY_TOLERANCES,
	GeometryError,
	assertFinitePoint,
	resolveGeometryTolerances,
	type GeometryErrorCode,
	type GeometryTolerances,
} from "./tolerances.ts"
export type {
	Bounds,
	Contour,
	Cubic,
	Orientation,
	ParameterizedPoint,
	Point,
} from "./types.ts"
export {
	boundsOfPoints,
	distance,
	interpolate,
	pointOnSegment,
} from "./vector.ts"
