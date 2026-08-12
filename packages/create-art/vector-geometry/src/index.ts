export {
	booleanContours,
	partitionContours,
	resolveFilledContours,
	type BooleanFillRule,
	type BooleanOperationSignal,
	type BooleanContoursOptions,
	type BooleanOperation,
	type ContourPartition,
	type PartitionContoursOptions,
	type PartitionContoursProgress,
	type ResolveFilledContoursOptions,
} from "./boolean.ts"
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
	cornerProfileEligibility,
	lowerCornerProfiles,
	type CornerContour,
	type CornerContourPoint,
	type CornerConvexity,
	type CornerEligibility,
	type CornerIneligibilityReason,
	type CornerProfile,
	type CornerProfileResolution,
	type CornerProfileSetting,
	type CubicContourPoint,
	type LowerCornerProfilesOptions,
	type LoweredCornerContour,
} from "./corner-profiles.ts"
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
export {
	lowerInferredCorners,
	type LoweredInferredCorners,
	type InferredCorner,
	type InferredCornerContour,
	type InferredCornerPoint,
} from "./open-corners.ts"
export { fitCubicContour, type CubicFitOptions } from "./fit.ts"
export { offsetContour, type OffsetContourOptions } from "./offset.ts"
export {
	expandStroke,
	type StrokeExpansionOptions,
	type StrokeJoin,
} from "./stroke.ts"
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
