import {
	type ActorToolkit,
	type ReaderToolkit,
	type RegularAtomToken,
	scopeFamily,
	Silo,
	type TransactionOptions,
	type TransactionToken,
	type WriterToolkit,
} from "atom.io"
import {
	ingestVariableFont,
	withVariableFontSubstitutions,
	CREATE_FONT_FORMAT,
	CREATE_FONT_IR_VERSION,
	type CharacterMapEntrySource,
	type GlyphVariationSource,
	type NamedInstanceSource,
	type PointSource,
	type SimpleGlyphSource,
	type VariableFontSource,
	type VariationAxisSource,
	type VariationRegionSource,
} from "@create-font/target"

import {
	cubicCurveBounds,
	splitCubicCurve,
	straightSegmentHandles,
} from "./curve-geometry.ts"

import {
	collectProjectionResults,
	deepFreeze,
	duplicateValueErrors,
	projectRoundedInteger,
	projectionError,
	projectionFailure,
	projectionSuccess,
	projectionWarning,
} from "./projection.ts"
import {
	CREATE_FONT_EDITOR_FORMAT,
	CREATE_FONT_EDITOR_VERSION,
	type AxisId,
	type ContourId,
	type EditorAxisMapEntrySource,
	type EditorCmapEntrySource,
	type EditorFontSource,
	type EditorGlyphSource,
	type EditorHandleKind,
	type EditorHandleVectorSource,
	type EditorKerningPairSource,
	type EditorMasterSource,
	type EditorNodeMode,
	type EditorPointSource,
	type EditorRuleSource,
	type FontCompilation,
	type GlyphId,
	type InstanceId,
	type MasterId,
	type PointId,
	type ProjectionError,
	type ProjectionResult,
	type ProjectionWarning,
} from "./types.ts"
import {
	buildMasterScalarMatrix,
	normalizeEditorLocation,
	quantizeF2Dot14,
	quantizeFixed16Dot16,
	solveMasterDeltaVectors,
	type MasterScalarMatrix,
	type NormalizedTagLocation,
} from "./variation-model.ts"

const MIN_FIXED = -32_768
const MAX_FIXED = 32_767 + 65_535 / 65_536
const MIN_GLYPH_COORDINATE = -16_384
const MAX_GLYPH_COORDINATE = 16_383
const MIN_INT16 = -32_768
const MAX_INT16 = 32_767
const MAX_UINT16 = 65_535
/** Maximum geometric error accepted before integer coordinate quantization. */
export const CUBIC_TO_QUADRATIC_TOLERANCE = 0.5
export const MAX_CUBIC_SUBDIVISION_DEPTH = 8
const LIVE_PREVIEW_COMPATIBILITY_CODES = new Set([
	"compatibility.path_count",
	"compatibility.closure",
	"compatibility.node_count",
	"compatibility.flattened_count",
	"compatibility.flattened_pattern",
])

export function isLivePreviewCompatibilityError(
	error: Pick<ProjectionError, "code">,
): boolean {
	return LIVE_PREVIEW_COMPATIBILITY_CODES.has(error.code)
}

function isLivePreviewRecoverableGlyphError(
	error: ProjectionError,
	errors: readonly ProjectionError[],
	glyphId: GlyphId,
	defaultMasterId: MasterId,
): boolean {
	if (isLivePreviewCompatibilityError(error)) return true
	if (error.code !== "topology.open_contour") return false
	if (!errors.some((issue) => issue.code === "compatibility.closure")) {
		return false
	}
	const defaultLayerPath = `$.glyphs[${glyphId}].layers[${defaultMasterId}]`
	return !error.path.startsWith(defaultLayerPath)
}

interface Vector2 {
	readonly x: number
	readonly y: number
}

interface CubicBezier {
	readonly p0: Vector2
	readonly c1: Vector2
	readonly c2: Vector2
	readonly p3: Vector2
}

interface QuadraticBezier {
	readonly p0: Vector2
	readonly control: Vector2
	readonly p2: Vector2
}

function midpoint(left: Vector2, right: Vector2): Vector2 {
	return { x: (left.x + right.x) / 2, y: (left.y + right.y) / 2 }
}

function splitCubic(cubic: CubicBezier): readonly [CubicBezier, CubicBezier] {
	const p01 = midpoint(cubic.p0, cubic.c1)
	const p12 = midpoint(cubic.c1, cubic.c2)
	const p23 = midpoint(cubic.c2, cubic.p3)
	const p012 = midpoint(p01, p12)
	const p123 = midpoint(p12, p23)
	const p0123 = midpoint(p012, p123)
	return [
		{ p0: cubic.p0, c1: p01, c2: p012, p3: p0123 },
		{ p0: p0123, c1: p123, c2: p23, p3: cubic.p3 },
	]
}

function quadraticControl(cubic: CubicBezier): Vector2 {
	return {
		x: (3 * (cubic.c1.x + cubic.c2.x) - cubic.p0.x - cubic.p3.x) / 4,
		y: (3 * (cubic.c1.y + cubic.c2.y) - cubic.p0.y - cubic.p3.y) / 4,
	}
}

/**
 * Convex-hull bound for the difference between a cubic and the degree-raised
 * quadratic using `quadraticControl`.
 */
function cubicQuadraticErrorBound(cubic: CubicBezier): number {
	const control = quadraticControl(cubic)
	const raised1 = {
		x: (cubic.p0.x + 2 * control.x) / 3,
		y: (cubic.p0.y + 2 * control.y) / 3,
	}
	const raised2 = {
		x: (2 * control.x + cubic.p3.x) / 3,
		y: (2 * control.y + cubic.p3.y) / 3,
	}
	return Math.max(
		Math.hypot(cubic.c1.x - raised1.x, cubic.c1.y - raised1.y),
		Math.hypot(cubic.c2.x - raised2.x, cubic.c2.y - raised2.y),
	)
}

function cubicsAtDepth(
	cubic: CubicBezier,
	depth: number,
): readonly CubicBezier[] {
	let cubics: readonly CubicBezier[] = [cubic]
	for (let level = 0; level < depth; level += 1) {
		cubics = cubics.flatMap((part) => splitCubic(part))
	}
	return cubics
}

function maximumErrorAtDepth(cubic: CubicBezier, depth: number): number {
	return Math.max(
		0,
		...cubicsAtDepth(cubic, depth).map(cubicQuadraticErrorBound),
	)
}

function quadraticsAtDepth(
	cubic: CubicBezier,
	depth: number,
): readonly QuadraticBezier[] {
	return cubicsAtDepth(cubic, depth).map((part) => ({
		p0: part.p0,
		control: quadraticControl(part),
		p2: part.p3,
	}))
}

function straightQuadraticsAtDepth(
	start: Vector2,
	end: Vector2,
	depth: number,
): readonly QuadraticBezier[] {
	const count = 2 ** depth
	const interpolate = (amount: number): Vector2 => ({
		x: start.x + (end.x - start.x) * amount,
		y: start.y + (end.y - start.y) * amount,
	})
	return Array.from({ length: count }, (_, index) => {
		const startAmount = index / count
		const endAmount = (index + 1) / count
		return {
			p0: interpolate(startAmount),
			control: interpolate((startAmount + endAmount) / 2),
			p2: interpolate(endAmount),
		}
	})
}

export type MasterAxisKey = readonly [masterId: MasterId, axisId: AxisId]
export type InstanceAxisKey = readonly [instanceId: InstanceId, axisId: AxisId]
export type LayerKey = readonly [masterId: MasterId, glyphId: GlyphId]
export type LayerContourKey = readonly [
	masterId: MasterId,
	glyphId: GlyphId,
	contourId: ContourId,
]
export type LayerPointKey = readonly [
	masterId: MasterId,
	glyphId: GlyphId,
	pointId: PointId,
]
export type CurveSegmentKey = readonly [
	masterId: MasterId,
	glyphId: GlyphId,
	contourId: ContourId,
	segmentIndex: number,
]

export interface SetKerningPairInput {
	readonly left: GlyphId
	readonly right: GlyphId
	readonly value: number | null
}

export interface SetGlyphRulesInput {
	readonly glyphId: GlyphId
	readonly rules: readonly EditorRuleSource[]
}

function splitContourId(glyphId: GlyphId, firstPointId: PointId): ContourId {
	return `contour:${glyphId}:split:${firstPointId}`
}

function orientOpenContourEndpoint(
	pointIds: readonly PointId[],
	pointId: PointId,
	position: "first" | "last",
): Readonly<{ pointIds: readonly PointId[]; reversed: boolean }> {
	const index = pointIds.indexOf(pointId)
	if (index !== 0 && index !== pointIds.length - 1) {
		throw new TypeError(`Point ${pointId} is not a dangling endpoint.`)
	}
	const reversed =
		position === "first" ? index === pointIds.length - 1 : index === 0
	return {
		pointIds: reversed ? [...pointIds].reverse() : [...pointIds],
		reversed,
	}
}

function remainingPointRuns(
	pointIds: readonly PointId[],
	deleted: ReadonlySet<PointId>,
	brokenSegmentStarts: ReadonlySet<PointId>,
	closed: boolean,
): readonly (readonly PointId[])[] {
	const hasNextSegment = (index: number): boolean => {
		const nextIndex = index + 1
		if (!closed && nextIndex === pointIds.length) return false
		const startPointId = pointIds[index]
		const endPointId = pointIds[nextIndex % pointIds.length]
		return (
			startPointId !== undefined &&
			endPointId !== undefined &&
			!deleted.has(startPointId) &&
			!deleted.has(endPointId) &&
			!brokenSegmentStarts.has(startPointId)
		)
	}
	const starts = pointIds.flatMap((pointId, index) => {
		if (deleted.has(pointId)) return []
		if (!closed && index === 0) return [index]
		const previousIndex = (index + pointIds.length - 1) % pointIds.length
		return hasNextSegment(previousIndex) ? [] : [index]
	})
	if (starts.length === 0) {
		const remaining = pointIds.filter((pointId) => !deleted.has(pointId))
		return remaining.length > 0 ? [remaining] : []
	}
	const runs: PointId[][] = []
	for (const start of starts) {
		const run: PointId[] = []
		let index = start
		while (true) {
			const pointId = pointIds[index]
			if (pointId === undefined || deleted.has(pointId)) break
			run.push(pointId)
			if (!hasNextSegment(index)) break
			index = (index + 1) % pointIds.length
			if (index === start) break
		}
		if (run.length > 0) runs.push(run)
	}
	return runs
}

interface AxisState {
	readonly tag: string
	readonly name: string
	readonly min: number
	readonly default: number
	readonly max: number
	readonly hidden: boolean
	readonly map: readonly EditorAxisMapEntrySource[] | null
}

interface MasterState {
	readonly kind: EditorMasterSource["kind"]
	readonly name: string
	readonly supportKind: "non-intermediate" | "intermediate"
}

interface InstanceState {
	readonly name: string
	readonly postScriptName: string | null
	readonly elidable: boolean
}

interface GlyphState {
	readonly name: string
	readonly export: boolean
	readonly overlap: boolean
}

interface GlyphEditorState {
	readonly note: string
	readonly color: string | null
	readonly rules: readonly EditorRuleSource[]
}

interface PointState {
	readonly mode: EditorNodeMode
}

export interface CompiledGlyphLayer {
	readonly masterId: MasterId
	readonly glyphId: GlyphId
	readonly contours: readonly (readonly PointSource[])[]
	readonly flattenedPoints: readonly PointSource[]
	readonly advanceWidth: number
	readonly leftSideBearing: number
	readonly xMin: number
}

/** One high-level node exactly as the editor sees it in a particular layer. */
export interface EditorLayerNode {
	readonly pointId: PointId
	readonly mode: EditorNodeMode
	readonly x: number
	readonly y: number
	readonly incoming?: EditorHandleVectorSource
	readonly outgoing?: EditorHandleVectorSource
}

export interface EditorLayerBounds {
	readonly xMin: number
	readonly yMin: number
	readonly xMax: number
	readonly yMax: number
}

export interface CurveSegmentPlan {
	readonly startPointId: PointId
	readonly endPointId: PointId
	readonly curved: boolean
	/** Every master emits `2 ** subdivisionDepth` quadratic controls. */
	readonly subdivisionDepth: number
	/** Worst convex-hull error bound after subdivision, in font units. */
	readonly maximumError: number
}

export interface VariationModelProjection {
	readonly masterIds: readonly MasterId[]
	readonly normalizedLocations: readonly NormalizedTagLocation[]
	readonly regions: readonly VariationRegionSource[]
	readonly scalarMatrix: MasterScalarMatrix
}

export type GlyphCompatibilityKey = readonly [
	referenceMasterId: MasterId,
	comparisonMasterId: MasterId,
	glyphId: GlyphId,
]

export interface CompatibilityEntityLocation {
	readonly masterId: MasterId
	readonly glyphId: GlyphId
	readonly pathIndex: number
	readonly contourId?: ContourId
	readonly nodeIndex?: number
	readonly pointId?: PointId
}

export interface CompatibilityDiagnostic {
	readonly code:
		| "path-count"
		| "closure"
		| "node-count"
		| "flattened-count"
		| "flattened-pattern"
	readonly message: string
	readonly reference: CompatibilityEntityLocation
	readonly comparison: CompatibilityEntityLocation
}

export interface CompatibilityNodeMapping {
	readonly nodeIndex: number
	readonly referencePointId: PointId
	readonly comparisonPointId: PointId
}

export interface CompatibilityPathMapping {
	readonly pathIndex: number
	readonly referenceContourId: ContourId
	readonly comparisonContourId: ContourId
	readonly nodes: readonly CompatibilityNodeMapping[]
}

export interface GlyphCompatibility {
	readonly glyphId: GlyphId
	readonly referenceMasterId: MasterId
	readonly comparisonMasterId: MasterId
	readonly compatible: boolean
	readonly paths: readonly CompatibilityPathMapping[]
	readonly diagnostics: readonly CompatibilityDiagnostic[]
}

export interface MovePointInput {
	readonly pointId: PointId
	readonly x: number
	readonly y: number
}

export interface MovePointsInput {
	readonly masterId: MasterId
	readonly glyphId: GlyphId
	readonly points: readonly MovePointInput[]
}

export interface SetHorizontalMetricsInput {
	readonly masterId: MasterId
	readonly glyphId: GlyphId
	readonly advanceWidth: number
}

export interface MoveHandleInput {
	readonly masterId: MasterId
	readonly glyphId: GlyphId
	readonly pointId: PointId
	readonly handle: EditorHandleKind
	/** Relative vector from the owning node, or null to remove the handle. */
	readonly vector: EditorHandleVectorSource | null
}

export interface TransformControlsInput {
	readonly masterId: MasterId
	readonly glyphId: GlyphId
	readonly points: readonly MovePointInput[]
	/** Final absolute endpoint positions; state converts them to relative vectors. */
	readonly handles: readonly {
		readonly pointId: PointId
		readonly handle: EditorHandleKind
		readonly x: number
		readonly y: number
	}[]
}

export interface SlideSoftNodeInput {
	readonly masterId: MasterId
	readonly glyphId: GlyphId
	readonly pointId: PointId
	readonly x: number
	readonly y: number
	/** Immutable absolute endpoints captured by the editor gesture. */
	readonly handles: readonly {
		readonly handle: EditorHandleKind
		readonly x: number
		readonly y: number
	}[]
	/** Stable ray for an otherwise directionless zero-length open endpoint. */
	readonly unboundedDirection?: Readonly<{ x: number; y: number }>
}

export interface SplitSegmentInput {
	readonly masterId: MasterId
	readonly glyphId: GlyphId
	readonly contourId: ContourId
	readonly segmentIndex: number
	readonly pointId: PointId
	/** Curve parameter applied to this master-local segment. */
	readonly amount: number
}

export interface CutSegmentInput {
	readonly masterId: MasterId
	readonly glyphId: GlyphId
	readonly contourId: ContourId
	readonly segmentIndex: number
	/** Distinct endpoint IDs created at the same cut coordinate. */
	readonly leftPointId: PointId
	readonly rightPointId: PointId
	/** Required when cutting an open contour; ignored for a closed contour. */
	readonly rightContourId?: ContourId
	/** Curve parameter applied to this master-local segment. */
	readonly amount: number
}

export interface JoinOpenContoursInput {
	readonly masterId: MasterId
	readonly glyphId: GlyphId
	readonly draggedContourId: ContourId
	readonly draggedPointId: PointId
	readonly targetContourId: ContourId
	readonly targetPointId: PointId
	/** Optional group transform committed atomically before joining. */
	readonly transform?: TransformControlsInput
}

export interface AddSegmentHandlesInput {
	readonly masterId: MasterId
	readonly glyphId: GlyphId
	readonly contourId: ContourId
	readonly segmentIndex: number
}

export interface ReverseContourInput {
	readonly masterId: MasterId
	readonly glyphId: GlyphId
	readonly contourId: ContourId
}

export interface InvertContourInput extends ReverseContourInput {
	readonly axis: "horizontal" | "vertical"
	/** Center of the visible control bounds on the active master. */
	readonly centerX: number
	readonly centerY: number
}

export interface MakeNodeFirstInput extends ReverseContourInput {
	readonly pointId: PointId
}

export interface SetNodeModeInput {
	readonly masterId: MasterId
	readonly glyphId: GlyphId
	readonly pointId: PointId
	readonly mode: EditorNodeMode
}

export interface ToggleNodeModesInput {
	readonly masterId: MasterId
	readonly glyphId: GlyphId
	/** Ordered selection targets. Duplicate point IDs are ignored after the first. */
	readonly pointIds: readonly PointId[]
}

export interface ToggleNodeModesResult {
	readonly toggled: number
	readonly skipped: number
}

export interface InsertPointInput {
	readonly masterId: MasterId
	readonly glyphId: GlyphId
	readonly contourId: ContourId
	readonly at?: number
	readonly point: {
		readonly id: PointId
		readonly mode: EditorNodeMode
	}
	readonly coordinates: readonly {
		readonly masterId: MasterId
		readonly x: number
		readonly y: number
		readonly incoming?: EditorHandleVectorSource
		readonly outgoing?: EditorHandleVectorSource
	}[]
}

export interface AuthorPenEndpointInput {
	readonly masterId: MasterId
	readonly glyphId: GlyphId
	readonly contourId: ContourId
	readonly pointId: PointId
	readonly forwardHandle: EditorHandleKind
	readonly mode: EditorNodeMode
	readonly coordinates: readonly {
		readonly masterId: MasterId
		readonly forward: EditorHandleVectorSource | null
	}[]
}

export interface CreateContourInput {
	readonly masterId: MasterId
	readonly glyphId: GlyphId
	readonly contourId: ContourId
	readonly point: {
		readonly id: PointId
		readonly mode: EditorNodeMode
	}
	readonly coordinates: readonly {
		readonly masterId: MasterId
		readonly x: number
		readonly y: number
		readonly incoming?: EditorHandleVectorSource
		readonly outgoing?: EditorHandleVectorSource
	}[]
}

export interface AuthoringContourInput {
	readonly id: ContourId
	readonly closed: boolean
	readonly points: readonly EditorPointSource[]
}

export interface AuthoringLayerPointInput {
	readonly pointId: PointId
	readonly x: number
	readonly y: number
	readonly incoming?: EditorHandleVectorSource
	readonly outgoing?: EditorHandleVectorSource
}

/** Complete outline fragments ready to append to an existing glyph. */
export interface PasteContoursInput {
	readonly masterId: MasterId
	readonly glyphId: GlyphId
	readonly contours: readonly AuthoringContourInput[]
	readonly layers: readonly {
		readonly masterId: MasterId
		readonly points: readonly AuthoringLayerPointInput[]
	}[]
}

/** One complete closed contour ready to append as a single authoring edit. */
export interface CreateCompleteContourInput {
	readonly masterId: MasterId
	readonly glyphId: GlyphId
	readonly contour: AuthoringContourInput
	readonly layers: readonly {
		readonly masterId: MasterId
		readonly points: readonly AuthoringLayerPointInput[]
	}[]
}

export interface SetContourClosedInput {
	readonly masterId: MasterId
	readonly glyphId: GlyphId
	readonly contourId: ContourId
	readonly closed: boolean
}

export interface ReorderContourInput {
	readonly masterId: MasterId
	readonly glyphId: GlyphId
	readonly contourId: ContourId
	readonly toIndex: number
}

export interface CloseContourInput {
	readonly masterId: MasterId
	readonly glyphId: GlyphId
	readonly contourId: ContourId
	/** Omit for a click closure that preserves the first point's authored handles. */
	readonly firstPoint?: {
		readonly pointId: PointId
		readonly mode: "soft"
		readonly coordinates: readonly {
			readonly masterId: MasterId
			readonly incoming: EditorHandleVectorSource
			readonly outgoing: EditorHandleVectorSource
		}[]
	}
	/** Omit for a click closure that preserves the last point's authored handles. */
	readonly lastPoint?: {
		readonly pointId: PointId
		readonly mode: "soft"
		readonly coordinates: readonly {
			readonly masterId: MasterId
			readonly incoming: EditorHandleVectorSource
			readonly outgoing: EditorHandleVectorSource
		}[]
	}
}

export interface DeleteSelectionInput {
	readonly masterId: MasterId
	readonly glyphId: GlyphId
	readonly pointIds: readonly PointId[]
	readonly handles: readonly {
		readonly pointId: PointId
		readonly handle: EditorHandleKind
	}[]
	/**
	 * Break affected paths into open pieces instead of reconnecting them. A
	 * selected incoming handle breaks the preceding segment; an outgoing handle
	 * breaks the following segment.
	 */
	readonly breakPaths?: boolean
}

export interface CreateFontEditorStateOptions {
	/** Diagnostic name for this document's isolated Silo. */
	readonly key: string
	readonly isProduction?: boolean
}

/** A caller-owned plain atom/value pair committed with a whole-document load. */
export interface FontLoadCoWrite<Value> {
	readonly atom: RegularAtomToken<Value>
	readonly value: Value extends PromiseLike<unknown> ? never : Value
}

interface FontLoadCoWriteCandidate {
	readonly atom: RegularAtomToken<unknown>
	readonly value: unknown
}

/**
 * Validates a heterogeneous tuple of caller-owned atom/value pairs without
 * widening away each pair's value association.
 */
export type FontLoadCoWrites<
	Candidates extends readonly FontLoadCoWriteCandidate[],
> = {
	readonly [Index in keyof Candidates]: Candidates[Index] extends {
		readonly atom: RegularAtomToken<infer Value>
		readonly value: infer ActualValue
	}
		? [Value] extends [PromiseLike<unknown>]
			? never
			: [ActualValue] extends [Value]
				? FontLoadCoWrite<Value>
				: never
		: never
}

type ErasedFontLoadCoWrites = readonly FontLoadCoWrite<unknown>[]

function resultWithWarnings<Value>(
	result: ProjectionResult<Value>,
	warnings: readonly ProjectionWarning[],
): ProjectionResult<Value> {
	return result.ok
		? projectionSuccess(result.value, [...warnings, ...result.warnings])
		: projectionFailure(result.errors, [...warnings, ...result.warnings])
}

function projectFixed(
	value: number | null,
	path: string,
	entityId?: AxisId,
): ProjectionResult<number> {
	if (
		value === null ||
		!Number.isFinite(value) ||
		value < MIN_FIXED ||
		value > MAX_FIXED
	) {
		return projectionFailure([
			projectionError(
				"number.fixed_range",
				path,
				"Expected a finite value in the signed Fixed16.16 domain.",
				entityId,
			),
		])
	}
	const quantized = quantizeFixed16Dot16(value)
	const warnings =
		quantized === value
			? []
			: [
					projectionWarning(
						"number.fixed_quantized",
						path,
						`Editor value ${value} was quantized to Fixed16.16 value ${quantized}.`,
						entityId,
					),
				]
	return projectionSuccess(quantized, warnings)
}

function projectAxisMapValue(
	value: number,
	path: string,
	entityId: AxisId,
): ProjectionResult<number> {
	if (!Number.isFinite(value) || value < -1 || value > 1) {
		return projectionFailure([
			projectionError(
				"number.f2dot14_range",
				path,
				"Expected a finite normalized coordinate in [-1, 1].",
				entityId,
			),
		])
	}
	const quantized = quantizeF2Dot14(value)
	const warnings =
		quantized === value
			? []
			: [
					projectionWarning(
						"number.f2dot14_quantized",
						path,
						`Editor value ${value} was quantized to F2Dot14 value ${quantized}.`,
						entityId,
					),
				]
	return projectionSuccess(quantized, warnings)
}

function xMinOf(points: readonly PointSource[]): number {
	let minimum = 0
	let hasPoint = false
	for (const point of points) {
		minimum = hasPoint ? Math.min(minimum, point.x) : point.x
		hasPoint = true
	}
	return minimum
}

function assertUnique<Value extends string | number>(
	values: readonly Value[],
	label: string,
): void {
	if (new Set(values).size !== values.length) {
		throw new TypeError(`${label} must contain unique values.`)
	}
}

function assertKnownLocationAxes(
	location: Readonly<Record<string, number | undefined>>,
	axisIds: ReadonlySet<AxisId>,
	label: string,
): void {
	for (const axisId of Object.keys(location)) {
		if (!axisIds.has(axisId as AxisId)) {
			throw new TypeError(`${label} refers to unknown axis ${axisId}.`)
		}
	}
}

function assertFiniteVector(
	vector: EditorHandleVectorSource,
	label: string,
): void {
	if (!Number.isFinite(vector.x) || !Number.isFinite(vector.y)) {
		throw new TypeError(`${label} must contain finite coordinates.`)
	}
}

function handlesShareOppositeRay(
	incoming: EditorHandleVectorSource,
	outgoing: EditorHandleVectorSource,
): boolean {
	const scale = Math.max(
		1,
		Math.hypot(incoming.x, incoming.y) * Math.hypot(outgoing.x, outgoing.y),
	)
	const cross = incoming.x * outgoing.y - incoming.y * outgoing.x
	const dot = incoming.x * outgoing.x + incoming.y * outgoing.y
	return Math.abs(cross) <= Number.EPSILON * 32 * scale && dot <= 0
}

function vectorWithLengthAlong(
	direction: Vector2,
	length: number,
): Vector2 | null {
	const directionLength = Math.hypot(direction.x, direction.y)
	if (directionLength === 0) return null
	const x = (direction.x / directionLength) * length
	const y = (direction.y / directionLength) * length
	return {
		x: Object.is(x, -0) ? 0 : x,
		y: Object.is(y, -0) ? 0 : y,
	}
}

function validateEditorSourceStructure(source: EditorFontSource): void {
	if (source.format !== CREATE_FONT_EDITOR_FORMAT) {
		throw new TypeError(`Expected editor format ${CREATE_FONT_EDITOR_FORMAT}.`)
	}
	if (source.editorVersion !== CREATE_FONT_EDITOR_VERSION) {
		throw new TypeError(
			`Expected editor version ${CREATE_FONT_EDITOR_VERSION}.`,
		)
	}
	assertUnique(
		source.axes.map((axis) => axis.id),
		"Axis IDs",
	)
	assertUnique(
		source.masters.map((master) => master.id),
		"Master IDs",
	)
	assertUnique(
		source.instances.map((instance) => instance.id),
		"Instance IDs",
	)
	assertUnique(
		source.glyphs.map((glyph) => glyph.id),
		"Glyph IDs",
	)
	assertUnique(
		source.cmap.map((entry) => entry.codePoint),
		"Cmap code points",
	)
	assertUnique(
		(source.kerning ?? []).map((pair) => `${pair.left}/${pair.right}`),
		"Kerning pairs",
	)

	const axisIds = new Set(source.axes.map((axis) => axis.id))
	const masterIds = new Set(source.masters.map((master) => master.id))
	const glyphIds = new Set(source.glyphs.map((glyph) => glyph.id))
	const defaultMasters = source.masters.filter(
		(master) => master.kind === "default",
	)
	if (
		defaultMasters.length !== 1 ||
		defaultMasters[0]?.id !== source.defaultMasterId
	) {
		throw new TypeError(
			"Exactly one default master must match defaultMasterId.",
		)
	}

	for (const master of source.masters) {
		if (master.kind !== "source") continue
		assertKnownLocationAxes(
			master.location,
			axisIds,
			`Master ${master.id} location`,
		)
		if (master.support.kind === "intermediate") {
			assertKnownLocationAxes(
				master.support.start,
				axisIds,
				`Master ${master.id} support start`,
			)
			assertKnownLocationAxes(
				master.support.end,
				axisIds,
				`Master ${master.id} support end`,
			)
		}
	}
	for (const instance of source.instances) {
		assertKnownLocationAxes(
			instance.coordinates,
			axisIds,
			`Instance ${instance.id} coordinates`,
		)
	}

	for (const glyph of source.glyphs) {
		assertUnique(
			glyph.layers.map((layer) => layer.masterId),
			`Layer master IDs in glyph ${glyph.id}`,
		)
		for (const layer of glyph.layers) {
			if (!masterIds.has(layer.masterId)) {
				throw new TypeError(
					`Glyph ${glyph.id} layer refers to unknown master ${layer.masterId}.`,
				)
			}
			assertUnique(
				layer.contours.map((contour) => contour.id),
				`Contour IDs in ${glyph.id}/${layer.masterId}`,
			)
			const pointIds = new Set<PointId>()
			for (const contour of layer.contours) {
				if (typeof contour.closed !== "boolean") {
					throw new TypeError(
						`Contour ${contour.id} must declare closed state.`,
					)
				}
				assertUnique(
					contour.points.map((point) => point.id),
					`Point IDs in contour ${contour.id}`,
				)
				for (const point of contour.points) {
					if (point.mode !== "soft" && point.mode !== "hard") {
						throw new TypeError(`Point ${point.id} has an invalid node mode.`)
					}
					if (pointIds.has(point.id)) {
						throw new TypeError(
							`Point ID ${point.id} may occur only once in ${glyph.id}/${layer.masterId}.`,
						)
					}
					pointIds.add(point.id)
					if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
						throw new TypeError(
							`Glyph ${glyph.id} layer point ${point.id} must contain finite coordinates.`,
						)
					}
					if (point.incoming !== undefined) {
						assertFiniteVector(
							point.incoming,
							`Incoming handle for ${point.id}`,
						)
					}
					if (point.outgoing !== undefined) {
						assertFiniteVector(
							point.outgoing,
							`Outgoing handle for ${point.id}`,
						)
					}
					if (point.mode === "soft") {
						if (point.incoming === undefined && point.outgoing === undefined) {
							throw new TypeError(
								`Soft node ${point.id} must have at least one handle.`,
							)
						}
						if (
							point.incoming !== undefined &&
							point.outgoing !== undefined &&
							!handlesShareOppositeRay(point.incoming, point.outgoing)
						) {
							throw new TypeError(
								`Soft node ${point.id} handles must be collinear and opposite.`,
							)
						}
					}
				}
			}
		}
		const ruleIds = new Set<string>()
		for (const rule of glyph.rules ?? []) {
			if (ruleIds.has(rule.id))
				throw new TypeError(`Duplicate rule ID ${rule.id}.`)
			ruleIds.add(rule.id)
			for (const point of [rule.a, rule.b])
				assertFiniteVector(point, `Rule ${rule.id}`)
			if (Math.hypot(rule.b.x - rule.a.x, rule.b.y - rule.a.y) <= 1e-6)
				throw new TypeError(`Rule ${rule.id} endpoints must be distinct.`)
		}
	}
	for (const entry of source.cmap) {
		if (!Number.isInteger(entry.codePoint)) {
			throw new TypeError("Cmap code points must be integers.")
		}
		if (!glyphIds.has(entry.glyphId)) {
			throw new TypeError(
				`Cmap entry refers to unknown glyph ${entry.glyphId}.`,
			)
		}
	}
	for (const pair of source.kerning ?? []) {
		if (!glyphIds.has(pair.left) || !glyphIds.has(pair.right))
			throw new TypeError("Kerning pairs must refer to known glyphs.")
		if (
			!Number.isInteger(pair.value) ||
			pair.value < MIN_INT16 ||
			pair.value > MAX_INT16
		)
			throw new TypeError("Kerning values must be signed 16-bit integers.")
	}
}

/**
 * Creates one isolated, editor-document state graph. No implicit atom.io store
 * is touched; every token and operation belongs to the returned Silo.
 */
export function createFontEditorState(options: CreateFontEditorStateOptions) {
	if (options.key.trim().length === 0) {
		throw new TypeError("A font editor Silo name cannot be empty.")
	}
	const silo = new Silo({
		name: options.key,
		lifespan: "ephemeral",
		isProduction: options.isProduction ?? false,
	})
	const metadataAtom = silo.atom<EditorFontSource["metadata"] | null>({
		key: "metadata",
		default: null,
	})
	const namesAtom = silo.atom<EditorFontSource["names"] | null>({
		key: "names",
		default: null,
	})
	const metricsAtom = silo.atom<EditorFontSource["metrics"] | null>({
		key: "metrics",
		default: null,
	})
	const styleAtom = silo.atom<EditorFontSource["style"] | null>({
		key: "style",
		default: null,
	})
	const documentRevisionAtom = silo.atom<number>({
		key: "documentRevision",
		default: 0,
	})
	// Aggregate projections use this shallow edge instead of subscribing to every
	// family member. Keep it in the transaction commit so direct transaction
	// callers cannot publish authoring state without invalidating those caches.
	type EditorTransactionFunction = (...parameters: never[]) => unknown
	type RevisionedTransactionOptions<F extends EditorTransactionFunction> =
		TransactionOptions<F> &
			Readonly<{
				shouldRevise?: (result: ReturnType<F>) => boolean
			}>
	const revisionedTransaction = <F extends EditorTransactionFunction>(
		options: RevisionedTransactionOptions<F>,
	): TransactionToken<F> =>
		silo.transaction<F>({
			key: options.key,
			do: (toolkit: ActorToolkit, ...parameters: Parameters<F>) => {
				// Explicit early-return no-ops should not invalidate aggregate projections.
				// Observe public toolkit writes without coupling to atom.io internals.
				let wroteState = false
				const trackedToolkit = new Proxy(toolkit, {
					get: (target, property, receiver) => {
						if (property !== "set")
							return Reflect.get(target, property, receiver)
						return (...setParameters: unknown[]) => {
							wroteState = true
							return Reflect.apply(target.set, target, setParameters)
						}
					},
				})
				const result = options.do(trackedToolkit, ...parameters)
				if (wroteState && (options.shouldRevise?.(result) ?? true)) {
					toolkit.set(documentRevisionAtom, (revision) => revision + 1)
				}
				return result
			},
		})
	const markDocumentChanged = (): void => {
		silo.setState(documentRevisionAtom, (revision) => revision + 1)
	}

	const axisIdsAtom = silo.atom<readonly AxisId[]>({
		key: "axisIds",
		default: Object.freeze([]),
	})
	const masterIdsAtom = silo.atom<readonly MasterId[]>({
		key: "masterIds",
		default: Object.freeze([]),
	})
	const defaultMasterIdAtom = silo.atom<MasterId | null>({
		key: "defaultMasterId",
		default: null,
	})
	const instanceIdsAtom = silo.atom<readonly InstanceId[]>({
		key: "instanceIds",
		default: Object.freeze([]),
	})
	const glyphIdsAtom = silo.atom<readonly GlyphId[]>({
		key: "glyphIds",
		default: Object.freeze([]),
	})
	const featureSubstitutionsAtom = silo.atom<
		readonly {
			readonly feature: string
			readonly from: readonly GlyphId[]
			readonly to: GlyphId
			readonly contextIndex?: number
		}[]
	>({
		key: "featureSubstitutions",
		default: Object.freeze([]),
	})
	const cmapCodePointsAtom = silo.atom<readonly number[]>({
		key: "cmapCodePoints",
		default: Object.freeze([]),
	})
	const kerningAtom = silo.atom<readonly EditorKerningPairSource[]>({
		key: "kerning",
		default: Object.freeze([]),
	})
	const kerningTimeline = silo.timeline({
		key: "kerning",
		scope: [kerningAtom],
	})

	const axisAtoms = silo.atomFamily<AxisState | null, AxisId>({
		key: "axis",
		default: null,
	})
	const masterAtoms = silo.atomFamily<MasterState | null, MasterId>({
		key: "master",
		default: null,
	})
	const masterCoordinateAtoms = silo.atomFamily<number | null, MasterAxisKey>({
		key: "masterCoordinate",
		default: null,
	})
	const masterSupportStartAtoms = silo.atomFamily<number | null, MasterAxisKey>(
		{
			key: "masterSupportStart",
			default: null,
		},
	)
	const masterSupportEndAtoms = silo.atomFamily<number | null, MasterAxisKey>({
		key: "masterSupportEnd",
		default: null,
	})
	const instanceAtoms = silo.atomFamily<InstanceState | null, InstanceId>({
		key: "instance",
		default: null,
	})
	const instanceCoordinateAtoms = silo.atomFamily<
		number | null,
		InstanceAxisKey
	>({
		key: "instanceCoordinate",
		default: null,
	})
	const glyphAtoms = silo.atomFamily<GlyphState | null, GlyphId>({
		key: "glyph",
		default: null,
	})
	const glyphEditorAtoms = silo.atomFamily<GlyphEditorState | null, GlyphId>({
		key: "glyphEditor",
		default: null,
	})
	const glyphContourIdsAtoms = silo.atomFamily<
		readonly ContourId[] | null,
		LayerKey
	>({
		key: "glyphContourIds",
		default: null,
	})
	const contourPointIdsAtoms = silo.atomFamily<
		readonly PointId[] | null,
		LayerContourKey
	>({
		key: "contourPointIds",
		default: null,
	})
	const contourClosedAtoms = silo.atomFamily<boolean | null, LayerContourKey>({
		key: "contourClosed",
		default: null,
	})
	const pointAtoms = silo.atomFamily<PointState | null, LayerPointKey>({
		key: "point",
		default: null,
	})
	const glyphLayerMasterIdsAtoms = silo.atomFamily<
		readonly MasterId[] | null,
		GlyphId
	>({
		key: "glyphLayerMasterIds",
		default: null,
	})
	const advanceWidthValueAtoms = silo.atomFamily<number | null, LayerKey>({
		key: "advanceWidthValue",
		default: null,
	})
	const pointPositionValueAtoms = silo.atomFamily<
		Vector2 | null,
		LayerPointKey
	>({
		key: "pointPositionValue",
		default: null,
	})
	const readAdvanceWidth = (
		get: ReaderToolkit["get"],
		key: LayerKey,
	): number | null => get(advanceWidthValueAtoms, key)
	const writeAdvanceWidth = (
		get: WriterToolkit["get"],
		set: WriterToolkit["set"],
		key: LayerKey,
		advanceWidth: number | null,
	): void => {
		if (get(advanceWidthValueAtoms, key) === advanceWidth) return
		set(advanceWidthValueAtoms, key, advanceWidth)
	}
	const advanceWidthSelectors = silo.selectorFamily<number | null, LayerKey>({
		key: "advanceWidth",
		get:
			(key) =>
			({ get }) =>
				readAdvanceWidth(get, key),
		set:
			(key) =>
			({ get, set }, advanceWidth) =>
				writeAdvanceWidth(get, set, key, advanceWidth),
	})
	const readPointPosition = (
		get: ReaderToolkit["get"],
		key: LayerPointKey,
	): Vector2 | null => get(pointPositionValueAtoms, key)
	const writePointPosition = (
		get: WriterToolkit["get"],
		set: WriterToolkit["set"],
		key: LayerPointKey,
		nextPosition: Vector2 | null,
	): void => {
		const currentPosition = get(pointPositionValueAtoms, key)
		if (
			currentPosition === nextPosition ||
			(currentPosition !== null &&
				nextPosition !== null &&
				currentPosition.x === nextPosition.x &&
				currentPosition.y === nextPosition.y)
		)
			return
		set(
			pointPositionValueAtoms,
			key,
			nextPosition === null ? null : deepFreeze(nextPosition),
		)
	}
	const pointPositionSelectors = silo.selectorFamily<
		Vector2 | null,
		LayerPointKey
	>({
		key: "pointPosition",
		get:
			(key) =>
			({ get }) =>
				readPointPosition(get, key),
		set:
			(key) =>
			({ get, set }, nextPosition) =>
				writePointPosition(get, set, key, nextPosition),
	})
	const writePointPositions = (
		set: WriterToolkit["set"],
		[masterId, glyphId]: LayerKey,
		nextPositions: readonly Readonly<{ pointId: PointId; position: Vector2 }>[],
	): void => {
		for (const { pointId, position } of nextPositions) {
			set(
				pointPositionValueAtoms,
				[masterId, glyphId, pointId],
				deepFreeze({ ...position }),
			)
		}
	}
	const incomingHandleXAtoms = silo.atomFamily<number | null, LayerPointKey>({
		key: "incomingHandleX",
		default: null,
	})
	const incomingHandleYAtoms = silo.atomFamily<number | null, LayerPointKey>({
		key: "incomingHandleY",
		default: null,
	})
	const outgoingHandleXAtoms = silo.atomFamily<number | null, LayerPointKey>({
		key: "outgoingHandleX",
		default: null,
	})
	const outgoingHandleYAtoms = silo.atomFamily<number | null, LayerPointKey>({
		key: "outgoingHandleY",
		default: null,
	})
	const writeHandleVector = (
		set: WriterToolkit["set"],
		key: LayerPointKey,
		handle: EditorHandleKind,
		vector: Vector2 | undefined,
	): void => {
		set(
			handle === "incoming" ? incomingHandleXAtoms : outgoingHandleXAtoms,
			key,
			vector?.x ?? null,
		)
		set(
			handle === "incoming" ? incomingHandleYAtoms : outgoingHandleYAtoms,
			key,
			vector?.y ?? null,
		)
	}
	const clearLayerPoint = (
		set: WriterToolkit["set"],
		key: LayerPointKey,
	): void => {
		set(pointPositionValueAtoms, key, null)
		writeHandleVector(set, key, "incoming", undefined)
		writeHandleVector(set, key, "outgoing", undefined)
	}
	const cmapGlyphAtoms = silo.atomFamily<GlyphId | null, number>({
		key: "cmapGlyph",
		default: null,
	})
	const coreOwnedAtomTokens = new Set<RegularAtomToken<unknown>>([
		metadataAtom,
		namesAtom,
		metricsAtom,
		styleAtom,
		documentRevisionAtom,
		axisIdsAtom,
		masterIdsAtom,
		defaultMasterIdAtom,
		instanceIdsAtom,
		glyphIdsAtom,
		featureSubstitutionsAtom,
		cmapCodePointsAtom,
		kerningAtom,
	])
	const coreOwnedAtomKeys = new Set(
		[...coreOwnedAtomTokens].map((atom) => atom.key),
	)
	const coreOwnedAtomFamilyKeys = new Set([
		axisAtoms.key,
		masterAtoms.key,
		masterCoordinateAtoms.key,
		masterSupportStartAtoms.key,
		masterSupportEndAtoms.key,
		instanceAtoms.key,
		instanceCoordinateAtoms.key,
		glyphAtoms.key,
		glyphEditorAtoms.key,
		glyphContourIdsAtoms.key,
		contourPointIdsAtoms.key,
		contourClosedAtoms.key,
		pointAtoms.key,
		glyphLayerMasterIdsAtoms.key,
		advanceWidthValueAtoms.key,
		pointPositionValueAtoms.key,
		incomingHandleXAtoms.key,
		incomingHandleYAtoms.key,
		outgoingHandleXAtoms.key,
		outgoingHandleYAtoms.key,
		cmapGlyphAtoms.key,
	])
	const assertCallerOwnedLoadAtom = (atom: RegularAtomToken<unknown>): void => {
		if (
			atom.type !== "atom" ||
			coreOwnedAtomTokens.has(atom) ||
			coreOwnedAtomKeys.has(atom.key) ||
			(atom.family !== undefined &&
				coreOwnedAtomFamilyKeys.has(atom.family.key))
		) {
			throw new TypeError(
				"A font-load co-write requires a caller-owned plain atom.",
			)
		}
	}
	const isThenable = (value: unknown): value is PromiseLike<unknown> => {
		if (
			(typeof value !== "object" || value === null) &&
			typeof value !== "function"
		) {
			return false
		}
		return typeof Reflect.get(value, "then") === "function"
	}
	const glyphHistoryTimelines = silo.timelineFamily<GlyphId>({
		key: "glyphHistory",
		scope: [
			scopeFamily(glyphAtoms, { timelineKey: (glyphId) => glyphId }),
			scopeFamily(glyphEditorAtoms, { timelineKey: (glyphId) => glyphId }),
			scopeFamily(glyphContourIdsAtoms, {
				timelineKey: ([, glyphId]) => glyphId,
			}),
			scopeFamily(glyphLayerMasterIdsAtoms, {
				timelineKey: (glyphId) => glyphId,
			}),
			scopeFamily(contourPointIdsAtoms, {
				timelineKey: ([, glyphId]) => glyphId,
			}),
			scopeFamily(contourClosedAtoms, {
				timelineKey: ([, glyphId]) => glyphId,
			}),
			scopeFamily(pointAtoms, {
				timelineKey: ([, glyphId]) => glyphId,
			}),
			scopeFamily(advanceWidthValueAtoms, {
				timelineKey: ([, glyphId]) => glyphId,
			}),
			scopeFamily(pointPositionValueAtoms, {
				timelineKey: ([, glyphId]) => glyphId,
			}),
			scopeFamily(incomingHandleXAtoms, {
				timelineKey: ([, glyphId]) => glyphId,
			}),
			scopeFamily(incomingHandleYAtoms, {
				timelineKey: ([, glyphId]) => glyphId,
			}),
			scopeFamily(outgoingHandleXAtoms, {
				timelineKey: ([, glyphId]) => glyphId,
			}),
			scopeFamily(outgoingHandleYAtoms, {
				timelineKey: ([, glyphId]) => glyphId,
			}),
		],
	})

	const layerNodeSelectors = silo.selectorFamily<
		ProjectionResult<EditorLayerNode>,
		LayerPointKey
	>({
		key: "layerNode",
		get:
			([masterId, glyphId, pointId]) =>
			({ get }) => {
				const path = `$.glyphs[${glyphId}].layers[${masterId}].points[${pointId}]`
				const topology = get(pointAtoms, [masterId, glyphId, pointId])
				const position = readPointPosition(get, [masterId, glyphId, pointId])
				const x = position?.x ?? null
				const y = position?.y ?? null
				const errors: ProjectionError[] = []
				if (topology === null) {
					errors.push(
						projectionError(
							"topology.missing",
							`$.glyphs[${glyphId}].points[${pointId}]`,
							"Node topology is missing.",
							pointId,
						),
					)
				}
				if (x === null || !Number.isFinite(x)) {
					errors.push(
						projectionError(
							"number.missing_or_nonfinite",
							`${path}.x`,
							"Expected a finite node x coordinate.",
							pointId,
						),
					)
				}
				if (y === null || !Number.isFinite(y)) {
					errors.push(
						projectionError(
							"number.missing_or_nonfinite",
							`${path}.y`,
							"Expected a finite node y coordinate.",
							pointId,
						),
					)
				}

				const readHandle = (
					kind: EditorHandleKind,
				): EditorHandleVectorSource | undefined => {
					const atomKey: LayerPointKey = [masterId, glyphId, pointId]
					const handleX = get(
						kind === "incoming" ? incomingHandleXAtoms : outgoingHandleXAtoms,
						atomKey,
					)
					const handleY = get(
						kind === "incoming" ? incomingHandleYAtoms : outgoingHandleYAtoms,
						atomKey,
					)
					if (handleX === null && handleY === null) return undefined
					if (
						handleX === null ||
						handleY === null ||
						!Number.isFinite(handleX) ||
						!Number.isFinite(handleY)
					) {
						errors.push(
							projectionError(
								"curve.handle_incomplete",
								`${path}.${kind}`,
								"A handle requires two finite relative coordinates.",
								pointId,
							),
						)
						return undefined
					}
					return { x: handleX, y: handleY }
				}

				let incoming = readHandle("incoming")
				let outgoing = readHandle("outgoing")
				if (topology?.mode === "soft") {
					if (incoming === undefined && outgoing === undefined) {
						errors.push(
							projectionError(
								"curve.soft_handle_pair",
								path,
								"A soft node requires at least one handle.",
								pointId,
							),
						)
					} else if (
						incoming !== undefined &&
						outgoing !== undefined &&
						!handlesShareOppositeRay(incoming, outgoing)
					) {
						errors.push(
							projectionError(
								"curve.soft_handle_alignment",
								path,
								"Soft-node handles must be collinear and point in opposite directions.",
								pointId,
							),
						)
					}
					if (
						x !== null &&
						y !== null &&
						(incoming === undefined) !== (outgoing === undefined)
					) {
						const contourId = (
							get(glyphContourIdsAtoms, [masterId, glyphId]) ?? []
						).find((candidate) =>
							(
								get(contourPointIdsAtoms, [masterId, glyphId, candidate]) ?? []
							).includes(pointId),
						)
						if (contourId !== undefined) {
							const pointIds =
								get(contourPointIdsAtoms, [masterId, glyphId, contourId]) ?? []
							const closed =
								get(contourClosedAtoms, [masterId, glyphId, contourId]) ?? false
							const pointIndex = pointIds.indexOf(pointId)
							const neighborId =
								incoming !== undefined
									? pointIndex < pointIds.length - 1
										? pointIds[pointIndex + 1]
										: closed
											? pointIds[0]
											: undefined
									: pointIndex > 0
										? pointIds[pointIndex - 1]
										: closed
											? pointIds.at(-1)
											: undefined
							if (neighborId !== undefined) {
								const neighborPosition = readPointPosition(get, [
									masterId,
									glyphId,
									neighborId,
								])
								if (neighborPosition !== null) {
									const { x: neighborX, y: neighborY } = neighborPosition
									const neighborHandleX = get(
										incoming !== undefined
											? incomingHandleXAtoms
											: outgoingHandleXAtoms,
										[masterId, glyphId, neighborId],
									)
									const neighborHandleY = get(
										incoming !== undefined
											? incomingHandleYAtoms
											: outgoingHandleYAtoms,
										[masterId, glyphId, neighborId],
									)
									let tangentX = neighborX + (neighborHandleX ?? 0)
									let tangentY = neighborY + (neighborHandleY ?? 0)
									if (tangentX === x && tangentY === y) {
										tangentX = neighborX
										tangentY = neighborY
									}
									if (incoming !== undefined) {
										incoming =
											vectorWithLengthAlong(
												{ x: x - tangentX, y: y - tangentY },
												Math.hypot(incoming.x, incoming.y),
											) ?? incoming
									} else if (outgoing !== undefined) {
										outgoing =
											vectorWithLengthAlong(
												{ x: x - tangentX, y: y - tangentY },
												Math.hypot(outgoing.x, outgoing.y),
											) ?? outgoing
									}
								}
							}
						}
					}
				}
				if (
					errors.length > 0 ||
					topology === null ||
					x === null ||
					y === null
				) {
					return projectionFailure(errors)
				}
				return projectionSuccess({
					pointId,
					mode: topology.mode,
					x,
					y,
					...(incoming === undefined ? {} : { incoming }),
					...(outgoing === undefined ? {} : { outgoing }),
				})
			},
	})

	const layerBoundsSelectors = silo.selectorFamily<
		ProjectionResult<EditorLayerBounds>,
		LayerKey
	>({
		key: "layerBounds",
		get:
			([masterId, glyphId]) =>
			({ get }) => {
				const contourIds = get(glyphContourIdsAtoms, [masterId, glyphId])
				if (contourIds === null) {
					return projectionFailure([
						projectionError(
							"topology.missing",
							`$.glyphs[${glyphId}].contours`,
							"Glyph contour topology is missing.",
							glyphId,
						),
					])
				}
				const errors: ProjectionError[] = []
				let xMin = Number.POSITIVE_INFINITY
				let yMin = Number.POSITIVE_INFINITY
				let xMax = Number.NEGATIVE_INFINITY
				let yMax = Number.NEGATIVE_INFINITY
				const include = (bounds: {
					readonly minX: number
					readonly minY: number
					readonly maxX: number
					readonly maxY: number
				}): void => {
					xMin = Math.min(xMin, bounds.minX)
					yMin = Math.min(yMin, bounds.minY)
					xMax = Math.max(xMax, bounds.maxX)
					yMax = Math.max(yMax, bounds.maxY)
				}
				for (const contourId of contourIds) {
					const pointIds = get(contourPointIdsAtoms, [
						masterId,
						glyphId,
						contourId,
					])
					const closed = get(contourClosedAtoms, [masterId, glyphId, contourId])
					if (pointIds === null || closed === null) {
						errors.push(
							projectionError(
								"topology.missing",
								`$.glyphs[${glyphId}].contours[${contourId}]`,
								"Contour topology is missing.",
								contourId,
							),
						)
						continue
					}
					const nodes = pointIds.map((pointId) =>
						get(layerNodeSelectors, [masterId, glyphId, pointId]),
					)
					for (const node of nodes) {
						if (!node.ok) errors.push(...node.errors)
						else
							include({
								minX: node.value.x,
								minY: node.value.y,
								maxX: node.value.x,
								maxY: node.value.y,
							})
					}
					const segmentCount = Math.max(0, pointIds.length - (closed ? 0 : 1))
					for (let index = 0; index < segmentCount; index += 1) {
						const start = nodes[index]
						const end = nodes[(index + 1) % nodes.length]
						if (
							start === undefined ||
							end === undefined ||
							!start.ok ||
							!end.ok
						) {
							continue
						}
						include(
							cubicCurveBounds({
								p0: start.value,
								c1: {
									x: start.value.x + (start.value.outgoing?.x ?? 0),
									y: start.value.y + (start.value.outgoing?.y ?? 0),
								},
								c2: {
									x: end.value.x + (end.value.incoming?.x ?? 0),
									y: end.value.y + (end.value.incoming?.y ?? 0),
								},
								p3: end.value,
							}),
						)
					}
				}
				if (errors.length > 0) return projectionFailure(errors)
				return projectionSuccess(
					xMin === Number.POSITIVE_INFINITY
						? { xMin: 0, yMin: 0, xMax: 0, yMax: 0 }
						: { xMin, yMin, xMax, yMax },
				)
			},
	})

	const leftSideBearingSelectors = silo.selectorFamily<number | null, LayerKey>(
		{
			key: "leftSideBearing",
			get:
				(key) =>
				({ get }) => {
					const bounds = get(layerBoundsSelectors, key)
					return bounds.ok ? bounds.value.xMin : null
				},
			set:
				([masterId, glyphId]) =>
				({ get, set }, nextLeftSideBearing) => {
					if (
						typeof nextLeftSideBearing !== "number" ||
						!Number.isFinite(nextLeftSideBearing)
					) {
						throw new TypeError("Left side bearing must be a finite number.")
					}
					const bounds = get(layerBoundsSelectors, [masterId, glyphId])
					if (!bounds.ok) {
						throw new TypeError(
							`Glyph ${glyphId} has no valid ${masterId} bounds.`,
						)
					}
					const delta = nextLeftSideBearing - bounds.value.xMin
					if (delta === 0) return
					const advanceWidth = get(advanceWidthValueAtoms, [masterId, glyphId])
					if (advanceWidth === null) {
						throw new TypeError(
							`Glyph ${glyphId} has no advance width in layer ${masterId}.`,
						)
					}
					const nextAdvanceWidth = advanceWidth + delta
					if (nextAdvanceWidth < 0 || nextAdvanceWidth > MAX_UINT16) {
						throw new TypeError(
							"The resulting advance width must be from 0 through 65535.",
						)
					}
					const contourIds =
						get(glyphContourIdsAtoms, [masterId, glyphId]) ?? []
					const pointIds = contourIds.flatMap(
						(contourId) =>
							get(contourPointIdsAtoms, [masterId, glyphId, contourId]) ?? [],
					)
					if (pointIds.length === 0) {
						throw new TypeError(
							"An empty glyph's left side bearing is always zero.",
						)
					}
					for (const pointId of pointIds) {
						const key: LayerPointKey = [masterId, glyphId, pointId]
						const position = get(pointPositionValueAtoms, key)
						if (position === null) {
							throw new TypeError(
								`Point ${pointId} has no position in layer ${masterId}.`,
							)
						}
						set(
							pointPositionValueAtoms,
							key,
							deepFreeze({
								x: position.x + delta,
								y: position.y,
							}),
						)
					}
					set(advanceWidthValueAtoms, [masterId, glyphId], nextAdvanceWidth)
					set(documentRevisionAtom, (revision) => revision + 1)
				},
		},
	)

	const rightSideBearingSelectors = silo.selectorFamily<
		number | null,
		LayerKey
	>({
		key: "rightSideBearing",
		get:
			(key) =>
			({ get }) => {
				const bounds = get(layerBoundsSelectors, key)
				const advanceWidth = readAdvanceWidth(get, key)
				return bounds.ok && advanceWidth !== null
					? advanceWidth - bounds.value.xMax
					: null
			},
		set:
			([masterId, glyphId]) =>
			({ get, set }, nextRightSideBearing) => {
				if (
					typeof nextRightSideBearing !== "number" ||
					!Number.isFinite(nextRightSideBearing)
				) {
					throw new TypeError("Right side bearing must be a finite number.")
				}
				const bounds = get(layerBoundsSelectors, [masterId, glyphId])
				if (!bounds.ok) {
					throw new TypeError(
						`Glyph ${glyphId} has no valid ${masterId} bounds.`,
					)
				}
				const advanceWidth = nextRightSideBearing + bounds.value.xMax
				if (advanceWidth < 0 || advanceWidth > MAX_UINT16) {
					throw new TypeError(
						"The resulting advance width must be from 0 through 65535.",
					)
				}
				const key: LayerKey = [masterId, glyphId]
				if (readAdvanceWidth(get, key) === advanceWidth) return
				writeAdvanceWidth(get, set, key, advanceWidth)
				set(documentRevisionAtom, (revision) => revision + 1)
			},
	})

	const createCurveSegmentPlanSelectors = (
		key: string,
		singleMaster: boolean,
	) =>
		silo.selectorFamily<ProjectionResult<CurveSegmentPlan>, CurveSegmentKey>({
			key,
			get:
				([activeMasterId, glyphId, contourId, segmentIndex]) =>
				({ get }) => {
					const path = `$.glyphs[${glyphId}].layers[${activeMasterId}].contours[${contourId}].segments[${segmentIndex}]`
					const activeContourIds = get(glyphContourIdsAtoms, [
						activeMasterId,
						glyphId,
					])
					const contourIndex = activeContourIds?.indexOf(contourId) ?? -1
					const pointIds = get(contourPointIdsAtoms, [
						activeMasterId,
						glyphId,
						contourId,
					])
					const closed = get(contourClosedAtoms, [
						activeMasterId,
						glyphId,
						contourId,
					])
					const masterIds = singleMaster
						? ([activeMasterId] as const)
						: get(glyphLayerMasterIdsAtoms, glyphId)
					const segmentCount =
						pointIds === null
							? 0
							: Math.max(0, pointIds.length - (closed ? 0 : 1))
					if (
						pointIds === null ||
						closed === null ||
						contourIndex < 0 ||
						!Number.isInteger(segmentIndex) ||
						segmentIndex < 0 ||
						segmentIndex >= segmentCount
					) {
						return projectionFailure([
							projectionError(
								"curve.segment_missing",
								path,
								"Curve segment is not present in the contour topology.",
								contourId,
							),
						])
					}
					if (masterIds === null) {
						return projectionFailure([
							projectionError(
								"layer.index_missing",
								`$.glyphs[${glyphId}].layerMasterIds`,
								"Glyph layer index is missing.",
								glyphId,
							),
						])
					}
					const startPointId = pointIds[segmentIndex]
					const endPointId = closed
						? pointIds[(segmentIndex + 1) % pointIds.length]
						: pointIds[segmentIndex + 1]
					if (startPointId === undefined || endPointId === undefined) {
						return projectionFailure([
							projectionError(
								"curve.segment_missing",
								path,
								"Curve segment endpoints are missing.",
								contourId,
							),
						])
					}

					const errors: ProjectionError[] = []
					const cubics: {
						readonly cubic: CubicBezier
						readonly straight: boolean
					}[] = []
					let curved = false
					for (const masterId of masterIds) {
						const masterContourIds = get(glyphContourIdsAtoms, [
							masterId,
							glyphId,
						])
						const masterContourId = masterContourIds?.[contourIndex]
						if (masterContourId === undefined) {
							errors.push(
								projectionError(
									"compatibility.path_count",
									`$.glyphs[${glyphId}].layers[${masterId}].contours[${contourIndex}]`,
									`Master ${masterId} has no path at ordinal ${contourIndex}.`,
									glyphId,
								),
							)
							continue
						}
						const masterPointIds = get(contourPointIdsAtoms, [
							masterId,
							glyphId,
							masterContourId,
						])
						const masterClosed = get(contourClosedAtoms, [
							masterId,
							glyphId,
							masterContourId,
						])
						if (masterClosed !== closed) {
							errors.push(
								projectionError(
									"compatibility.closure",
									`$.glyphs[${glyphId}].layers[${masterId}].contours[${contourIndex}].closed`,
									`Path ${contourIndex} closure differs from ${activeMasterId}.`,
									masterContourId,
								),
							)
						}
						if (
							masterPointIds === null ||
							masterPointIds.length !== pointIds.length
						) {
							errors.push(
								projectionError(
									"compatibility.node_count",
									`$.glyphs[${glyphId}].layers[${masterId}].contours[${contourIndex}].points`,
									`Path ${contourIndex} node count differs from ${activeMasterId}.`,
									masterContourId,
								),
							)
							continue
						}
						const masterStartPointId = masterPointIds[segmentIndex]
						const masterEndPointId = closed
							? masterPointIds[(segmentIndex + 1) % masterPointIds.length]
							: masterPointIds[segmentIndex + 1]
						if (
							masterStartPointId === undefined ||
							masterEndPointId === undefined
						) {
							continue
						}
						const start = get(layerNodeSelectors, [
							masterId,
							glyphId,
							masterStartPointId,
						])
						const end = get(layerNodeSelectors, [
							masterId,
							glyphId,
							masterEndPointId,
						])
						if (!start.ok) errors.push(...start.errors)
						if (!end.ok) errors.push(...end.errors)
						if (!start.ok || !end.ok) continue
						const outgoing = start.value.outgoing
						const incoming = end.value.incoming
						const straight = outgoing === undefined && incoming === undefined
						curved ||= !straight
						cubics.push({
							straight,
							cubic: {
								p0: { x: start.value.x, y: start.value.y },
								c1: {
									x: start.value.x + (outgoing?.x ?? 0),
									y: start.value.y + (outgoing?.y ?? 0),
								},
								c2: {
									x: end.value.x + (incoming?.x ?? 0),
									y: end.value.y + (incoming?.y ?? 0),
								},
								p3: { x: end.value.x, y: end.value.y },
							},
						})
					}
					if (errors.length > 0) return projectionFailure(errors)
					if (!curved) {
						return projectionSuccess({
							startPointId,
							endPointId,
							curved: false,
							subdivisionDepth: 0,
							maximumError: 0,
						})
					}

					let subdivisionDepth = 0
					for (
						;
						subdivisionDepth <= MAX_CUBIC_SUBDIVISION_DEPTH;
						subdivisionDepth += 1
					) {
						const fits = cubics.every(
							({ cubic, straight }) =>
								straight ||
								maximumErrorAtDepth(cubic, subdivisionDepth) <=
									CUBIC_TO_QUADRATIC_TOLERANCE,
						)
						if (fits) break
					}
					if (subdivisionDepth > MAX_CUBIC_SUBDIVISION_DEPTH) {
						return projectionFailure([
							projectionError(
								"curve.approximation_limit",
								path,
								`Cubic segment could not meet the ${CUBIC_TO_QUADRATIC_TOLERANCE} font-unit error bound by subdivision depth ${MAX_CUBIC_SUBDIVISION_DEPTH}.`,
								glyphId,
							),
						])
					}
					const maximumError = Math.max(
						0,
						...cubics.map(({ cubic, straight }) =>
							straight ? 0 : maximumErrorAtDepth(cubic, subdivisionDepth),
						),
					)
					return projectionSuccess({
						startPointId,
						endPointId,
						curved: true,
						subdivisionDepth,
						maximumError,
					})
				},
		})
	const curveSegmentPlanSelectors = createCurveSegmentPlanSelectors(
		"curveSegmentPlan",
		false,
	)
	const singleMasterCurveSegmentPlanSelectors = createCurveSegmentPlanSelectors(
		"singleMasterCurveSegmentPlan",
		true,
	)

	const axisSourceSelectors = silo.selectorFamily<
		ProjectionResult<VariationAxisSource>,
		AxisId
	>({
		key: "axisSource",
		get:
			(axisId) =>
			({ get }) => {
				const state = get(axisAtoms, axisId)
				const path = `$.axes[${axisId}]`
				if (state === null) {
					return projectionFailure([
						projectionError(
							"entity.missing",
							path,
							`Axis ${JSON.stringify(axisId)} has no state.`,
							axisId,
						),
					])
				}
				const min = projectFixed(state.min, `${path}.min`, axisId)
				const defaultValue = projectFixed(
					state.default,
					`${path}.default`,
					axisId,
				)
				const max = projectFixed(state.max, `${path}.max`, axisId)
				const errors: ProjectionError[] = []
				const warnings: ProjectionWarning[] = []
				for (const result of [min, defaultValue, max]) {
					warnings.push(...result.warnings)
					if (!result.ok) errors.push(...result.errors)
				}
				const map: { from: number; to: number }[] = []
				if (state.map !== null) {
					for (let index = 0; index < state.map.length; index += 1) {
						const entry = state.map[index]
						if (entry === undefined) continue
						const from = projectAxisMapValue(
							entry.from,
							`${path}.map[${index}].from`,
							axisId,
						)
						const to = projectAxisMapValue(
							entry.to,
							`${path}.map[${index}].to`,
							axisId,
						)
						warnings.push(...from.warnings, ...to.warnings)
						if (!from.ok) errors.push(...from.errors)
						if (!to.ok) errors.push(...to.errors)
						if (from.ok && to.ok) map.push({ from: from.value, to: to.value })
					}
				}
				if (errors.length > 0) return projectionFailure(errors, warnings)
				if (!min.ok || !defaultValue.ok || !max.ok) {
					throw new Error("Projection result bookkeeping failed.")
				}
				return projectionSuccess(
					{
						tag: state.tag,
						name: state.name,
						min: min.value,
						default: defaultValue.value,
						max: max.value,
						hidden: state.hidden,
						...(state.map === null ? {} : { map }),
					},
					warnings,
				)
			},
	})

	const axesSourceSelector = silo.selector<
		ProjectionResult<readonly VariationAxisSource[]>
	>({
		key: "axesSource",
		get: ({ get }) => {
			const axisIds = get(axisIdsAtom)
			const indexErrors = duplicateValueErrors(axisIds, "$.axisIds")
			const collected = collectProjectionResults(
				axisIds.map((axisId) => get(axisSourceSelectors, axisId)),
			)
			const errors = [...indexErrors]
			if (!collected.ok) errors.push(...collected.errors)
			const axes = collected.ok ? collected.value : []
			const tagIndexes = new Map<string, number>()
			for (let index = 0; index < axes.length; index += 1) {
				const axis = axes[index]
				if (axis === undefined) continue
				const previous = tagIndexes.get(axis.tag)
				if (previous !== undefined) {
					errors.push(
						projectionError(
							"axis.duplicate_tag",
							`$.axes[${index}].tag`,
							`Axis tag ${JSON.stringify(axis.tag)} duplicates axis index ${previous}.`,
							axisIds[index],
						),
					)
				} else tagIndexes.set(axis.tag, index)
			}
			return errors.length > 0
				? projectionFailure(errors, collected.warnings)
				: projectionSuccess(axes, collected.warnings)
		},
	})

	const masterUserLocationSelectors = silo.selectorFamily<
		ProjectionResult<Readonly<Record<string, number>>>,
		MasterId
	>({
		key: "masterUserLocation",
		get:
			(masterId) =>
			({ get }) => {
				const master = get(masterAtoms, masterId)
				const axesResult = get(axesSourceSelector)
				if (master === null) {
					return projectionFailure([
						projectionError(
							"entity.missing",
							`$.masters[${masterId}]`,
							`Master ${JSON.stringify(masterId)} has no state.`,
							masterId,
						),
					])
				}
				if (!axesResult.ok) return axesResult
				const axisIds = get(axisIdsAtom)
				const location: Record<string, number> = {}
				const errors: ProjectionError[] = []
				const warnings = [...axesResult.warnings]
				for (let index = 0; index < axesResult.value.length; index += 1) {
					const axis = axesResult.value[index]
					const axisId = axisIds[index]
					if (axis === undefined || axisId === undefined) continue
					const raw =
						master.kind === "default"
							? axis.default
							: get(masterCoordinateAtoms, [masterId, axisId])
					const projected =
						raw === null
							? projectionFailure<number>([
									projectionError(
										"location.missing",
										`$.masters[${masterId}].location.${axisId}`,
										`Master location is missing axis ${JSON.stringify(axisId)}.`,
										masterId,
									),
								])
							: projectFixed(
									raw,
									`$.masters[${masterId}].location.${axisId}`,
									axisId,
								)
					warnings.push(...projected.warnings)
					if (!projected.ok) {
						errors.push(...projected.errors)
						continue
					}
					if (projected.value < axis.min || projected.value > axis.max) {
						errors.push(
							projectionError(
								"location.range",
								`$.masters[${masterId}].location.${axisId}`,
								`Coordinate ${projected.value} is outside [${axis.min}, ${axis.max}].`,
								masterId,
							),
						)
					} else location[axisId] = projected.value
				}
				return errors.length > 0
					? projectionFailure(errors, warnings)
					: projectionSuccess(Object.freeze(location), warnings)
			},
	})

	const masterRegionSelectors = silo.selectorFamily<
		ProjectionResult<VariationRegionSource>,
		MasterId
	>({
		key: "masterRegion",
		get:
			(masterId) =>
			({ get }) => {
				const master = get(masterAtoms, masterId)
				if (master === null) {
					return projectionFailure([
						projectionError(
							"entity.missing",
							`$.masters[${masterId}]`,
							`Master ${JSON.stringify(masterId)} has no state.`,
							masterId,
						),
					])
				}
				if (master.kind === "default") {
					return projectionFailure([
						projectionError(
							"master.default_has_no_region",
							`$.masters[${masterId}]`,
							"The default master does not project to a gvar region.",
							masterId,
						),
					])
				}
				const axesResult = get(axesSourceSelector)
				const peakUser = get(masterUserLocationSelectors, masterId)
				const errors: ProjectionError[] = []
				const warnings: ProjectionWarning[] = []
				for (const result of [axesResult, peakUser]) {
					warnings.push(...result.warnings)
					if (!result.ok) errors.push(...result.errors)
				}
				if (!axesResult.ok || !peakUser.ok) {
					return projectionFailure(errors, warnings)
				}
				const peak = normalizeEditorLocation(
					get(axisIdsAtom).map((axisId, index) => ({
						id: axisId,
						...(axesResult.value[index] as VariationAxisSource),
					})),
					peakUser.value,
					`$.masters[${masterId}].location`,
				)
				warnings.push(...peak.warnings)
				if (!peak.ok) return projectionFailure(peak.errors, warnings)
				if (master.supportKind === "non-intermediate") {
					return projectionSuccess({ peak: peak.value }, warnings)
				}

				const axisIds = get(axisIdsAtom)
				const startUser: Record<string, number> = {}
				const endUser: Record<string, number> = {}
				for (const axisId of axisIds) {
					const startPath = `$.masters[${masterId}].support.start.${axisId}`
					const endPath = `$.masters[${masterId}].support.end.${axisId}`
					const start = projectFixed(
						get(masterSupportStartAtoms, [masterId, axisId]),
						startPath,
						axisId,
					)
					const end = projectFixed(
						get(masterSupportEndAtoms, [masterId, axisId]),
						endPath,
						axisId,
					)
					warnings.push(...start.warnings, ...end.warnings)
					if (start.ok) startUser[axisId] = start.value
					else errors.push(...start.errors)
					if (end.ok) endUser[axisId] = end.value
					else errors.push(...end.errors)
				}
				if (errors.length > 0) return projectionFailure(errors, warnings)
				const editorAxes = axisIds.map((axisId, index) => ({
					id: axisId,
					...(axesResult.value[index] as VariationAxisSource),
				}))
				const start = normalizeEditorLocation(
					editorAxes,
					startUser,
					`$.masters[${masterId}].support.start`,
				)
				const end = normalizeEditorLocation(
					editorAxes,
					endUser,
					`$.masters[${masterId}].support.end`,
				)
				warnings.push(...start.warnings, ...end.warnings)
				if (!start.ok) errors.push(...start.errors)
				if (!end.ok) errors.push(...end.errors)
				return errors.length > 0 || !start.ok || !end.ok
					? projectionFailure(errors, warnings)
					: projectionSuccess(
							{ peak: peak.value, start: start.value, end: end.value },
							warnings,
						)
			},
	})

	const variationModelSelector = silo.selector<
		ProjectionResult<VariationModelProjection>
	>({
		key: "variationModel",
		get: ({ get }) => {
			const masterIds = get(masterIdsAtom)
			const defaultMasterId = get(defaultMasterIdAtom)
			const errors = [...duplicateValueErrors(masterIds, "$.masterIds")]
			const warnings: ProjectionWarning[] = []
			if (defaultMasterId === null || !masterIds.includes(defaultMasterId)) {
				errors.push(
					projectionError(
						"master.default_missing",
						"$.defaultMasterId",
						"The default master must identify an indexed master.",
						defaultMasterId ?? undefined,
					),
				)
			}
			if (defaultMasterId !== null) {
				const state = get(masterAtoms, defaultMasterId)
				if (state === null || state.kind !== "default") {
					errors.push(
						projectionError(
							"master.default_kind",
							"$.defaultMasterId",
							"The designated default master must have kind 'default'.",
							defaultMasterId,
						),
					)
				}
			}
			const sourceMasterIds = masterIds.filter((id) => id !== defaultMasterId)
			const regions: VariationRegionSource[] = []
			const locations: NormalizedTagLocation[] = []
			for (const masterId of sourceMasterIds) {
				const state = get(masterAtoms, masterId)
				if (state === null || state.kind !== "source") {
					errors.push(
						projectionError(
							"master.source_kind",
							`$.masters[${masterId}]`,
							"Every nondefault master must have kind 'source'.",
							masterId,
						),
					)
					continue
				}
				const region = get(masterRegionSelectors, masterId)
				warnings.push(...region.warnings)
				if (!region.ok) errors.push(...region.errors)
				else {
					regions.push(region.value)
					locations.push(region.value.peak)
				}
			}
			if (errors.length > 0) return projectionFailure(errors, warnings)
			const matrix = buildMasterScalarMatrix(locations, regions, "$.masters")
			if (!matrix.ok) {
				return projectionFailure(matrix.errors, [
					...warnings,
					...matrix.warnings,
				])
			}
			return projectionSuccess(
				{
					masterIds: sourceMasterIds,
					normalizedLocations: locations,
					regions,
					scalarMatrix: matrix.value,
				},
				[...warnings, ...matrix.warnings],
			)
		},
	})

	const instanceSourceSelectors = silo.selectorFamily<
		ProjectionResult<NamedInstanceSource>,
		InstanceId
	>({
		key: "instanceSource",
		get:
			(instanceId) =>
			({ get }) => {
				const state = get(instanceAtoms, instanceId)
				const axes = get(axesSourceSelector)
				if (state === null) {
					return projectionFailure([
						projectionError(
							"entity.missing",
							`$.instances[${instanceId}]`,
							`Instance ${JSON.stringify(instanceId)} has no state.`,
							instanceId,
						),
					])
				}
				if (!axes.ok) return axes
				const axisIds = get(axisIdsAtom)
				const coordinates: Record<string, number> = {}
				const errors: ProjectionError[] = []
				const warnings = [...axes.warnings]
				for (let index = 0; index < axes.value.length; index += 1) {
					const axis = axes.value[index]
					const axisId = axisIds[index]
					if (axis === undefined || axisId === undefined) continue
					const projected = projectFixed(
						get(instanceCoordinateAtoms, [instanceId, axisId]),
						`$.instances[${instanceId}].coordinates.${axisId}`,
						axisId,
					)
					warnings.push(...projected.warnings)
					if (!projected.ok) {
						errors.push(...projected.errors)
						continue
					}
					if (projected.value < axis.min || projected.value > axis.max) {
						errors.push(
							projectionError(
								"location.range",
								`$.instances[${instanceId}].coordinates.${axisId}`,
								`Coordinate ${projected.value} is outside [${axis.min}, ${axis.max}].`,
								instanceId,
							),
						)
					} else coordinates[axis.tag] = projected.value
				}
				return errors.length > 0
					? projectionFailure(errors, warnings)
					: projectionSuccess(
							{
								name: state.name,
								coordinates,
								...(state.postScriptName === null
									? {}
									: { postScriptName: state.postScriptName }),
								...(state.elidable ? { elidable: true } : {}),
							},
							warnings,
						)
			},
	})

	const instancesSourceSelector = silo.selector<
		ProjectionResult<readonly NamedInstanceSource[]>
	>({
		key: "instancesSource",
		get: ({ get }) => {
			const ids = get(instanceIdsAtom)
			const result = collectProjectionResults(
				ids.map((instanceId) => get(instanceSourceSelectors, instanceId)),
			)
			const duplicates = duplicateValueErrors(ids, "$.instanceIds")
			if (duplicates.length === 0) return result
			return result.ok
				? projectionFailure(duplicates, result.warnings)
				: projectionFailure([...duplicates, ...result.errors], result.warnings)
		},
	})

	const createGlyphLayerSelectors = (
		key: string,
		segmentPlanSelectors: typeof curveSegmentPlanSelectors,
	) =>
		silo.selectorFamily<ProjectionResult<CompiledGlyphLayer>, LayerKey>({
			key,
			get:
				([masterId, glyphId]) =>
				({ get }) => {
					const path = `$.glyphs[${glyphId}].layers[${masterId}]`
					const glyph = get(glyphAtoms, glyphId)
					const master = get(masterAtoms, masterId)
					const layerMasterIds = get(glyphLayerMasterIdsAtoms, glyphId)
					const contourIds = get(glyphContourIdsAtoms, [masterId, glyphId])
					const errors: ProjectionError[] = []
					const warnings: ProjectionWarning[] = []
					if (glyph === null) {
						errors.push(
							projectionError(
								"entity.missing",
								`$.glyphs[${glyphId}]`,
								"Glyph state is missing.",
								glyphId,
							),
						)
					}
					if (master === null) {
						errors.push(
							projectionError(
								"entity.missing",
								`$.masters[${masterId}]`,
								"Master state is missing.",
								masterId,
							),
						)
					}
					if (layerMasterIds === null || !layerMasterIds.includes(masterId)) {
						errors.push(
							projectionError(
								"layer.missing",
								path,
								"Glyph has no layer for this master.",
								glyphId,
							),
						)
					}
					if (contourIds === null) {
						errors.push(
							projectionError(
								"topology.missing",
								`$.glyphs[${glyphId}].contours`,
								"Glyph contour topology is missing.",
								glyphId,
							),
						)
					}
					if (layerMasterIds !== null) {
						errors.push(
							...duplicateValueErrors(
								layerMasterIds,
								`$.glyphs[${glyphId}].layerMasterIds`,
								"layer.duplicate_master",
							),
						)
					}
					if (contourIds !== null) {
						errors.push(
							...duplicateValueErrors(
								contourIds,
								`$.glyphs[${glyphId}].contourIds`,
								"topology.duplicate_contour",
							),
						)
					}

					const advanceWidth = projectRoundedInteger(
						readAdvanceWidth(get, [masterId, glyphId]),
						0,
						MAX_UINT16,
						`${path}.advanceWidth`,
						glyphId,
					)
					warnings.push(...advanceWidth.warnings)
					if (!advanceWidth.ok) errors.push(...advanceWidth.errors)

					const contours: PointSource[][] = []
					const flattenedPoints: PointSource[] = []
					const seenPointIds = new Set<PointId>()
					for (const contourId of contourIds ?? []) {
						const pointIds = get(contourPointIdsAtoms, [
							masterId,
							glyphId,
							contourId,
						])
						const closed = get(contourClosedAtoms, [
							masterId,
							glyphId,
							contourId,
						])
						if (pointIds === null) {
							errors.push(
								projectionError(
									"topology.missing",
									`$.glyphs[${glyphId}].contours[${contourId}]`,
									"Contour point index is missing.",
									contourId,
								),
							)
							continue
						}
						if (closed !== true) {
							errors.push(
								projectionError(
									"topology.open_contour",
									`${path}.contours[${contourId}]`,
									"Open editor contours must be closed before font export.",
									contourId,
								),
							)
							continue
						}
						errors.push(
							...duplicateValueErrors(
								pointIds,
								`$.glyphs[${glyphId}].contours[${contourId}].pointIds`,
								"topology.duplicate_point",
							),
						)
						const contour: PointSource[] = []
						const projectPoint = (
							value: Vector2,
							onCurve: boolean,
							pointPath: string,
							pointId: PointId,
						): PointSource | null => {
							const x = projectRoundedInteger(
								value.x,
								MIN_GLYPH_COORDINATE,
								MAX_GLYPH_COORDINATE,
								`${pointPath}.x`,
								pointId,
							)
							const y = projectRoundedInteger(
								value.y,
								MIN_GLYPH_COORDINATE,
								MAX_GLYPH_COORDINATE,
								`${pointPath}.y`,
								pointId,
							)
							warnings.push(...x.warnings, ...y.warnings)
							if (!x.ok) errors.push(...x.errors)
							if (!y.ok) errors.push(...y.errors)
							return x.ok && y.ok ? { x: x.value, y: y.value, onCurve } : null
						}
						for (
							let segmentIndex = 0;
							segmentIndex < pointIds.length;
							segmentIndex += 1
						) {
							const pointId = pointIds[segmentIndex]
							if (pointId === undefined) continue
							if (seenPointIds.has(pointId)) {
								errors.push(
									projectionError(
										"topology.duplicate_point",
										`$.glyphs[${glyphId}].points[${pointId}]`,
										"A point ID may occur only once in a glyph topology.",
										pointId,
									),
								)
							} else seenPointIds.add(pointId)
							const endPointId = pointIds[(segmentIndex + 1) % pointIds.length]
							if (endPointId === undefined) continue
							const start = get(layerNodeSelectors, [
								masterId,
								glyphId,
								pointId,
							])
							const end = get(layerNodeSelectors, [
								masterId,
								glyphId,
								endPointId,
							])
							const plan = get(segmentPlanSelectors, [
								masterId,
								glyphId,
								contourId,
								segmentIndex,
							])
							if (!start.ok) errors.push(...start.errors)
							if (!end.ok) errors.push(...end.errors)
							if (!plan.ok) errors.push(...plan.errors)
							if (!start.ok || !end.ok || !plan.ok) continue

							const startPoint = projectPoint(
								start.value,
								true,
								`${path}.points[${pointId}]`,
								pointId,
							)
							if (startPoint !== null) {
								contour.push(startPoint)
								flattenedPoints.push(startPoint)
							}
							if (!plan.value.curved) continue

							const outgoing = start.value.outgoing
							const incoming = end.value.incoming
							const cubic: CubicBezier = {
								p0: { x: start.value.x, y: start.value.y },
								c1: {
									x: start.value.x + (outgoing?.x ?? 0),
									y: start.value.y + (outgoing?.y ?? 0),
								},
								c2: {
									x: end.value.x + (incoming?.x ?? 0),
									y: end.value.y + (incoming?.y ?? 0),
								},
								p3: { x: end.value.x, y: end.value.y },
							}
							const quadratics =
								outgoing === undefined && incoming === undefined
									? straightQuadraticsAtDepth(
											cubic.p0,
											cubic.p3,
											plan.value.subdivisionDepth,
										)
									: quadraticsAtDepth(cubic, plan.value.subdivisionDepth)
							for (let index = 0; index < quadratics.length; index += 1) {
								const quadratic = quadratics[index]
								if (quadratic === undefined) continue
								const control = projectPoint(
									quadratic.control,
									false,
									`${path}.segments[${segmentIndex}].quadratics[${index}].control`,
									pointId,
								)
								if (control !== null) {
									contour.push(control)
									flattenedPoints.push(control)
								}
								if (index === quadratics.length - 1) continue
								const endpoint = projectPoint(
									quadratic.p2,
									true,
									`${path}.segments[${segmentIndex}].quadratics[${index}].end`,
									pointId,
								)
								if (endpoint !== null) {
									contour.push(endpoint)
									flattenedPoints.push(endpoint)
								}
							}
						}
						contours.push(contour)
					}
					if (errors.length > 0 || !advanceWidth.ok) {
						return projectionFailure(errors, warnings)
					}
					const xMin = xMinOf(flattenedPoints)
					return projectionSuccess(
						{
							masterId,
							glyphId,
							contours,
							flattenedPoints,
							advanceWidth: advanceWidth.value,
							leftSideBearing: xMin,
							xMin,
						},
						warnings,
					)
				},
		})
	const glyphLayerSelectors = createGlyphLayerSelectors(
		"glyphLayer",
		curveSegmentPlanSelectors,
	)
	const singleMasterGlyphLayerSelectors = createGlyphLayerSelectors(
		"singleMasterGlyphLayer",
		singleMasterCurveSegmentPlanSelectors,
	)

	const glyphCompatibilitySelectors = silo.selectorFamily<
		GlyphCompatibility,
		GlyphCompatibilityKey
	>({
		key: "glyphCompatibility",
		get:
			([referenceMasterId, comparisonMasterId, glyphId]) =>
			({ get }) => {
				const referenceContourIds =
					get(glyphContourIdsAtoms, [referenceMasterId, glyphId]) ?? []
				const comparisonContourIds =
					get(glyphContourIdsAtoms, [comparisonMasterId, glyphId]) ?? []
				const diagnostics: CompatibilityDiagnostic[] = []
				const paths: CompatibilityPathMapping[] = []
				const location = (
					masterId: MasterId,
					pathIndex: number,
					contourId?: ContourId,
					nodeIndex?: number,
					pointId?: PointId,
				): CompatibilityEntityLocation => ({
					masterId,
					glyphId,
					pathIndex,
					...(contourId === undefined ? {} : { contourId }),
					...(nodeIndex === undefined ? {} : { nodeIndex }),
					...(pointId === undefined ? {} : { pointId }),
				})
				if (referenceContourIds.length !== comparisonContourIds.length) {
					diagnostics.push({
						code: "path-count",
						message: `Path count differs: ${referenceContourIds.length} in ${referenceMasterId}, ${comparisonContourIds.length} in ${comparisonMasterId}.`,
						reference: location(referenceMasterId, referenceContourIds.length),
						comparison: location(
							comparisonMasterId,
							comparisonContourIds.length,
						),
					})
				}
				const commonPathCount = Math.min(
					referenceContourIds.length,
					comparisonContourIds.length,
				)
				for (let pathIndex = 0; pathIndex < commonPathCount; pathIndex += 1) {
					const referenceContourId = referenceContourIds[pathIndex]
					const comparisonContourId = comparisonContourIds[pathIndex]
					if (
						referenceContourId === undefined ||
						comparisonContourId === undefined
					) {
						continue
					}
					const referencePointIds =
						get(contourPointIdsAtoms, [
							referenceMasterId,
							glyphId,
							referenceContourId,
						]) ?? []
					const comparisonPointIds =
						get(contourPointIdsAtoms, [
							comparisonMasterId,
							glyphId,
							comparisonContourId,
						]) ?? []
					const referenceClosed = get(contourClosedAtoms, [
						referenceMasterId,
						glyphId,
						referenceContourId,
					])
					const comparisonClosed = get(contourClosedAtoms, [
						comparisonMasterId,
						glyphId,
						comparisonContourId,
					])
					if (referenceClosed !== comparisonClosed) {
						diagnostics.push({
							code: "closure",
							message: `Path ${pathIndex + 1} is ${referenceClosed ? "closed" : "open"} in ${referenceMasterId} and ${comparisonClosed ? "closed" : "open"} in ${comparisonMasterId}.`,
							reference: location(
								referenceMasterId,
								pathIndex,
								referenceContourId,
							),
							comparison: location(
								comparisonMasterId,
								pathIndex,
								comparisonContourId,
							),
						})
					}
					if (referencePointIds.length !== comparisonPointIds.length) {
						diagnostics.push({
							code: "node-count",
							message: `Path ${pathIndex + 1} node count differs: ${referencePointIds.length} in ${referenceMasterId}, ${comparisonPointIds.length} in ${comparisonMasterId}.`,
							reference: location(
								referenceMasterId,
								pathIndex,
								referenceContourId,
								referencePointIds.length,
							),
							comparison: location(
								comparisonMasterId,
								pathIndex,
								comparisonContourId,
								comparisonPointIds.length,
							),
						})
					}
					const nodes: CompatibilityNodeMapping[] = []
					for (
						let nodeIndex = 0;
						nodeIndex <
						Math.min(referencePointIds.length, comparisonPointIds.length);
						nodeIndex += 1
					) {
						const referencePointId = referencePointIds[nodeIndex]
						const comparisonPointId = comparisonPointIds[nodeIndex]
						if (
							referencePointId !== undefined &&
							comparisonPointId !== undefined
						) {
							nodes.push({
								nodeIndex,
								referencePointId,
								comparisonPointId,
							})
						}
					}
					paths.push({
						pathIndex,
						referenceContourId,
						comparisonContourId,
						nodes,
					})
				}
				const referenceLayer = get(glyphLayerSelectors, [
					referenceMasterId,
					glyphId,
				])
				const comparisonLayer = get(glyphLayerSelectors, [
					comparisonMasterId,
					glyphId,
				])
				if (referenceLayer.ok && comparisonLayer.ok) {
					const referencePoints = referenceLayer.value.flattenedPoints
					const comparisonPoints = comparisonLayer.value.flattenedPoints
					if (referencePoints.length !== comparisonPoints.length) {
						diagnostics.push({
							code: "flattened-count",
							message: `Projected point count differs: ${referencePoints.length} in ${referenceMasterId}, ${comparisonPoints.length} in ${comparisonMasterId}.`,
							reference: location(referenceMasterId, 0),
							comparison: location(comparisonMasterId, 0),
						})
					} else {
						const mismatch = referencePoints.findIndex(
							(point, index) =>
								point.onCurve !== comparisonPoints[index]?.onCurve,
						)
						if (mismatch >= 0) {
							diagnostics.push({
								code: "flattened-pattern",
								message: `Projected on/off-curve pattern first differs at target point ${mismatch}.`,
								reference: location(referenceMasterId, 0),
								comparison: location(comparisonMasterId, 0),
							})
						}
					}
				}
				return deepFreeze({
					glyphId,
					referenceMasterId,
					comparisonMasterId,
					compatible: diagnostics.length === 0,
					paths,
					diagnostics,
				})
			},
	})

	const glyphVariationSelectors = silo.selectorFamily<
		ProjectionResult<readonly GlyphVariationSource[]>,
		GlyphId
	>({
		key: "glyphVariation",
		get:
			(glyphId) =>
			({ get }) => {
				const model = get(variationModelSelector)
				const defaultMasterId = get(defaultMasterIdAtom)
				if (!model.ok) return model
				if (defaultMasterId === null) {
					return projectionFailure([
						projectionError(
							"master.default_missing",
							"$.defaultMasterId",
							"A default master is required for glyph projection.",
						),
					])
				}
				const defaultLayer = get(glyphLayerSelectors, [
					defaultMasterId,
					glyphId,
				])
				const sourceLayers = model.value.masterIds.map((masterId) =>
					get(glyphLayerSelectors, [masterId, glyphId]),
				)
				const collectedLayers = collectProjectionResults(sourceLayers)
				const warnings = [
					...model.warnings,
					...defaultLayer.warnings,
					...collectedLayers.warnings,
				]
				const errors: ProjectionError[] = []
				if (!defaultLayer.ok) errors.push(...defaultLayer.errors)
				if (!collectedLayers.ok) errors.push(...collectedLayers.errors)
				if (!defaultLayer.ok || !collectedLayers.ok) {
					return projectionFailure(errors, warnings)
				}

				const componentCount = defaultLayer.value.flattenedPoints.length * 2 + 4
				const rawVectors = Array.from(
					{ length: componentCount },
					() => [] as number[],
				)
				for (const layer of collectedLayers.value) {
					if (
						layer.flattenedPoints.length !==
						defaultLayer.value.flattenedPoints.length
					) {
						errors.push(
							projectionError(
								"compatibility.flattened_count",
								`$.glyphs[${glyphId}].layers[${layer.masterId}]`,
								"Every master must project to the default master's ordered target point count.",
								glyphId,
							),
						)
						continue
					}
					const patternMismatch = layer.flattenedPoints.findIndex(
						(point, index) =>
							point.onCurve !==
							defaultLayer.value.flattenedPoints[index]?.onCurve,
					)
					if (patternMismatch >= 0) {
						errors.push(
							projectionError(
								"compatibility.flattened_pattern",
								`$.glyphs[${glyphId}].layers[${layer.masterId}].points[${patternMismatch}]`,
								"Projected on/off-curve structure differs from the default master's ordered target stream.",
								glyphId,
							),
						)
						continue
					}
					for (
						let pointIndex = 0;
						pointIndex < defaultLayer.value.flattenedPoints.length;
						pointIndex += 1
					) {
						const basePoint = defaultLayer.value.flattenedPoints[pointIndex]
						const sourcePoint = layer.flattenedPoints[pointIndex]
						if (basePoint === undefined || sourcePoint === undefined) continue
						rawVectors[pointIndex * 2]?.push(sourcePoint.x - basePoint.x)
						rawVectors[pointIndex * 2 + 1]?.push(sourcePoint.y - basePoint.y)
					}
					const baseOrigin =
						defaultLayer.value.xMin - defaultLayer.value.leftSideBearing
					const sourceOrigin = layer.xMin - layer.leftSideBearing
					const phantomOffset = defaultLayer.value.flattenedPoints.length * 2
					rawVectors[phantomOffset]?.push(sourceOrigin - baseOrigin)
					rawVectors[phantomOffset + 1]?.push(
						sourceOrigin +
							layer.advanceWidth -
							(baseOrigin + defaultLayer.value.advanceWidth),
					)
					rawVectors[phantomOffset + 2]?.push(0)
					rawVectors[phantomOffset + 3]?.push(0)
				}
				if (errors.length > 0) return projectionFailure(errors, warnings)
				const solved = solveMasterDeltaVectors(
					model.value.scalarMatrix,
					rawVectors,
					`$.glyphs[${glyphId}].variations`,
				)
				if (!solved.ok) {
					return projectionFailure(solved.errors, [
						...warnings,
						...solved.warnings,
					])
				}

				const pointCount = defaultLayer.value.flattenedPoints.length
				const phantomOffset = pointCount * 2
				const variations = model.value.masterIds.map((_, tupleIndex) => ({
					region: model.value.regions[tupleIndex] as VariationRegionSource,
					deltas: {
						points: Array.from({ length: pointCount }, (__, pointIndex) => ({
							x: solved.value[pointIndex * 2]?.[tupleIndex] ?? 0,
							y: solved.value[pointIndex * 2 + 1]?.[tupleIndex] ?? 0,
						})),
						phantom: {
							left: solved.value[phantomOffset]?.[tupleIndex] ?? 0,
							right: solved.value[phantomOffset + 1]?.[tupleIndex] ?? 0,
							top: solved.value[phantomOffset + 2]?.[tupleIndex] ?? 0,
							bottom: solved.value[phantomOffset + 3]?.[tupleIndex] ?? 0,
						},
					},
				}))
				return projectionSuccess(variations, warnings)
			},
	})

	const glyphSourceSelectors = silo.selectorFamily<
		ProjectionResult<SimpleGlyphSource>,
		GlyphId
	>({
		key: "glyphSource",
		get:
			(glyphId) =>
			({ get }) => {
				const glyph = get(glyphAtoms, glyphId)
				const defaultMasterId = get(defaultMasterIdAtom)
				if (glyph === null) {
					return projectionFailure([
						projectionError(
							"entity.missing",
							`$.glyphs[${glyphId}]`,
							"Glyph state is missing.",
							glyphId,
						),
					])
				}
				if (defaultMasterId === null) {
					return projectionFailure([
						projectionError(
							"master.default_missing",
							"$.defaultMasterId",
							"A default master is required for glyph projection.",
						),
					])
				}
				const layer = get(glyphLayerSelectors, [defaultMasterId, glyphId])
				const variations = get(glyphVariationSelectors, glyphId)
				const warnings = [...layer.warnings, ...variations.warnings]
				const errors: ProjectionError[] = []
				if (!layer.ok) errors.push(...layer.errors)
				if (!variations.ok) errors.push(...variations.errors)
				if (!layer.ok || !variations.ok) {
					return projectionFailure(errors, warnings)
				}
				if (glyph.overlap && layer.value.contours.length > 1) {
					warnings.push(
						projectionWarning(
							"overlap.union_deferred",
							`$.glyphs[${glyphId}].overlap`,
							"Overlapping authored contours are retained in compiled topology; the current target can mark overlaps but cannot normalize a deterministic cross-master boolean union.",
							glyphId,
						),
					)
				}
				return projectionSuccess(
					{
						kind: "simple",
						name: glyph.name,
						advanceWidth: layer.value.advanceWidth,
						leftSideBearing: layer.value.leftSideBearing,
						contours: layer.value.contours,
						variations: variations.value,
						...(glyph.overlap ? { overlap: true } : {}),
					},
					warnings,
				)
			},
	})

	const livePreviewGlyphSourceSelectors = silo.selectorFamily<
		ProjectionResult<SimpleGlyphSource>,
		GlyphId
	>({
		key: "livePreviewGlyphSource",
		get:
			(glyphId) =>
			({ get }) => {
				const strict = get(glyphSourceSelectors, glyphId)
				if (strict.ok) return strict
				const glyph = get(glyphAtoms, glyphId)
				const defaultMasterId = get(defaultMasterIdAtom)
				if (glyph === null || defaultMasterId === null) return strict
				if (
					strict.errors.some(
						(error) =>
							!isLivePreviewRecoverableGlyphError(
								error,
								strict.errors,
								glyphId,
								defaultMasterId,
							),
					)
				) {
					return strict
				}
				const layer = get(singleMasterGlyphLayerSelectors, [
					defaultMasterId,
					glyphId,
				])
				if (!layer.ok) {
					return projectionFailure(
						[...strict.errors, ...layer.errors],
						[...strict.warnings, ...layer.warnings],
					)
				}
				const recoverableWarnings = strict.errors.map((error) =>
					projectionWarning(
						error.code,
						error.path,
						`Live preview froze ${glyph.name} (${glyphId}) to its default master: ${error.message}`,
						glyphId,
					),
				)
				return projectionSuccess(
					{
						kind: "simple",
						name: glyph.name,
						advanceWidth: layer.value.advanceWidth,
						leftSideBearing: layer.value.leftSideBearing,
						contours: layer.value.contours,
						variations: [],
						...(glyph.overlap ? { overlap: true } : {}),
					},
					[...strict.warnings, ...layer.warnings, ...recoverableWarnings],
				)
			},
	})

	const exportedGlyphIdsSelector = silo.selector<
		ProjectionResult<readonly GlyphId[]>
	>({
		key: "exportedGlyphIds",
		get: ({ get }) => {
			const ids = get(glyphIdsAtom)
			const errors = [...duplicateValueErrors(ids, "$.glyphIds")]
			const exported: GlyphId[] = []
			for (const glyphId of ids) {
				const glyph = get(glyphAtoms, glyphId)
				if (glyph === null) {
					errors.push(
						projectionError(
							"entity.missing",
							`$.glyphs[${glyphId}]`,
							"Indexed glyph state is missing.",
							glyphId,
						),
					)
				} else if (glyph.export) exported.push(glyphId)
			}
			if (exported.length === 0) {
				errors.push(
					projectionError(
						"glyph.none_exported",
						"$.glyphs",
						"At least one glyph must be marked for export.",
					),
				)
			}
			return errors.length > 0
				? projectionFailure(errors)
				: projectionSuccess(exported)
		},
	})

	const glyphsSourceSelector = silo.selector<
		ProjectionResult<readonly SimpleGlyphSource[]>
	>({
		key: "glyphsSource",
		get: ({ get }) => {
			// Glyph membership and every authoring action are revisioned. Tracking one
			// stable revision edge avoids tearing down and recreating hundreds of
			// selector-family dependency edges for every point nudge while preserving
			// the already memoized per-glyph projection results.
			get(documentRevisionAtom)
			const ids = silo.getState(exportedGlyphIdsSelector)
			if (!ids.ok) return ids
			return resultWithWarnings(
				collectProjectionResults(
					ids.value.map((glyphId) =>
						silo.getState(glyphSourceSelectors, glyphId),
					),
				),
				ids.warnings,
			)
		},
	})

	const livePreviewGlyphsSourceSelector = silo.selector<
		ProjectionResult<readonly SimpleGlyphSource[]>
	>({
		key: "livePreviewGlyphsSource",
		get: ({ get }) => {
			get(documentRevisionAtom)
			const ids = silo.getState(exportedGlyphIdsSelector)
			if (!ids.ok) return ids
			return resultWithWarnings(
				collectProjectionResults(
					ids.value.map((glyphId) =>
						silo.getState(livePreviewGlyphSourceSelectors, glyphId),
					),
				),
				ids.warnings,
			)
		},
	})

	const cmapEntrySelectors = silo.selectorFamily<
		ProjectionResult<CharacterMapEntrySource>,
		number
	>({
		key: "cmapEntry",
		get:
			(codePoint) =>
			({ get }) => {
				const glyphId = get(cmapGlyphAtoms, codePoint)
				const glyphIds = get(exportedGlyphIdsSelector)
				const errors: ProjectionError[] = []
				if (
					!Number.isInteger(codePoint) ||
					codePoint < 0 ||
					codePoint > 0x10ffff ||
					(codePoint >= 0xd800 && codePoint <= 0xdfff)
				) {
					errors.push(
						projectionError(
							"cmap.invalid_scalar",
							`$.cmap[${codePoint}]`,
							"Character-map keys must be Unicode scalar values.",
						),
					)
				}
				if (glyphId === null) {
					errors.push(
						projectionError(
							"cmap.missing_glyph",
							`$.cmap[${codePoint}]`,
							"Character-map entry has no glyph ID.",
						),
					)
				}
				if (!glyphIds.ok) errors.push(...glyphIds.errors)
				const glyph =
					glyphId === null || !glyphIds.ok
						? -1
						: glyphIds.value.indexOf(glyphId)
				if (glyphId !== null && glyph === -1) {
					errors.push(
						projectionError(
							"cmap.unexported_glyph",
							`$.cmap[${codePoint}].glyphId`,
							`Character map refers to non-exported glyph ${JSON.stringify(glyphId)}.`,
							glyphId,
						),
					)
				}
				return errors.length > 0
					? projectionFailure(errors, glyphIds.warnings)
					: projectionSuccess({ codePoint, glyph }, glyphIds.warnings)
			},
	})

	const cmapSourceSelector = silo.selector<
		ProjectionResult<readonly CharacterMapEntrySource[]>
	>({
		key: "cmapSource",
		get: ({ get }) => {
			const codePoints = get(cmapCodePointsAtom)
			const result = collectProjectionResults(
				codePoints.map((codePoint) => get(cmapEntrySelectors, codePoint)),
			)
			const duplicates = duplicateValueErrors(codePoints, "$.cmapCodePoints")
			if (duplicates.length === 0) return result
			return result.ok
				? projectionFailure(duplicates, result.warnings)
				: projectionFailure([...duplicates, ...result.errors], result.warnings)
		},
	})

	const metadataSourceSelector = silo.selector<
		ProjectionResult<VariableFontSource["metadata"]>
	>({
		key: "metadataSource",
		get: ({ get }) => {
			const metadata = get(metadataAtom)
			if (metadata === null) {
				return projectionFailure([
					projectionError(
						"document.missing_section",
						"$.metadata",
						"Font metadata is missing.",
					),
				])
			}
			const unitsPerEm = projectRoundedInteger(
				metadata.unitsPerEm,
				0,
				MAX_UINT16,
				"$.metadata.unitsPerEm",
			)
			const revision = projectFixed(
				metadata.fontRevision,
				"$.metadata.fontRevision",
			)
			const lowestPpem = projectRoundedInteger(
				metadata.lowestPpem,
				0,
				MAX_UINT16,
				"$.metadata.lowestPpem",
			)
			const warnings = [
				...unitsPerEm.warnings,
				...revision.warnings,
				...lowestPpem.warnings,
			]
			const errors: ProjectionError[] = []
			if (!unitsPerEm.ok) errors.push(...unitsPerEm.errors)
			if (!revision.ok) errors.push(...revision.errors)
			if (!lowestPpem.ok) errors.push(...lowestPpem.errors)
			if (!unitsPerEm.ok || !revision.ok || !lowestPpem.ok) {
				return projectionFailure(errors, warnings)
			}
			return projectionSuccess(
				{
					...metadata,
					unitsPerEm: unitsPerEm.value,
					fontRevision: revision.value,
					lowestPpem: lowestPpem.value,
				},
				warnings,
			)
		},
	})

	const metricsSourceSelector = silo.selector<
		ProjectionResult<VariableFontSource["metrics"]>
	>({
		key: "metricsSource",
		get: ({ get }) => {
			const metrics = get(metricsAtom)
			if (metrics === null) {
				return projectionFailure([
					projectionError(
						"document.missing_section",
						"$.metrics",
						"Font metrics are missing.",
					),
				])
			}
			const signedFields = [
				"ascender",
				"descender",
				"lineGap",
				"xHeight",
				"capHeight",
				"underlinePosition",
				"underlineThickness",
			] as const
			const unsignedFields = ["winAscent", "winDescent"] as const
			const projected: Record<string, number> = {}
			const errors: ProjectionError[] = []
			const warnings: ProjectionWarning[] = []
			for (const [field, depth] of Object.entries(metrics.overshoots)) {
				if (!Number.isInteger(depth) || depth < 0 || depth > 16_383) {
					errors.push(
						projectionError(
							"metrics.overshoot_range",
							`$.metrics.overshoots.${field}`,
							"Expected an integer overshoot depth from 0 through 16383.",
						),
					)
				}
			}
			for (const field of signedFields) {
				const result = projectRoundedInteger(
					metrics[field],
					MIN_INT16,
					MAX_INT16,
					`$.metrics.${field}`,
				)
				warnings.push(...result.warnings)
				if (result.ok) projected[field] = result.value
				else errors.push(...result.errors)
			}
			for (const field of unsignedFields) {
				const result = projectRoundedInteger(
					metrics[field],
					0,
					MAX_UINT16,
					`$.metrics.${field}`,
				)
				warnings.push(...result.warnings)
				if (result.ok) projected[field] = result.value
				else errors.push(...result.errors)
			}
			if (errors.length > 0) return projectionFailure(errors, warnings)
			const value = (
				field: (typeof signedFields)[number] | (typeof unsignedFields)[number],
			): number => {
				const result = projected[field]
				if (result === undefined) {
					throw new Error(`Metric projection omitted ${field}.`)
				}
				return result
			}
			return projectionSuccess(
				{
					ascender: value("ascender"),
					descender: value("descender"),
					lineGap: value("lineGap"),
					winAscent: value("winAscent"),
					winDescent: value("winDescent"),
					xHeight: value("xHeight"),
					capHeight: value("capHeight"),
					underlinePosition: value("underlinePosition"),
					underlineThickness: value("underlineThickness"),
				},
				warnings,
			)
		},
	})

	const styleSourceSelector = silo.selector<
		ProjectionResult<VariableFontSource["style"]>
	>({
		key: "styleSource",
		get: ({ get }) => {
			const style = get(styleAtom)
			if (style === null) {
				return projectionFailure([
					projectionError(
						"document.missing_section",
						"$.style",
						"Font style is missing.",
					),
				])
			}
			const weightClass = projectRoundedInteger(
				style.weightClass,
				0,
				MAX_UINT16,
				"$.style.weightClass",
			)
			const widthClass = projectRoundedInteger(
				style.widthClass,
				0,
				MAX_UINT16,
				"$.style.widthClass",
			)
			const italicAngle = projectFixed(style.italicAngle, "$.style.italicAngle")
			const warnings = [
				...weightClass.warnings,
				...widthClass.warnings,
				...italicAngle.warnings,
			]
			const errors: ProjectionError[] = []
			if (!weightClass.ok) errors.push(...weightClass.errors)
			if (!widthClass.ok) errors.push(...widthClass.errors)
			if (!italicAngle.ok) errors.push(...italicAngle.errors)
			if (!weightClass.ok || !widthClass.ok || !italicAngle.ok) {
				return projectionFailure(errors, warnings)
			}
			return projectionSuccess(
				{
					...style,
					weightClass: weightClass.value,
					widthClass: widthClass.value,
					italicAngle: italicAngle.value,
				},
				warnings,
			)
		},
	})

	const namesSourceSelector = silo.selector<
		ProjectionResult<VariableFontSource["names"]>
	>({
		key: "namesSource",
		get: ({ get }) => {
			const names = get(namesAtom)
			return names === null
				? projectionFailure([
						projectionError(
							"document.missing_section",
							"$.names",
							"Font names are missing.",
						),
					])
				: projectionSuccess(names)
		},
	})

	const editorStructureSelector = silo.selector<ProjectionResult<true>>({
		key: "editorStructure",
		get: ({ get }) => {
			const glyphIds = get(glyphIdsAtom)
			const masterIds = new Set(get(masterIdsAtom))
			const errors: ProjectionError[] = [
				...duplicateValueErrors(glyphIds, "$.glyphIds"),
			]
			for (const glyphId of glyphIds) {
				const layerMasterIds = get(glyphLayerMasterIdsAtoms, glyphId)
				if (layerMasterIds === null) {
					errors.push(
						projectionError(
							"layer.index_missing",
							`$.glyphs[${glyphId}].layerMasterIds`,
							"Glyph layer index is missing.",
							glyphId,
						),
					)
					continue
				}
				errors.push(
					...duplicateValueErrors(
						layerMasterIds,
						`$.glyphs[${glyphId}].layerMasterIds`,
						"layer.duplicate_master",
					),
				)
				for (const masterId of layerMasterIds) {
					if (!masterIds.has(masterId)) {
						errors.push(
							projectionError(
								"layer.unknown_master",
								`$.glyphs[${glyphId}].layers[${masterId}]`,
								"Glyph layer refers to an unindexed master.",
								masterId,
							),
						)
					}
					const contourIds = get(glyphContourIdsAtoms, [masterId, glyphId])
					if (contourIds === null) {
						errors.push(
							projectionError(
								"topology.missing",
								`$.glyphs[${glyphId}].layers[${masterId}].contours`,
								"Layer contour index is missing.",
								glyphId,
							),
						)
						continue
					}
					errors.push(
						...duplicateValueErrors(
							contourIds,
							`$.glyphs[${glyphId}].layers[${masterId}].contourIds`,
							"topology.duplicate_contour",
						),
					)
					const layerPointIds = new Set<PointId>()
					for (const contourId of contourIds) {
						const pointIds = get(contourPointIdsAtoms, [
							masterId,
							glyphId,
							contourId,
						])
						const closed = get(contourClosedAtoms, [
							masterId,
							glyphId,
							contourId,
						])
						if (pointIds === null || closed === null) {
							errors.push(
								projectionError(
									"topology.missing",
									`$.glyphs[${glyphId}].layers[${masterId}].contours[${contourId}]`,
									"Contour topology is missing.",
									contourId,
								),
							)
							continue
						}
						for (const pointId of pointIds) {
							if (layerPointIds.has(pointId)) {
								errors.push(
									projectionError(
										"topology.duplicate_point",
										`$.glyphs[${glyphId}].layers[${masterId}].points[${pointId}]`,
										"Point IDs must be unique within a master layer.",
										pointId,
									),
								)
							} else layerPointIds.add(pointId)
							if (get(pointAtoms, [masterId, glyphId, pointId]) === null) {
								errors.push(
									projectionError(
										"topology.missing",
										`$.glyphs[${glyphId}].layers[${masterId}].points[${pointId}]`,
										"Point topology state is missing.",
										pointId,
									),
								)
							}
						}
					}
				}
			}
			return errors.length > 0
				? projectionFailure(errors)
				: projectionSuccess(true)
		},
	})

	const createFontSourceSelector = (
		key: string,
		glyphsSelector: typeof glyphsSourceSelector,
	) =>
		silo.selector<ProjectionResult<VariableFontSource>>({
			key,
			get: ({ get }) => {
				const structure = get(editorStructureSelector)
				const metadata = get(metadataSourceSelector)
				const names = get(namesSourceSelector)
				const metrics = get(metricsSourceSelector)
				const style = get(styleSourceSelector)
				const axes = get(axesSourceSelector)
				const instances = get(instancesSourceSelector)
				const glyphs = get(glyphsSelector)
				const cmap = get(cmapSourceSelector)
				const results = [
					structure,
					metadata,
					names,
					metrics,
					style,
					axes,
					instances,
					glyphs,
					cmap,
				] as const
				const errors: ProjectionError[] = []
				const warnings: ProjectionWarning[] = []
				for (const result of results) {
					warnings.push(...result.warnings)
					if (!result.ok) errors.push(...result.errors)
				}
				if (errors.length > 0) return projectionFailure(errors, warnings)
				if (
					!structure.ok ||
					!metadata.ok ||
					!names.ok ||
					!metrics.ok ||
					!style.ok ||
					!axes.ok ||
					!instances.ok ||
					!glyphs.ok ||
					!cmap.ok
				) {
					throw new Error("Projection result bookkeeping failed.")
				}
				return projectionSuccess(
					{
						format: CREATE_FONT_FORMAT,
						irVersion: CREATE_FONT_IR_VERSION,
						metadata: metadata.value,
						names: names.value,
						metrics: metrics.value,
						style: style.value,
						axes: axes.value,
						instances: instances.value,
						glyphs: glyphs.value,
						cmap: cmap.value,
						kerning: get(kerningAtom).flatMap((pair) => {
							const exported = get(exportedGlyphIdsSelector)
							const exportedIds = exported.ok ? exported.value : []
							const left = exportedIds.indexOf(pair.left)
							const right = exportedIds.indexOf(pair.right)
							return left < 0 || right < 0
								? []
								: [{ left, right, value: pair.value }]
						}),
					},
					warnings,
				)
			},
		})
	const fontSourceSelector = createFontSourceSelector(
		"fontSource",
		glyphsSourceSelector,
	)
	const livePreviewFontSourceSelector = createFontSourceSelector(
		"livePreviewFontSource",
		livePreviewGlyphsSourceSelector,
	)

	const createFontCompilationSelector = (
		key: string,
		sourceSelector: typeof fontSourceSelector,
	) =>
		silo.selector<FontCompilation>({
			key,
			get: ({ get }) => {
				const projected = get(sourceSelector)
				if (!projected.ok) {
					return deepFreeze({
						ok: false,
						stage: "projection-failed",
						projectionErrors: projected.errors,
						projectionWarnings: projected.warnings,
					} as const)
				}
				const ingested = ingestVariableFont(projected.value)
				if (!ingested.ok) {
					return deepFreeze({
						ok: false,
						stage: "ingestion-failed",
						source: projected.value,
						projectionWarnings: projected.warnings,
						ingestionErrors: ingested.errors,
						ingestionWarnings: ingested.warnings,
					} as const)
				}
				const glyphIndices = new Map(
					get(glyphIdsAtom).map((glyphId, index) => [glyphId, index]),
				)
				const substitutions = get(featureSubstitutionsAtom).flatMap((rule) => {
					const from = rule.from.map((glyphId) => glyphIndices.get(glyphId))
					const to = glyphIndices.get(rule.to)
					return from.some((glyphId) => glyphId === undefined) ||
						to === undefined
						? []
						: [
								{
									feature: rule.feature,
									from: from as number[],
									to,
									...(rule.contextIndex === undefined
										? {}
										: { contextIndex: rule.contextIndex }),
								},
							]
				})
				return deepFreeze({
					ok: true,
					stage: "compiled",
					source: projected.value,
					font: withVariableFontSubstitutions(ingested.value, substitutions),
					projectionWarnings: projected.warnings,
					ingestionWarnings: ingested.warnings,
				} as const)
			},
		})

	const editorAxisSourceSelectors = silo.selectorFamily<
		EditorFontSource["axes"][number] | null,
		AxisId
	>({
		key: "editorAxisSource",
		get:
			(axisId) =>
			({ get }) => {
				const axis = get(axisAtoms, axisId)
				if (axis === null) return null
				return deepFreeze({
					id: axisId,
					tag: axis.tag,
					name: axis.name,
					min: axis.min,
					default: axis.default,
					max: axis.max,
					...(axis.hidden ? { hidden: true } : {}),
					...(axis.map === null ? {} : { map: axis.map }),
				})
			},
	})
	const editorAxesSourceSelector = silo.selector<
		EditorFontSource["axes"] | null
	>({
		key: "editorAxesSource",
		get: ({ get }) => {
			const axes = []
			for (const axisId of get(axisIdsAtom)) {
				const axis = get(editorAxisSourceSelectors, axisId)
				if (axis === null) return null
				axes.push(axis)
			}
			return deepFreeze(axes)
		},
	})

	const editorMasterSourceSelectors = silo.selectorFamily<
		EditorMasterSource | null,
		MasterId
	>({
		key: "editorMasterSource",
		get:
			(masterId) =>
			({ get }) => {
				const master = get(masterAtoms, masterId)
				if (master === null) return null
				if (master.kind === "default") {
					return deepFreeze({
						id: masterId,
						kind: "default",
						name: master.name,
					})
				}
				const location: Partial<Record<AxisId, number>> = {}
				for (const axisId of get(axisIdsAtom)) {
					const coordinate = get(masterCoordinateAtoms, [masterId, axisId])
					if (coordinate !== null) location[axisId] = coordinate
				}
				if (master.supportKind === "non-intermediate") {
					return deepFreeze({
						id: masterId,
						kind: "source",
						name: master.name,
						location,
						support: { kind: "non-intermediate" },
					})
				}
				const start: Partial<Record<AxisId, number>> = {}
				const end: Partial<Record<AxisId, number>> = {}
				for (const axisId of get(axisIdsAtom)) {
					const startCoordinate = get(masterSupportStartAtoms, [
						masterId,
						axisId,
					])
					const endCoordinate = get(masterSupportEndAtoms, [masterId, axisId])
					if (startCoordinate !== null) start[axisId] = startCoordinate
					if (endCoordinate !== null) end[axisId] = endCoordinate
				}
				return deepFreeze({
					id: masterId,
					kind: "source",
					name: master.name,
					location,
					support: { kind: "intermediate", start, end },
				})
			},
	})
	const editorMastersSourceSelector = silo.selector<
		EditorFontSource["masters"] | null
	>({
		key: "editorMastersSource",
		get: ({ get }) => {
			const masters = []
			for (const masterId of get(masterIdsAtom)) {
				const master = get(editorMasterSourceSelectors, masterId)
				if (master === null) return null
				masters.push(master)
			}
			return deepFreeze(masters)
		},
	})

	const editorInstanceSourceSelectors = silo.selectorFamily<
		EditorFontSource["instances"][number] | null,
		InstanceId
	>({
		key: "editorInstanceSource",
		get:
			(instanceId) =>
			({ get }) => {
				const instance = get(instanceAtoms, instanceId)
				if (instance === null) return null
				const coordinates: Partial<Record<AxisId, number>> = {}
				for (const axisId of get(axisIdsAtom)) {
					const coordinate = get(instanceCoordinateAtoms, [instanceId, axisId])
					if (coordinate !== null) coordinates[axisId] = coordinate
				}
				return deepFreeze({
					id: instanceId,
					name: instance.name,
					coordinates,
					...(instance.postScriptName === null
						? {}
						: { postScriptName: instance.postScriptName }),
					...(instance.elidable ? { elidable: true } : {}),
				})
			},
	})
	const editorInstancesSourceSelector = silo.selector<
		EditorFontSource["instances"] | null
	>({
		key: "editorInstancesSource",
		get: ({ get }) => {
			const instances = []
			for (const instanceId of get(instanceIdsAtom)) {
				const instance = get(editorInstanceSourceSelectors, instanceId)
				if (instance === null) return null
				instances.push(instance)
			}
			return deepFreeze(instances)
		},
	})

	const editorGlyphSourceSelectors = silo.selectorFamily<
		EditorGlyphSource | null,
		GlyphId
	>({
		key: "editorGlyphSource",
		get:
			(glyphId) =>
			({ get }) => {
				const glyph = get(glyphAtoms, glyphId)
				const glyphEditor = get(glyphEditorAtoms, glyphId)
				const layerMasterIds = get(glyphLayerMasterIdsAtoms, glyphId)
				if (glyph === null || glyphEditor === null || layerMasterIds === null) {
					return null
				}
				const layers: EditorGlyphSource["layers"][number][] = []
				for (const masterId of layerMasterIds) {
					const contourIds = get(glyphContourIdsAtoms, [masterId, glyphId])
					if (contourIds === null) return null
					const contours: EditorGlyphSource["layers"][number]["contours"][number][] =
						[]
					for (const contourId of contourIds) {
						const pointIds = get(contourPointIdsAtoms, [
							masterId,
							glyphId,
							contourId,
						])
						const closed = get(contourClosedAtoms, [
							masterId,
							glyphId,
							contourId,
						])
						if (pointIds === null || closed === null) return null
						const points: EditorGlyphSource["layers"][number]["contours"][number]["points"][number][] =
							[]
						for (const pointId of pointIds) {
							const projected = get(layerNodeSelectors, [
								masterId,
								glyphId,
								pointId,
							])
							if (!projected.ok) return null
							const { incoming, outgoing } = projected.value
							points.push({
								id: pointId,
								mode: projected.value.mode,
								x: projected.value.x,
								y: projected.value.y,
								...(incoming === undefined ? {} : { incoming }),
								...(outgoing === undefined ? {} : { outgoing }),
							})
						}
						contours.push({ id: contourId, closed, points })
					}
					const advanceWidth = readAdvanceWidth(get, [masterId, glyphId])
					const bounds = get(layerBoundsSelectors, [masterId, glyphId])
					if (advanceWidth === null) return null
					const allPoints = contours.flatMap((contour) => contour.points)
					layers.push({
						masterId,
						advanceWidth,
						leftSideBearing: bounds.ok
							? bounds.value.xMin
							: allPoints.length === 0
								? 0
								: Math.min(...allPoints.map((point) => point.x)),
						contours,
					})
				}
				return deepFreeze({
					id: glyphId,
					name: glyph.name,
					export: glyph.export,
					...(glyphEditor.note.length === 0 ? {} : { note: glyphEditor.note }),
					...(glyphEditor.color === null ? {} : { color: glyphEditor.color }),
					...(glyph.overlap ? { overlap: true } : {}),
					...(glyphEditor.rules.length === 0
						? {}
						: { rules: glyphEditor.rules }),
					layers,
				})
			},
	})

	const editorSourceSelector = silo.selector<EditorFontSource | null>({
		key: "editorSource",
		get: ({ get }) => {
			// Source persistence is revision-driven. Keep its subscribed dependency
			// shallow so projecting a settled edit does not recursively retrace every
			// point and handle edge in the document.
			get(documentRevisionAtom)
			if (!silo.getState(editorStructureSelector).ok) return null
			const metadata = silo.getState(metadataAtom)
			const names = silo.getState(namesAtom)
			const metrics = silo.getState(metricsAtom)
			const style = silo.getState(styleAtom)
			const defaultMasterId = silo.getState(defaultMasterIdAtom)
			if (
				metadata === null ||
				names === null ||
				metrics === null ||
				style === null ||
				defaultMasterId === null
			)
				return null

			const axes = silo.getState(editorAxesSourceSelector)
			const masters = silo.getState(editorMastersSourceSelector)
			const instances = silo.getState(editorInstancesSourceSelector)
			if (axes === null || masters === null || instances === null) return null

			const glyphs: EditorGlyphSource[] = []
			for (const glyphId of silo.getState(glyphIdsAtom)) {
				const glyph = silo.getState(editorGlyphSourceSelectors, glyphId)
				if (glyph === null) return null
				glyphs.push(glyph)
			}

			const cmap: EditorCmapEntrySource[] = []
			for (const codePoint of silo.getState(cmapCodePointsAtom)) {
				const glyphId = silo.getState(cmapGlyphAtoms, codePoint)
				if (glyphId === null) return null
				cmap.push({ codePoint, glyphId })
			}
			return deepFreeze({
				format: CREATE_FONT_EDITOR_FORMAT,
				editorVersion: CREATE_FONT_EDITOR_VERSION,
				metadata,
				names,
				metrics,
				style,
				axes,
				masters,
				defaultMasterId,
				instances,
				glyphs,
				cmap,
				...(silo.getState(kerningAtom).length === 0
					? {}
					: { kerning: silo.getState(kerningAtom) }),
			})
		},
	})
	const fontCompilationSelector = createFontCompilationSelector(
		"fontCompilation",
		fontSourceSelector,
	)
	const livePreviewFontCompilationSelector = createFontCompilationSelector(
		"livePreviewFontCompilation",
		livePreviewFontSourceSelector,
	)

	const replaceFontTransaction = revisionedTransaction<
		(source: EditorFontSource, coWrites?: ErasedFontLoadCoWrites) => void
	>({
		key: "replaceFont",
		do: ({ get, set }, source, coWrites) => {
			validateEditorSourceStructure(source)
			for (const coWrite of coWrites ?? []) {
				assertCallerOwnedLoadAtom(coWrite.atom)
				if (isThenable(coWrite.value)) {
					// Attach a rejection handler before aborting so accidental promises do
					// not become unhandled rejections after the synchronous transaction.
					void Promise.resolve(coWrite.value).catch(() => undefined)
					throw new TypeError(
						"A font-load co-write value cannot be promise-like.",
					)
				}
			}

			const oldAxisIds = get(axisIdsAtom)
			const oldMasterIds = get(masterIdsAtom)
			const oldInstanceIds = get(instanceIdsAtom)
			const oldGlyphIds = get(glyphIdsAtom)
			const oldCodePoints = get(cmapCodePointsAtom)
			// Keep family members allocated for the Silo's document lifetime. Setting
			// tombstones preserves atom.io dependency edges and evicts every derived
			// family cache; disposing atoms here would strand cached selectors.
			for (const axisId of oldAxisIds) {
				set(axisAtoms, axisId, null)
			}
			for (const masterId of oldMasterIds) {
				set(masterAtoms, masterId, null)
				for (const axisId of oldAxisIds) {
					set(masterCoordinateAtoms, [masterId, axisId], null)
					set(masterSupportStartAtoms, [masterId, axisId], null)
					set(masterSupportEndAtoms, [masterId, axisId], null)
				}
			}
			for (const instanceId of oldInstanceIds) {
				set(instanceAtoms, instanceId, null)
				for (const axisId of oldAxisIds) {
					set(instanceCoordinateAtoms, [instanceId, axisId], null)
				}
			}
			for (const glyphId of oldGlyphIds) {
				const layerMasterIds = get(glyphLayerMasterIdsAtoms, glyphId) ?? []
				for (const masterId of layerMasterIds) {
					const contourIds =
						get(glyphContourIdsAtoms, [masterId, glyphId]) ?? []
					const pointIds: PointId[] = []
					for (const contourId of contourIds) {
						const contourPoints =
							get(contourPointIdsAtoms, [masterId, glyphId, contourId]) ?? []
						pointIds.push(...contourPoints)
						for (const pointId of contourPoints) {
							set(pointAtoms, [masterId, glyphId, pointId], null)
						}
						set(contourPointIdsAtoms, [masterId, glyphId, contourId], null)
						set(contourClosedAtoms, [masterId, glyphId, contourId], null)
					}
					for (const pointId of pointIds) {
						set(pointPositionValueAtoms, [masterId, glyphId, pointId], null)
						set(incomingHandleXAtoms, [masterId, glyphId, pointId], null)
						set(incomingHandleYAtoms, [masterId, glyphId, pointId], null)
						set(outgoingHandleXAtoms, [masterId, glyphId, pointId], null)
						set(outgoingHandleYAtoms, [masterId, glyphId, pointId], null)
					}
					set(advanceWidthValueAtoms, [masterId, glyphId], null)
					set(glyphContourIdsAtoms, [masterId, glyphId], null)
				}
				set(glyphAtoms, glyphId, null)
				set(glyphEditorAtoms, glyphId, null)
				set(glyphLayerMasterIdsAtoms, glyphId, null)
			}
			for (const codePoint of oldCodePoints) {
				set(cmapGlyphAtoms, codePoint, null)
			}

			set(metadataAtom, deepFreeze({ ...source.metadata }))
			set(namesAtom, deepFreeze({ ...source.names }))
			set(metricsAtom, deepFreeze({ ...source.metrics }))
			set(styleAtom, deepFreeze({ ...source.style }))
			set(axisIdsAtom, deepFreeze(source.axes.map((axis) => axis.id)))
			set(masterIdsAtom, deepFreeze(source.masters.map((master) => master.id)))
			set(defaultMasterIdAtom, source.defaultMasterId)
			set(
				instanceIdsAtom,
				deepFreeze(source.instances.map((instance) => instance.id)),
			)
			set(glyphIdsAtom, deepFreeze(source.glyphs.map((glyph) => glyph.id)))
			set(
				cmapCodePointsAtom,
				deepFreeze(source.cmap.map((entry) => entry.codePoint)),
			)
			set(kerningAtom, deepFreeze([...(source.kerning ?? [])]))

			for (const axis of source.axes) {
				set(
					axisAtoms,
					axis.id,
					deepFreeze({
						tag: axis.tag,
						name: axis.name,
						min: axis.min,
						default: axis.default,
						max: axis.max,
						hidden: axis.hidden ?? false,
						map:
							axis.map === undefined
								? null
								: axis.map.map((entry) => ({ ...entry })),
					}),
				)
			}
			for (const master of source.masters) {
				set(
					masterAtoms,
					master.id,
					deepFreeze({
						kind: master.kind,
						name: master.name,
						supportKind:
							master.kind === "source"
								? master.support.kind
								: "non-intermediate",
					}),
				)
				for (const axis of source.axes) {
					set(
						masterCoordinateAtoms,
						[master.id, axis.id],
						master.kind === "source"
							? (master.location[axis.id] ?? null)
							: null,
					)
					set(
						masterSupportStartAtoms,
						[master.id, axis.id],
						master.kind === "source" && master.support.kind === "intermediate"
							? (master.support.start[axis.id] ?? null)
							: null,
					)
					set(
						masterSupportEndAtoms,
						[master.id, axis.id],
						master.kind === "source" && master.support.kind === "intermediate"
							? (master.support.end[axis.id] ?? null)
							: null,
					)
				}
			}
			for (const instance of source.instances) {
				set(
					instanceAtoms,
					instance.id,
					deepFreeze({
						name: instance.name,
						postScriptName: instance.postScriptName ?? null,
						elidable: instance.elidable ?? false,
					}),
				)
				for (const axis of source.axes) {
					set(
						instanceCoordinateAtoms,
						[instance.id, axis.id],
						instance.coordinates[axis.id] ?? null,
					)
				}
			}
			for (const glyph of source.glyphs) {
				set(
					glyphAtoms,
					glyph.id,
					deepFreeze({
						name: glyph.name,
						export: glyph.export,
						overlap: glyph.overlap ?? false,
					}),
				)
				set(
					glyphEditorAtoms,
					glyph.id,
					deepFreeze({
						note: glyph.note ?? "",
						color: glyph.color ?? null,
						rules: glyph.rules ?? [],
					}),
				)
				set(
					glyphLayerMasterIdsAtoms,
					glyph.id,
					deepFreeze(glyph.layers.map((layer) => layer.masterId)),
				)
				for (const layer of glyph.layers) {
					set(
						glyphContourIdsAtoms,
						[layer.masterId, glyph.id],
						deepFreeze(layer.contours.map((contour) => contour.id)),
					)
					for (const contour of layer.contours) {
						set(
							contourClosedAtoms,
							[layer.masterId, glyph.id, contour.id],
							contour.closed,
						)
						set(
							contourPointIdsAtoms,
							[layer.masterId, glyph.id, contour.id],
							deepFreeze(contour.points.map((point) => point.id)),
						)
					}
					const points = layer.contours.flatMap((contour) => contour.points)
					set(
						advanceWidthValueAtoms,
						[layer.masterId, glyph.id],
						layer.advanceWidth,
					)
					for (const point of points) {
						const pointId = point.id
						set(
							pointPositionValueAtoms,
							[layer.masterId, glyph.id, pointId],
							deepFreeze({ x: point.x, y: point.y }),
						)
						set(
							pointAtoms,
							[layer.masterId, glyph.id, pointId],
							deepFreeze({ mode: point.mode }),
						)
						set(
							incomingHandleXAtoms,
							[layer.masterId, glyph.id, pointId],
							point.incoming?.x ?? null,
						)
						set(
							incomingHandleYAtoms,
							[layer.masterId, glyph.id, pointId],
							point.incoming?.y ?? null,
						)
						set(
							outgoingHandleXAtoms,
							[layer.masterId, glyph.id, pointId],
							point.outgoing?.x ?? null,
						)
						set(
							outgoingHandleYAtoms,
							[layer.masterId, glyph.id, pointId],
							point.outgoing?.y ?? null,
						)
					}
				}
			}
			for (const entry of source.cmap) {
				set(cmapGlyphAtoms, entry.codePoint, entry.glyphId)
			}
			for (const coWrite of coWrites ?? []) {
				set(coWrite.atom, coWrite.value)
			}
		},
	})

	const movePointsTransaction = revisionedTransaction<
		(input: MovePointsInput) => void
	>({
		key: "movePoints",
		do: ({ get, set }, input) => {
			const glyph = get(glyphAtoms, input.glyphId)
			const layerMasterIds = get(glyphLayerMasterIdsAtoms, input.glyphId)
			if (glyph === null || layerMasterIds === null) {
				throw new TypeError(`Unknown glyph ${input.glyphId}.`)
			}
			if (!layerMasterIds.includes(input.masterId)) {
				throw new TypeError(
					`Glyph ${input.glyphId} has no ${input.masterId} layer.`,
				)
			}
			assertUnique(
				input.points.map((point) => point.pointId),
				"Moved point IDs",
			)
			for (const point of input.points) {
				if (
					get(pointAtoms, [input.masterId, input.glyphId, point.pointId]) ===
					null
				) {
					throw new TypeError(
						`Unknown point ${point.pointId} in glyph ${input.glyphId}.`,
					)
				}
				if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
					throw new TypeError("Point coordinates must be finite numbers.")
				}
			}
			writePointPositions(
				set,
				[input.masterId, input.glyphId],
				input.points.map((point) => ({
					pointId: point.pointId,
					position: deepFreeze({ x: point.x, y: point.y }),
				})),
			)
		},
	})

	const setHorizontalMetricsTransaction = revisionedTransaction<
		(input: SetHorizontalMetricsInput) => void
	>({
		key: "setHorizontalMetrics",
		do: ({ get, set }, input) => {
			const layerMasterIds = get(glyphLayerMasterIdsAtoms, input.glyphId)
			if (layerMasterIds === null || !layerMasterIds.includes(input.masterId)) {
				throw new TypeError(
					`Glyph ${input.glyphId} has no ${input.masterId} layer.`,
				)
			}
			if (
				!Number.isInteger(input.advanceWidth) ||
				input.advanceWidth < 0 ||
				input.advanceWidth > MAX_UINT16
			) {
				throw new TypeError(
					"Advance width must be an integer from 0 through 65535.",
				)
			}
			writeAdvanceWidth(
				get,
				set,
				[input.masterId, input.glyphId],
				input.advanceWidth,
			)
		},
	})

	const moveHandleTransaction = revisionedTransaction<
		(input: MoveHandleInput) => void
	>({
		key: "moveHandle",
		do: ({ get, set }, input) => {
			const layerMasterIds = get(glyphLayerMasterIdsAtoms, input.glyphId)
			const point = get(pointAtoms, [
				input.masterId,
				input.glyphId,
				input.pointId,
			])
			if (point === null || layerMasterIds === null) {
				throw new TypeError(
					`Unknown node ${input.pointId} in glyph ${input.glyphId}.`,
				)
			}
			if (!layerMasterIds.includes(input.masterId)) {
				throw new TypeError(
					`Glyph ${input.glyphId} has no ${input.masterId} layer.`,
				)
			}
			if (input.vector !== null) {
				assertFiniteVector(input.vector, `${input.handle} handle`)
			}

			const atomKey: LayerPointKey = [
				input.masterId,
				input.glyphId,
				input.pointId,
			]
			const selectedX =
				input.handle === "incoming"
					? incomingHandleXAtoms
					: outgoingHandleXAtoms
			const selectedY =
				input.handle === "incoming"
					? incomingHandleYAtoms
					: outgoingHandleYAtoms
			const oppositeX =
				input.handle === "incoming"
					? outgoingHandleXAtoms
					: incomingHandleXAtoms
			const oppositeY =
				input.handle === "incoming"
					? outgoingHandleYAtoms
					: incomingHandleYAtoms
			const current = get(layerNodeSelectors, atomKey)
			if (!current.ok) {
				throw new TypeError("Cannot edit a handle on invalid layer geometry.")
			}
			const selectedCurrentX = get(selectedX, atomKey)
			const selectedCurrentY = get(selectedY, atomKey)
			const oldOppositeX = get(oppositeX, atomKey)
			const oldOppositeY = get(oppositeY, atomKey)
			if ((selectedCurrentX === null) !== (selectedCurrentY === null)) {
				throw new TypeError("The selected handle is incomplete.")
			}
			if ((oldOppositeX === null) !== (oldOppositeY === null)) {
				throw new TypeError("The opposite handle is incomplete.")
			}

			if (input.vector === null) {
				set(selectedX, atomKey, null)
				set(selectedY, atomKey, null)
				set(
					pointAtoms,
					[input.masterId, input.glyphId, input.pointId],
					deepFreeze({ mode: "hard" }),
				)
				return
			}
			let nextOpposite: Vector2 | null = null
			if (
				point.mode === "soft" &&
				oldOppositeX !== null &&
				oldOppositeY !== null
			) {
				const movedLength = Math.hypot(input.vector.x, input.vector.y)
				const oppositeLength = Math.hypot(oldOppositeX, oldOppositeY)
				nextOpposite =
					movedLength === 0
						? { x: oldOppositeX, y: oldOppositeY }
						: {
								x: (-input.vector.x / movedLength) * oppositeLength,
								y: (-input.vector.y / movedLength) * oppositeLength,
							}
			}
			set(selectedX, atomKey, input.vector.x)
			set(selectedY, atomKey, input.vector.y)
			if (nextOpposite !== null) {
				set(oppositeX, atomKey, nextOpposite.x)
				set(oppositeY, atomKey, nextOpposite.y)
			}
		},
	})

	const applyTransformControls = (
		get: WriterToolkit["get"],
		set: WriterToolkit["set"],
		input: TransformControlsInput,
	): void => {
		const layerMasterIds = get(glyphLayerMasterIdsAtoms, input.glyphId)
		if (layerMasterIds === null || !layerMasterIds.includes(input.masterId)) {
			throw new TypeError(
				`Glyph ${input.glyphId} has no ${input.masterId} layer.`,
			)
		}
		assertUnique(
			input.points.map((point) => point.pointId),
			"Transformed point IDs",
		)
		assertUnique(
			input.handles.map((handle) => `${handle.pointId}/${handle.handle}`),
			"Transformed handles",
		)
		const nextPositions = new Map<PointId, Vector2>()
		const pointIds = new Set<PointId>()
		for (const point of input.points) pointIds.add(point.pointId)
		for (const handle of input.handles) pointIds.add(handle.pointId)
		for (const pointId of pointIds) {
			if (get(pointAtoms, [input.masterId, input.glyphId, pointId]) === null) {
				throw new TypeError(
					`Unknown point ${pointId} in glyph ${input.glyphId}.`,
				)
			}
			const atomKey: LayerPointKey = [input.masterId, input.glyphId, pointId]
			const position = readPointPosition(get, atomKey)
			if (position === null) {
				throw new TypeError(`Point ${pointId} has incomplete coordinates.`)
			}
			if (!get(layerNodeSelectors, atomKey).ok) {
				throw new TypeError(`Point ${pointId} has invalid layer geometry.`)
			}
			nextPositions.set(pointId, position)
		}
		for (const point of input.points) {
			if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
				throw new TypeError("Point coordinates must be finite numbers.")
			}
			nextPositions.set(point.pointId, { x: point.x, y: point.y })
		}
		const selectedHandles = new Map<
			PointId,
			Partial<Record<EditorHandleKind, Vector2>>
		>()
		for (const handle of input.handles) {
			if (!Number.isFinite(handle.x) || !Number.isFinite(handle.y)) {
				throw new TypeError("Handle endpoints must be finite numbers.")
			}
			const owner = nextPositions.get(handle.pointId)
			if (owner === undefined) throw new Error("Missing transformed owner.")
			const atomKey: LayerPointKey = [
				input.masterId,
				input.glyphId,
				handle.pointId,
			]
			const existingX = get(
				handle.handle === "incoming"
					? incomingHandleXAtoms
					: outgoingHandleXAtoms,
				atomKey,
			)
			const existingY = get(
				handle.handle === "incoming"
					? incomingHandleYAtoms
					: outgoingHandleYAtoms,
				atomKey,
			)
			if (existingX === null || existingY === null) {
				throw new TypeError(
					`Cannot transform missing ${handle.handle} handle on ${handle.pointId}.`,
				)
			}
			const byKind = selectedHandles.get(handle.pointId) ?? {}
			byKind[handle.handle] = {
				x: handle.x - owner.x,
				y: handle.y - owner.y,
			}
			selectedHandles.set(handle.pointId, byKind)
		}

		const writeHandle = (
			atomKey: LayerPointKey,
			handle: EditorHandleKind,
			vector: Vector2,
		): void => {
			set(
				handle === "incoming" ? incomingHandleXAtoms : outgoingHandleXAtoms,
				atomKey,
				vector.x,
			)
			set(
				handle === "incoming" ? incomingHandleYAtoms : outgoingHandleYAtoms,
				atomKey,
				vector.y,
			)
		}
		const handlePlans: {
			readonly atomKey: LayerPointKey
			readonly incoming?: Vector2
			readonly outgoing?: Vector2
		}[] = []
		for (const [pointId, selected] of selectedHandles) {
			const topology = get(pointAtoms, [input.masterId, input.glyphId, pointId])
			if (topology === null) {
				throw new TypeError(`Unknown transformed point ${pointId}.`)
			}
			const atomKey: LayerPointKey = [input.masterId, input.glyphId, pointId]
			const incomingX = get(incomingHandleXAtoms, atomKey)
			const incomingY = get(incomingHandleYAtoms, atomKey)
			const outgoingX = get(outgoingHandleXAtoms, atomKey)
			const outgoingY = get(outgoingHandleYAtoms, atomKey)
			if (
				(incomingX === null) !== (incomingY === null) ||
				(outgoingX === null) !== (outgoingY === null)
			) {
				throw new TypeError(`Point ${pointId} has an incomplete handle.`)
			}
			const oldIncoming =
				incomingX === null || incomingY === null
					? undefined
					: { x: incomingX, y: incomingY }
			const oldOutgoing =
				outgoingX === null || outgoingY === null
					? undefined
					: { x: outgoingX, y: outgoingY }
			let incoming = selected.incoming
			let outgoing = selected.outgoing
			if (
				topology.mode === "soft" &&
				oldIncoming !== undefined &&
				oldOutgoing !== undefined
			) {
				if (incoming !== undefined) {
					const oppositeLength = Math.hypot(
						...(outgoing === undefined
							? [oldOutgoing.x, oldOutgoing.y]
							: [outgoing.x, outgoing.y]),
					)
					const movedLength = Math.hypot(incoming.x, incoming.y)
					outgoing =
						movedLength === 0
							? (outgoing ?? oldOutgoing)
							: {
									x: (-incoming.x / movedLength) * oppositeLength,
									y: (-incoming.y / movedLength) * oppositeLength,
								}
				} else if (outgoing !== undefined) {
					const movedLength = Math.hypot(outgoing.x, outgoing.y)
					const oppositeLength = Math.hypot(oldIncoming.x, oldIncoming.y)
					incoming =
						movedLength === 0
							? oldIncoming
							: {
									x: (-outgoing.x / movedLength) * oppositeLength,
									y: (-outgoing.y / movedLength) * oppositeLength,
								}
				}
			}
			const finalIncoming = incoming ?? oldIncoming
			const finalOutgoing = outgoing ?? oldOutgoing
			if (
				topology.mode === "soft" &&
				(finalIncoming === undefined || finalOutgoing === undefined
					? finalIncoming === undefined && finalOutgoing === undefined
					: !handlesShareOppositeRay(finalIncoming, finalOutgoing))
			) {
				throw new TypeError(
					`Transformed soft node ${pointId} would have invalid handles.`,
				)
			}
			handlePlans.push({
				atomKey,
				...(incoming === undefined ? {} : { incoming }),
				...(outgoing === undefined ? {} : { outgoing }),
			})
		}

		writePointPositions(
			set,
			[input.masterId, input.glyphId],
			input.points.map((point) => ({
				pointId: point.pointId,
				position: deepFreeze({ x: point.x, y: point.y }),
			})),
		)
		for (const plan of handlePlans) {
			if (plan.incoming !== undefined)
				writeHandle(plan.atomKey, "incoming", plan.incoming)
			if (plan.outgoing !== undefined)
				writeHandle(plan.atomKey, "outgoing", plan.outgoing)
		}
	}
	const transformControlsTransaction = revisionedTransaction<
		(input: TransformControlsInput) => void
	>({
		key: "transformControls",
		do: ({ get, set }, input) => applyTransformControls(get, set, input),
	})

	const slideSoftNodeTransaction = revisionedTransaction<
		(input: SlideSoftNodeInput) => void
	>({
		key: "slideSoftNode",
		do: ({ get, set }, input) => {
			const layerMasterIds = get(glyphLayerMasterIdsAtoms, input.glyphId)
			const topology = get(pointAtoms, [
				input.masterId,
				input.glyphId,
				input.pointId,
			])
			if (topology === null || layerMasterIds === null) {
				throw new TypeError(
					`Unknown node ${input.pointId} in glyph ${input.glyphId}.`,
				)
			}
			if (!layerMasterIds.includes(input.masterId)) {
				throw new TypeError(
					`Glyph ${input.glyphId} has no ${input.masterId} layer.`,
				)
			}
			if (topology.mode !== "soft") {
				throw new TypeError("Only a soft node can slide along its tangent.")
			}
			if (!Number.isFinite(input.x) || !Number.isFinite(input.y)) {
				throw new TypeError("Soft-node slide coordinates must be finite.")
			}
			assertUnique(
				input.handles.map((handle) => handle.handle),
				"Soft-node slide handles",
			)
			const atomKey: LayerPointKey = [
				input.masterId,
				input.glyphId,
				input.pointId,
			]
			const currentResult = get(layerNodeSelectors, atomKey)
			if (!currentResult.ok) {
				throw new TypeError("The sliding soft node has invalid layer geometry.")
			}
			const current = currentResult.value
			const endpoints = new Map<EditorHandleKind, Vector2>(
				(["incoming", "outgoing"] as const).flatMap((handle) => {
					const vector = current[handle]
					return vector === undefined
						? []
						: [
								[
									handle,
									{ x: current.x + vector.x, y: current.y + vector.y },
								] as const,
							]
				}),
			)
			if (endpoints.size === 0) {
				throw new TypeError("A sliding soft node must have an authored handle.")
			}
			const approximatelyEqual = (left: number, right: number): boolean =>
				Math.abs(left - right) <=
				Math.max(1, Math.abs(left), Math.abs(right)) * 1e-9
			const samePosition = (left: Vector2, right: Vector2): boolean =>
				approximatelyEqual(left.x, right.x) &&
				approximatelyEqual(left.y, right.y)
			const supplied = new Map<EditorHandleKind, Vector2>()
			for (const handle of input.handles) {
				if (!Number.isFinite(handle.x) || !Number.isFinite(handle.y)) {
					throw new TypeError("Soft-node handle endpoints must be finite.")
				}
				const expected = endpoints.get(handle.handle)
				if (expected === undefined) {
					throw new TypeError(
						`Cannot slide a missing ${handle.handle} handle on ${input.pointId}.`,
					)
				}
				const endpoint = { x: handle.x, y: handle.y }
				if (!samePosition(endpoint, expected)) {
					throw new TypeError(
						`The ${handle.handle} endpoint changed before the soft-node slide committed.`,
					)
				}
				supplied.set(handle.handle, endpoint)
			}
			if (supplied.size !== endpoints.size) {
				throw new TypeError(
					"A soft-node slide must preserve every authored handle endpoint.",
				)
			}
			const candidate = { x: input.x, y: input.y }
			const isOnRange = (
				start: Vector2,
				direction: Vector2,
				maximum: number | null,
			): boolean => {
				const denominator = direction.x ** 2 + direction.y ** 2
				if (!Number.isFinite(denominator) || denominator === 0)
					return samePosition(candidate, start)
				const amount =
					((candidate.x - start.x) * direction.x +
						(candidate.y - start.y) * direction.y) /
					denominator
				const projected = {
					x: start.x + direction.x * amount,
					y: start.y + direction.y * amount,
				}
				const amountTolerance = 1e-9
				return (
					samePosition(candidate, projected) &&
					amount >= -amountTolerance &&
					(maximum === null || amount <= maximum + amountTolerance)
				)
			}
			const incoming = endpoints.get("incoming")
			const outgoing = endpoints.get("outgoing")
			if (incoming !== undefined && outgoing !== undefined) {
				if (
					!isOnRange(
						incoming,
						{ x: outgoing.x - incoming.x, y: outgoing.y - incoming.y },
						1,
					)
				) {
					throw new TypeError(
						"A two-sided soft node must remain between its collinear handles.",
					)
				}
			} else {
				const authored = incoming ?? outgoing
				if (authored === undefined)
					throw new Error("Missing authored endpoint.")
				const contourId = (
					get(glyphContourIdsAtoms, [input.masterId, input.glyphId]) ?? []
				).find((candidateId) =>
					(
						get(contourPointIdsAtoms, [
							input.masterId,
							input.glyphId,
							candidateId,
						]) ?? []
					).includes(input.pointId),
				)
				if (contourId === undefined) {
					throw new TypeError("The sliding soft node has no contour topology.")
				}
				const pointIds =
					get(contourPointIdsAtoms, [
						input.masterId,
						input.glyphId,
						contourId,
					]) ?? []
				const closed =
					get(contourClosedAtoms, [input.masterId, input.glyphId, contourId]) ??
					false
				const pointIndex = pointIds.indexOf(input.pointId)
				const handle = incoming === undefined ? "outgoing" : "incoming"
				const neighborId =
					handle === "incoming"
						? (pointIds[pointIndex + 1] ?? (closed ? pointIds[0] : undefined))
						: (pointIds[pointIndex - 1] ??
							(closed ? pointIds.at(-1) : undefined))
				let reference: Vector2 | null = null
				if (neighborId !== undefined) {
					const neighborKey: LayerPointKey = [
						input.masterId,
						input.glyphId,
						neighborId,
					]
					const neighbor = readPointPosition(get, neighborKey)
					if (
						neighbor === null ||
						!Number.isFinite(neighbor.x) ||
						!Number.isFinite(neighbor.y)
					) {
						throw new TypeError("The tangent neighbor has invalid coordinates.")
					}
					const neighborHandleX = get(
						handle === "incoming" ? incomingHandleXAtoms : outgoingHandleXAtoms,
						neighborKey,
					)
					const neighborHandleY = get(
						handle === "incoming" ? incomingHandleYAtoms : outgoingHandleYAtoms,
						neighborKey,
					)
					if ((neighborHandleX === null) !== (neighborHandleY === null)) {
						throw new TypeError("The tangent neighbor handle is incomplete.")
					}
					reference = {
						x: neighbor.x + (neighborHandleX ?? 0),
						y: neighbor.y + (neighborHandleY ?? 0),
					}
					if (samePosition(reference, current)) {
						reference = { x: neighbor.x, y: neighbor.y }
					}
				}
				if (reference !== null && !samePosition(reference, authored)) {
					if (
						!isOnRange(
							authored,
							{
								x: reference.x - authored.x,
								y: reference.y - authored.y,
							},
							1,
						)
					) {
						throw new TypeError(
							"A one-sided soft node must remain within its tangent bounds.",
						)
					}
				} else {
					const currentDirection = {
						x: current.x - authored.x,
						y: current.y - authored.y,
					}
					const direction =
						currentDirection.x !== 0 || currentDirection.y !== 0
							? currentDirection
							: input.unboundedDirection
					if (
						direction === undefined ||
						!Number.isFinite(direction.x) ||
						!Number.isFinite(direction.y) ||
						(direction.x === 0 && direction.y === 0) ||
						!isOnRange(authored, direction, null)
					) {
						throw new TypeError(
							"An unbounded soft node must remain on its original tangent ray.",
						)
					}
				}
			}
			set(
				pointPositionValueAtoms,
				atomKey,
				deepFreeze({ x: input.x, y: input.y }),
			)
			for (const [handle, endpoint] of endpoints) {
				const relativeX = endpoint.x - input.x
				const relativeY = endpoint.y - input.y
				set(
					handle === "incoming" ? incomingHandleXAtoms : outgoingHandleXAtoms,
					atomKey,
					Object.is(relativeX, -0) ? 0 : relativeX,
				)
				set(
					handle === "incoming" ? incomingHandleYAtoms : outgoingHandleYAtoms,
					atomKey,
					Object.is(relativeY, -0) ? 0 : relativeY,
				)
			}
		},
	})

	const setNodeModeTransaction = revisionedTransaction<
		(input: SetNodeModeInput) => void
	>({
		key: "setNodeMode",
		do: ({ get, set }, input) => {
			const point = get(pointAtoms, [
				input.masterId,
				input.glyphId,
				input.pointId,
			])
			const layerMasterIds = get(glyphLayerMasterIdsAtoms, input.glyphId)
			if (point === null || layerMasterIds === null) {
				throw new TypeError(
					`Unknown node ${input.pointId} in glyph ${input.glyphId}.`,
				)
			}
			if (input.mode !== "soft" && input.mode !== "hard") {
				throw new TypeError('Node mode must be "soft" or "hard".')
			}
			if (input.mode === "soft") {
				const contourId = (
					get(glyphContourIdsAtoms, [input.masterId, input.glyphId]) ?? []
				).find((candidate) =>
					(
						get(contourPointIdsAtoms, [
							input.masterId,
							input.glyphId,
							candidate,
						]) ?? []
					).includes(input.pointId),
				)
				if (contourId === undefined) return
				const contourPointIds =
					get(contourPointIdsAtoms, [
						input.masterId,
						input.glyphId,
						contourId,
					]) ?? []
				const closed =
					get(contourClosedAtoms, [input.masterId, input.glyphId, contourId]) ??
					false
				const pointIndex = contourPointIds.indexOf(input.pointId)
				const previousPointId =
					pointIndex > 0
						? contourPointIds[pointIndex - 1]
						: closed
							? contourPointIds.at(-1)
							: undefined
				const nextPointId =
					pointIndex < contourPointIds.length - 1
						? contourPointIds[pointIndex + 1]
						: closed
							? contourPointIds[0]
							: undefined
				const layerPlans: {
					readonly atomKey: LayerPointKey
					readonly incoming?: Vector2
					readonly outgoing?: Vector2
				}[] = []
				for (const masterId of [input.masterId]) {
					const atomKey: LayerPointKey = [
						masterId,
						input.glyphId,
						input.pointId,
					]
					const incomingX = get(incomingHandleXAtoms, atomKey)
					const incomingY = get(incomingHandleYAtoms, atomKey)
					const outgoingX = get(outgoingHandleXAtoms, atomKey)
					const outgoingY = get(outgoingHandleYAtoms, atomKey)
					if (
						(incomingX === null) !== (incomingY === null) ||
						(outgoingX === null) !== (outgoingY === null)
					) {
						throw new TypeError(
							"Cannot soften a node with an incomplete handle.",
						)
					}
					if (incomingX === null && outgoingX === null) return
					let incoming =
						incomingX === null || incomingY === null
							? undefined
							: { x: incomingX, y: incomingY }
					let outgoing =
						outgoingX === null || outgoingY === null
							? undefined
							: { x: outgoingX, y: outgoingY }
					if (incomingX === null || incomingY === null) {
						if (outgoing === undefined || previousPointId === undefined) return
						const position = readPointPosition(get, atomKey)
						const neighborPosition = readPointPosition(get, [
							masterId,
							input.glyphId,
							previousPointId,
						])
						if (position === null || neighborPosition === null) return
						const { x, y } = position
						const { x: neighborX, y: neighborY } = neighborPosition
						const dx = neighborX - x
						const dy = neighborY - y
						const distance = Math.hypot(dx, dy)
						if (distance === 0) return
						const length = Math.hypot(outgoing.x, outgoing.y)
						incoming = {
							x: (dx / distance) * length,
							y: (dy / distance) * length,
						}
						outgoing = { x: -incoming.x, y: -incoming.y }
						layerPlans.push({ atomKey, outgoing })
						continue
					}
					if (outgoingX === null || outgoingY === null) {
						if (incoming === undefined || nextPointId === undefined) return
						const position = readPointPosition(get, atomKey)
						const neighborPosition = readPointPosition(get, [
							masterId,
							input.glyphId,
							nextPointId,
						])
						if (position === null || neighborPosition === null) return
						const { x, y } = position
						const { x: neighborX, y: neighborY } = neighborPosition
						const dx = neighborX - x
						const dy = neighborY - y
						const distance = Math.hypot(dx, dy)
						if (distance === 0) return
						const length = Math.hypot(incoming.x, incoming.y)
						outgoing = {
							x: (dx / distance) * length,
							y: (dy / distance) * length,
						}
						incoming = { x: -outgoing.x, y: -outgoing.y }
						layerPlans.push({ atomKey, incoming })
						continue
					}
					if (incoming === undefined || outgoing === undefined) return
					const incomingLength = Math.hypot(incoming.x, incoming.y)
					const outgoingLength = Math.hypot(outgoing.x, outgoing.y)
					layerPlans.push({
						atomKey,
						incoming,
						outgoing:
							incomingLength === 0
								? { x: -incoming.x, y: -incoming.y }
								: {
										x: (-incoming.x / incomingLength) * outgoingLength,
										y: (-incoming.y / incomingLength) * outgoingLength,
									},
					})
				}
				for (const plan of layerPlans) {
					if (plan.incoming !== undefined) {
						set(incomingHandleXAtoms, plan.atomKey, plan.incoming.x)
						set(incomingHandleYAtoms, plan.atomKey, plan.incoming.y)
					}
					if (plan.outgoing !== undefined) {
						set(outgoingHandleXAtoms, plan.atomKey, plan.outgoing.x)
						set(outgoingHandleYAtoms, plan.atomKey, plan.outgoing.y)
					}
				}
			}
			set(
				pointAtoms,
				[input.masterId, input.glyphId, input.pointId],
				deepFreeze({ mode: input.mode }),
			)
		},
	})

	const toggleNodeModesTransaction = revisionedTransaction<
		(input: ToggleNodeModesInput) => ToggleNodeModesResult
	>({
		key: "toggleNodeModes",
		shouldRevise: (result) => result.toggled > 0,
		do: ({ get, set }, input) => {
			const layerMasterIds = get(glyphLayerMasterIdsAtoms, input.glyphId)
			if (layerMasterIds === null || !layerMasterIds.includes(input.masterId)) {
				throw new TypeError(`Unknown glyph ${input.glyphId}.`)
			}
			const pointIds = [...new Set(input.pointIds)]
			const plans: {
				readonly pointId: PointId
				readonly mode: EditorNodeMode
				readonly layers: readonly {
					readonly atomKey: LayerPointKey
					readonly incoming?: Vector2
					readonly outgoing?: Vector2
				}[]
			}[] = []
			let skipped = 0

			for (const pointId of pointIds) {
				const point = get(pointAtoms, [input.masterId, input.glyphId, pointId])
				if (point === null) {
					skipped++
					continue
				}
				if (point.mode === "soft") {
					plans.push({ pointId, mode: "hard", layers: [] })
					continue
				}

				const contourId = (
					get(glyphContourIdsAtoms, [input.masterId, input.glyphId]) ?? []
				).find((candidate) =>
					(
						get(contourPointIdsAtoms, [
							input.masterId,
							input.glyphId,
							candidate,
						]) ?? []
					).includes(pointId),
				)
				if (contourId === undefined) {
					skipped++
					continue
				}
				const contourPointIds =
					get(contourPointIdsAtoms, [
						input.masterId,
						input.glyphId,
						contourId,
					]) ?? []
				const closed =
					get(contourClosedAtoms, [input.masterId, input.glyphId, contourId]) ??
					false
				const pointIndex = contourPointIds.indexOf(pointId)
				const previousPointId =
					pointIndex > 0
						? contourPointIds[pointIndex - 1]
						: closed
							? contourPointIds.at(-1)
							: undefined
				const nextPointId =
					pointIndex < contourPointIds.length - 1
						? contourPointIds[pointIndex + 1]
						: closed
							? contourPointIds[0]
							: undefined
				const layers: {
					readonly atomKey: LayerPointKey
					readonly incoming?: Vector2
					readonly outgoing?: Vector2
				}[] = []
				let eligible = true
				for (const masterId of [input.masterId]) {
					const atomKey: LayerPointKey = [masterId, input.glyphId, pointId]
					const incomingX = get(incomingHandleXAtoms, atomKey)
					const incomingY = get(incomingHandleYAtoms, atomKey)
					const outgoingX = get(outgoingHandleXAtoms, atomKey)
					const outgoingY = get(outgoingHandleYAtoms, atomKey)
					if (
						(incomingX === null) !== (incomingY === null) ||
						(outgoingX === null) !== (outgoingY === null) ||
						(incomingX === null && outgoingX === null)
					) {
						eligible = false
						break
					}
					let incoming =
						incomingX === null || incomingY === null
							? undefined
							: { x: incomingX, y: incomingY }
					let outgoing =
						outgoingX === null || outgoingY === null
							? undefined
							: { x: outgoingX, y: outgoingY }
					if (incoming === undefined) {
						if (outgoing === undefined || previousPointId === undefined) {
							eligible = false
							break
						}
						const position = readPointPosition(get, atomKey)
						const neighbor = readPointPosition(get, [
							masterId,
							input.glyphId,
							previousPointId,
						])
						if (position === null || neighbor === null) {
							eligible = false
							break
						}
						const dx = neighbor.x - position.x
						const dy = neighbor.y - position.y
						const distance = Math.hypot(dx, dy)
						if (distance === 0) {
							eligible = false
							break
						}
						const length = Math.hypot(outgoing.x, outgoing.y)
						incoming = {
							x: (dx / distance) * length,
							y: (dy / distance) * length,
						}
						outgoing = { x: -incoming.x, y: -incoming.y }
						layers.push({ atomKey, outgoing })
						continue
					}
					if (outgoing === undefined) {
						if (nextPointId === undefined) {
							eligible = false
							break
						}
						const position = readPointPosition(get, atomKey)
						const neighbor = readPointPosition(get, [
							masterId,
							input.glyphId,
							nextPointId,
						])
						if (position === null || neighbor === null) {
							eligible = false
							break
						}
						const dx = neighbor.x - position.x
						const dy = neighbor.y - position.y
						const distance = Math.hypot(dx, dy)
						if (distance === 0) {
							eligible = false
							break
						}
						const length = Math.hypot(incoming.x, incoming.y)
						outgoing = {
							x: (dx / distance) * length,
							y: (dy / distance) * length,
						}
						incoming = { x: -outgoing.x, y: -outgoing.y }
						layers.push({ atomKey, incoming })
						continue
					}
					const incomingLength = Math.hypot(incoming.x, incoming.y)
					const outgoingLength = Math.hypot(outgoing.x, outgoing.y)
					layers.push({
						atomKey,
						incoming,
						outgoing:
							incomingLength === 0
								? { x: -incoming.x, y: -incoming.y }
								: {
										x: (-incoming.x / incomingLength) * outgoingLength,
										y: (-incoming.y / incomingLength) * outgoingLength,
									},
					})
				}
				if (!eligible) {
					skipped++
					continue
				}
				plans.push({ pointId, mode: "soft", layers })
			}

			for (const plan of plans) {
				for (const layer of plan.layers) {
					if (layer.incoming !== undefined) {
						set(incomingHandleXAtoms, layer.atomKey, layer.incoming.x)
						set(incomingHandleYAtoms, layer.atomKey, layer.incoming.y)
					}
					if (layer.outgoing !== undefined) {
						set(outgoingHandleXAtoms, layer.atomKey, layer.outgoing.x)
						set(outgoingHandleYAtoms, layer.atomKey, layer.outgoing.y)
					}
				}
				set(
					pointAtoms,
					[input.masterId, input.glyphId, plan.pointId],
					deepFreeze({ mode: plan.mode }),
				)
			}
			return deepFreeze({ toggled: plans.length, skipped })
		},
	})

	const authorPenEndpointTransaction = revisionedTransaction<
		(input: AuthorPenEndpointInput) => void
	>({
		key: "authorPenEndpoint",
		do: ({ get, set }, input) => {
			if (input.mode !== "soft" && input.mode !== "hard") {
				throw new TypeError('Node mode must be "soft" or "hard".')
			}
			const pointIds = get(contourPointIdsAtoms, [
				input.masterId,
				input.glyphId,
				input.contourId,
			])
			const closed = get(contourClosedAtoms, [
				input.masterId,
				input.glyphId,
				input.contourId,
			])
			const layerMasterIds = get(glyphLayerMasterIdsAtoms, input.glyphId)
			const point = get(pointAtoms, [
				input.masterId,
				input.glyphId,
				input.pointId,
			])
			if (
				pointIds === null ||
				closed === null ||
				layerMasterIds === null ||
				point === null
			) {
				throw new TypeError(
					`Unknown endpoint ${input.pointId} in contour ${input.contourId}.`,
				)
			}
			if (closed)
				throw new TypeError("A closed contour has no dangling endpoint.")
			const pointIndex = pointIds.indexOf(input.pointId)
			const expectedHandles: readonly EditorHandleKind[] =
				pointIds.length === 1
					? ["incoming", "outgoing"]
					: pointIndex === 0
						? ["incoming"]
						: pointIndex === pointIds.length - 1
							? ["outgoing"]
							: []
			if (!expectedHandles.includes(input.forwardHandle)) {
				throw new TypeError(
					`Point ${input.pointId} is not the requested dangling endpoint.`,
				)
			}
			assertUnique(
				input.coordinates.map((coordinate) => coordinate.masterId),
				"Pen endpoint coordinate master IDs",
			)
			const coordinateByMaster = new Map(
				input.coordinates.map((coordinate) => [
					coordinate.masterId,
					coordinate,
				]),
			)
			if (
				!layerMasterIds.includes(input.masterId) ||
				!coordinateByMaster.has(input.masterId)
			) {
				throw new TypeError(
					"Endpoint authoring requires coordinates for the active glyph layer.",
				)
			}
			const connectedHandle =
				input.forwardHandle === "incoming" ? "outgoing" : "incoming"
			const atomFamilies = (handle: EditorHandleKind) => ({
				x: handle === "incoming" ? incomingHandleXAtoms : outgoingHandleXAtoms,
				y: handle === "incoming" ? incomingHandleYAtoms : outgoingHandleYAtoms,
			})
			const forwardAtoms = atomFamilies(input.forwardHandle)
			const connectedAtoms = atomFamilies(connectedHandle)
			const plans: {
				readonly atomKey: LayerPointKey
				readonly forward: Vector2 | null
				readonly connected: Vector2 | null
			}[] = []
			for (const masterId of [input.masterId]) {
				const coordinate = coordinateByMaster.get(masterId)
				if (coordinate === undefined) throw new Error("Missing endpoint layer.")
				if (coordinate.forward !== null) {
					assertFiniteVector(coordinate.forward, "Forward Pen handle")
				}
				const atomKey: LayerPointKey = [masterId, input.glyphId, input.pointId]
				const forwardX = get(forwardAtoms.x, atomKey)
				const forwardY = get(forwardAtoms.y, atomKey)
				const connectedX = get(connectedAtoms.x, atomKey)
				const connectedY = get(connectedAtoms.y, atomKey)
				if (
					(forwardX === null) !== (forwardY === null) ||
					(connectedX === null) !== (connectedY === null)
				) {
					throw new TypeError("The endpoint has an incomplete handle.")
				}
				const connected =
					connectedX === null || connectedY === null
						? null
						: { x: connectedX, y: connectedY }
				if (
					input.mode === "soft" &&
					coordinate.forward === null &&
					connected === null
				) {
					throw new TypeError("A soft endpoint requires at least one handle.")
				}
				let nextConnected = connected
				if (
					input.mode === "soft" &&
					coordinate.forward !== null &&
					connected !== null
				) {
					const forwardLength = Math.hypot(
						coordinate.forward.x,
						coordinate.forward.y,
					)
					const connectedLength = Math.hypot(connected.x, connected.y)
					if (forwardLength !== 0) {
						nextConnected = {
							x: (-coordinate.forward.x / forwardLength) * connectedLength || 0,
							y: (-coordinate.forward.y / forwardLength) * connectedLength || 0,
						}
					}
				}
				plans.push({
					atomKey,
					forward: coordinate.forward,
					connected: nextConnected,
				})
			}

			for (const plan of plans) {
				set(forwardAtoms.x, plan.atomKey, plan.forward?.x ?? null)
				set(forwardAtoms.y, plan.atomKey, plan.forward?.y ?? null)
				if (plan.connected !== null) {
					set(connectedAtoms.x, plan.atomKey, plan.connected.x)
					set(connectedAtoms.y, plan.atomKey, plan.connected.y)
				}
			}
			set(
				pointAtoms,
				[input.masterId, input.glyphId, input.pointId],
				deepFreeze({ mode: input.mode }),
			)
		},
	})

	const insertPointTransaction = revisionedTransaction<
		(input: InsertPointInput) => void
	>({
		key: "insertPoint",
		do: ({ get, set }, input) => {
			if (input.point.mode !== "soft" && input.point.mode !== "hard") {
				throw new TypeError('Node mode must be "soft" or "hard".')
			}
			const pointIds = get(contourPointIdsAtoms, [
				input.masterId,
				input.glyphId,
				input.contourId,
			])
			const layerMasterIds = get(glyphLayerMasterIdsAtoms, input.glyphId)
			if (pointIds === null || layerMasterIds === null) {
				throw new TypeError(
					`Unknown contour ${input.contourId} in glyph ${input.glyphId}.`,
				)
			}
			for (const contourId of get(glyphContourIdsAtoms, [
				input.masterId,
				input.glyphId,
			]) ?? []) {
				if (
					(
						get(contourPointIdsAtoms, [
							input.masterId,
							input.glyphId,
							contourId,
						]) ?? []
					).includes(input.point.id)
				)
					throw new TypeError(`Point ID ${input.point.id} is already in use.`)
			}
			const at = input.at ?? pointIds.length
			if (!Number.isInteger(at) || at < 0 || at > pointIds.length) {
				throw new RangeError("Point insertion index is outside the contour.")
			}
			assertUnique(
				input.coordinates.map((coordinate) => coordinate.masterId),
				"Inserted point coordinate master IDs",
			)
			const coordinateIds = new Set(
				input.coordinates.map((coordinate) => coordinate.masterId),
			)
			if (
				!layerMasterIds.includes(input.masterId) ||
				!coordinateIds.has(input.masterId)
			) {
				throw new TypeError(
					"A new point requires coordinates for the active glyph layer.",
				)
			}
			for (const coordinate of input.coordinates) {
				if (!Number.isFinite(coordinate.x) || !Number.isFinite(coordinate.y)) {
					throw new TypeError("Point coordinates must be finite numbers.")
				}
				if (coordinate.incoming !== undefined) {
					assertFiniteVector(coordinate.incoming, "Incoming handle")
				}
				if (coordinate.outgoing !== undefined) {
					assertFiniteVector(coordinate.outgoing, "Outgoing handle")
				}
				if (input.point.mode === "soft") {
					if (
						coordinate.incoming === undefined &&
						coordinate.outgoing === undefined
					) {
						throw new TypeError("A soft node requires at least one handle.")
					}
					if (
						coordinate.incoming !== undefined &&
						coordinate.outgoing !== undefined &&
						!handlesShareOppositeRay(coordinate.incoming, coordinate.outgoing)
					) {
						throw new TypeError(
							"A soft node's handles must be collinear and opposite.",
						)
					}
				}
			}
			set(
				contourPointIdsAtoms,
				[input.masterId, input.glyphId, input.contourId],
				deepFreeze([
					...pointIds.slice(0, at),
					input.point.id,
					...pointIds.slice(at),
				]),
			)
			set(
				pointAtoms,
				[input.masterId, input.glyphId, input.point.id],
				deepFreeze({ mode: input.point.mode }),
			)
			for (const coordinate of input.coordinates.filter(
				(coordinate) => coordinate.masterId === input.masterId,
			)) {
				set(
					pointPositionValueAtoms,
					[coordinate.masterId, input.glyphId, input.point.id],
					deepFreeze({ x: coordinate.x, y: coordinate.y }),
				)
				set(
					incomingHandleXAtoms,
					[coordinate.masterId, input.glyphId, input.point.id],
					coordinate.incoming?.x ?? null,
				)
				set(
					incomingHandleYAtoms,
					[coordinate.masterId, input.glyphId, input.point.id],
					coordinate.incoming?.y ?? null,
				)
				set(
					outgoingHandleXAtoms,
					[coordinate.masterId, input.glyphId, input.point.id],
					coordinate.outgoing?.x ?? null,
				)
				set(
					outgoingHandleYAtoms,
					[coordinate.masterId, input.glyphId, input.point.id],
					coordinate.outgoing?.y ?? null,
				)
			}
		},
	})

	const addSegmentHandlesTransaction = revisionedTransaction<
		(input: AddSegmentHandlesInput) => boolean
	>({
		key: "addSegmentHandles",
		shouldRevise: (changed) => changed,
		do: ({ get, set }, input) => {
			const pointIds = get(contourPointIdsAtoms, [
				input.masterId,
				input.glyphId,
				input.contourId,
			])
			const closed = get(contourClosedAtoms, [
				input.masterId,
				input.glyphId,
				input.contourId,
			])
			const layerMasterIds = get(glyphLayerMasterIdsAtoms, input.glyphId)
			if (pointIds === null || closed === null || layerMasterIds === null) {
				return false
			}
			const segmentCount = Math.max(0, pointIds.length - (closed ? 0 : 1))
			if (
				!Number.isInteger(input.segmentIndex) ||
				input.segmentIndex < 0 ||
				input.segmentIndex >= segmentCount
			) {
				return false
			}
			const startPointId = pointIds[input.segmentIndex]
			const endPointId = closed
				? pointIds[(input.segmentIndex + 1) % pointIds.length]
				: pointIds[input.segmentIndex + 1]
			if (startPointId === undefined || endPointId === undefined) return false
			const startTopology = get(pointAtoms, [
				input.masterId,
				input.glyphId,
				startPointId,
			])
			const endTopology = get(pointAtoms, [
				input.masterId,
				input.glyphId,
				endPointId,
			])
			if (startTopology === null || endTopology === null) return false

			const plans: {
				readonly masterId: MasterId
				readonly startOutgoing: Vector2
				readonly endIncoming: Vector2
			}[] = []
			let hardenStart = false
			let hardenEnd = false
			for (const masterId of [input.masterId]) {
				const startKey: LayerPointKey = [masterId, input.glyphId, startPointId]
				const endKey: LayerPointKey = [masterId, input.glyphId, endPointId]
				const start = readPointPosition(get, startKey)
				const end = readPointPosition(get, endKey)
				if (start === null || end === null) return false

				const startOutgoingX = get(outgoingHandleXAtoms, startKey)
				const startOutgoingY = get(outgoingHandleYAtoms, startKey)
				const endIncomingX = get(incomingHandleXAtoms, endKey)
				const endIncomingY = get(incomingHandleYAtoms, endKey)
				if (
					startOutgoingX !== null ||
					startOutgoingY !== null ||
					endIncomingX !== null ||
					endIncomingY !== null
				) {
					return false
				}

				const handles = straightSegmentHandles(start, end)
				if (handles === null) return false
				const startIncomingX = get(incomingHandleXAtoms, startKey)
				const startIncomingY = get(incomingHandleYAtoms, startKey)
				const endOutgoingX = get(outgoingHandleXAtoms, endKey)
				const endOutgoingY = get(outgoingHandleYAtoms, endKey)
				if (
					(startIncomingX === null) !== (startIncomingY === null) ||
					(endOutgoingX === null) !== (endOutgoingY === null)
				) {
					return false
				}
				if (
					startTopology.mode === "soft" &&
					startIncomingX !== null &&
					startIncomingY !== null &&
					!handlesShareOppositeRay(
						{ x: startIncomingX, y: startIncomingY },
						handles.startOutgoing,
					)
				) {
					hardenStart = true
				}
				if (
					endTopology.mode === "soft" &&
					endOutgoingX !== null &&
					endOutgoingY !== null &&
					!handlesShareOppositeRay(handles.endIncoming, {
						x: endOutgoingX,
						y: endOutgoingY,
					})
				) {
					hardenEnd = true
				}
				plans.push({ masterId, ...handles })
			}

			if (hardenStart) {
				set(
					pointAtoms,
					[input.masterId, input.glyphId, startPointId],
					deepFreeze({ mode: "hard" }),
				)
			}
			if (hardenEnd) {
				set(
					pointAtoms,
					[input.masterId, input.glyphId, endPointId],
					deepFreeze({ mode: "hard" }),
				)
			}
			for (const plan of plans) {
				const startKey: LayerPointKey = [
					plan.masterId,
					input.glyphId,
					startPointId,
				]
				const endKey: LayerPointKey = [plan.masterId, input.glyphId, endPointId]
				set(outgoingHandleXAtoms, startKey, plan.startOutgoing.x)
				set(outgoingHandleYAtoms, startKey, plan.startOutgoing.y)
				set(incomingHandleXAtoms, endKey, plan.endIncoming.x)
				set(incomingHandleYAtoms, endKey, plan.endIncoming.y)
			}
			return true
		},
	})

	const splitSegmentTransaction = revisionedTransaction<
		(input: SplitSegmentInput) => void
	>({
		key: "splitSegment",
		do: ({ get, set }, input) => {
			const pointIds = get(contourPointIdsAtoms, [
				input.masterId,
				input.glyphId,
				input.contourId,
			])
			const closed = get(contourClosedAtoms, [
				input.masterId,
				input.glyphId,
				input.contourId,
			])
			const layerMasterIds = get(glyphLayerMasterIdsAtoms, input.glyphId)
			if (pointIds === null || closed === null || layerMasterIds === null) {
				throw new TypeError(
					`Unknown contour ${input.contourId} in glyph ${input.glyphId}.`,
				)
			}
			const segmentCount = Math.max(0, pointIds.length - (closed ? 0 : 1))
			if (
				!Number.isInteger(input.segmentIndex) ||
				input.segmentIndex < 0 ||
				input.segmentIndex >= segmentCount
			) {
				throw new RangeError("Segment index is outside the contour.")
			}
			if (
				!Number.isFinite(input.amount) ||
				input.amount <= 0.001 ||
				input.amount >= 0.999
			) {
				throw new RangeError("Segment split must stay away from its endpoints.")
			}
			for (const contourId of get(glyphContourIdsAtoms, [
				input.masterId,
				input.glyphId,
			]) ?? []) {
				if (
					(
						get(contourPointIdsAtoms, [
							input.masterId,
							input.glyphId,
							contourId,
						]) ?? []
					).includes(input.pointId)
				)
					throw new TypeError(`Point ID ${input.pointId} is already in use.`)
			}
			const startPointId = pointIds[input.segmentIndex]
			const endPointId = closed
				? pointIds[(input.segmentIndex + 1) % pointIds.length]
				: pointIds[input.segmentIndex + 1]
			if (startPointId === undefined || endPointId === undefined) {
				throw new TypeError("Segment endpoints are missing.")
			}
			const plans: {
				readonly masterId: MasterId
				readonly point: Vector2
				readonly straight: boolean
				readonly startOutgoing?: Vector2
				readonly incoming?: Vector2
				readonly outgoing?: Vector2
				readonly endIncoming?: Vector2
			}[] = []
			for (const masterId of [input.masterId]) {
				const start = get(layerNodeSelectors, [
					masterId,
					input.glyphId,
					startPointId,
				])
				const end = get(layerNodeSelectors, [
					masterId,
					input.glyphId,
					endPointId,
				])
				if (!start.ok || !end.ok) {
					throw new TypeError("Cannot split a segment with invalid endpoints.")
				}
				const straight =
					start.value.outgoing === undefined && end.value.incoming === undefined
				if (straight) {
					plans.push({
						masterId,
						straight,
						point: {
							x: start.value.x + (end.value.x - start.value.x) * input.amount,
							y: start.value.y + (end.value.y - start.value.y) * input.amount,
						},
					})
					continue
				}
				const split = splitCubicCurve(
					{
						p0: start.value,
						c1: {
							x: start.value.x + (start.value.outgoing?.x ?? 0),
							y: start.value.y + (start.value.outgoing?.y ?? 0),
						},
						c2: {
							x: end.value.x + (end.value.incoming?.x ?? 0),
							y: end.value.y + (end.value.incoming?.y ?? 0),
						},
						p3: end.value,
					},
					input.amount,
				)
				plans.push({
					masterId,
					straight,
					point: split.point,
					startOutgoing: {
						x: split.left.c1.x - split.left.p0.x,
						y: split.left.c1.y - split.left.p0.y,
					},
					incoming: {
						x: split.left.c2.x - split.point.x,
						y: split.left.c2.y - split.point.y,
					},
					outgoing: {
						x: split.right.c1.x - split.point.x,
						y: split.right.c1.y - split.point.y,
					},
					endIncoming: {
						x: split.right.c2.x - split.right.p3.x,
						y: split.right.c2.y - split.right.p3.y,
					},
				})
			}

			set(
				contourPointIdsAtoms,
				[input.masterId, input.glyphId, input.contourId],
				deepFreeze([
					...pointIds.slice(0, input.segmentIndex + 1),
					input.pointId,
					...pointIds.slice(input.segmentIndex + 1),
				]),
			)
			set(
				pointAtoms,
				[input.masterId, input.glyphId, input.pointId],
				deepFreeze({ mode: "hard" }),
			)
			const writeVector = (
				masterId: MasterId,
				pointId: PointId,
				handle: EditorHandleKind,
				vector: Vector2 | undefined,
			): void => {
				const atomKey: LayerPointKey = [masterId, input.glyphId, pointId]
				set(
					handle === "incoming" ? incomingHandleXAtoms : outgoingHandleXAtoms,
					atomKey,
					vector?.x ?? null,
				)
				set(
					handle === "incoming" ? incomingHandleYAtoms : outgoingHandleYAtoms,
					atomKey,
					vector?.y ?? null,
				)
			}
			for (const plan of plans) {
				const atomKey: LayerPointKey = [
					plan.masterId,
					input.glyphId,
					input.pointId,
				]
				set(
					pointPositionValueAtoms,
					atomKey,
					deepFreeze({ x: plan.point.x, y: plan.point.y }),
				)
				writeVector(plan.masterId, input.pointId, "incoming", plan.incoming)
				writeVector(plan.masterId, input.pointId, "outgoing", plan.outgoing)
				if (!plan.straight) {
					writeVector(
						plan.masterId,
						startPointId,
						"outgoing",
						plan.startOutgoing,
					)
					writeVector(plan.masterId, endPointId, "incoming", plan.endIncoming)
				}
			}
		},
	})

	const cutSegmentTransaction = revisionedTransaction<
		(input: CutSegmentInput) => void
	>({
		key: "cutSegment",
		do: ({ get, set }, input) => {
			const contourIds = get(glyphContourIdsAtoms, [
				input.masterId,
				input.glyphId,
			])
			const pointIds = get(contourPointIdsAtoms, [
				input.masterId,
				input.glyphId,
				input.contourId,
			])
			const closed = get(contourClosedAtoms, [
				input.masterId,
				input.glyphId,
				input.contourId,
			])
			const masterIds = get(glyphLayerMasterIdsAtoms, input.glyphId)
			if (
				contourIds === null ||
				pointIds === null ||
				closed === null ||
				masterIds === null
			) {
				throw new TypeError(`Unknown contour ${input.contourId}.`)
			}
			const segmentCount = Math.max(0, pointIds.length - (closed ? 0 : 1))
			if (
				!Number.isInteger(input.segmentIndex) ||
				input.segmentIndex < 0 ||
				input.segmentIndex >= segmentCount
			) {
				throw new RangeError("Segment index is outside the contour.")
			}
			if (
				!Number.isFinite(input.amount) ||
				input.amount <= 0.001 ||
				input.amount >= 0.999
			) {
				throw new RangeError("Segment cut must stay away from its endpoints.")
			}
			if (input.leftPointId === input.rightPointId) {
				throw new TypeError("A cut requires two distinct endpoint IDs.")
			}
			const occupiedPointIds = new Set<PointId>()
			const occupiedContourIds = new Set<ContourId>()
			for (const contourId of get(glyphContourIdsAtoms, [
				input.masterId,
				input.glyphId,
			]) ?? []) {
				occupiedContourIds.add(contourId)
				for (const pointId of get(contourPointIdsAtoms, [
					input.masterId,
					input.glyphId,
					contourId,
				]) ?? []) {
					occupiedPointIds.add(pointId)
				}
			}
			if (
				occupiedPointIds.has(input.leftPointId) ||
				occupiedPointIds.has(input.rightPointId)
			) {
				throw new TypeError("A cut point ID is already in use.")
			}
			if (!closed) {
				if (input.rightContourId === undefined) {
					throw new TypeError(
						"Cutting an open contour requires a second contour ID.",
					)
				}
				if (occupiedContourIds.has(input.rightContourId)) {
					throw new TypeError(
						`Contour ID ${input.rightContourId} is already in use.`,
					)
				}
			}

			const startPointId = pointIds[input.segmentIndex]
			const endPointId = closed
				? pointIds[(input.segmentIndex + 1) % pointIds.length]
				: pointIds[input.segmentIndex + 1]
			if (startPointId === undefined || endPointId === undefined) {
				throw new TypeError("Segment endpoints are missing.")
			}
			const plans: {
				readonly masterId: MasterId
				readonly point: Vector2
				readonly startOutgoing?: Vector2
				readonly leftIncoming?: Vector2
				readonly rightOutgoing?: Vector2
				readonly endIncoming?: Vector2
			}[] = []
			const startTopology = get(pointAtoms, [
				input.masterId,
				input.glyphId,
				startPointId,
			])
			const endTopology = get(pointAtoms, [
				input.masterId,
				input.glyphId,
				endPointId,
			])
			if (startTopology === null || endTopology === null) {
				throw new TypeError("Cut endpoint topology is missing.")
			}
			let hardenStart = false
			let hardenEnd = false
			for (const masterId of [input.masterId]) {
				const start = get(layerNodeSelectors, [
					masterId,
					input.glyphId,
					startPointId,
				])
				const end = get(layerNodeSelectors, [
					masterId,
					input.glyphId,
					endPointId,
				])
				if (!start.ok || !end.ok) {
					throw new TypeError("Cannot cut a segment with invalid endpoints.")
				}
				const straight =
					start.value.outgoing === undefined && end.value.incoming === undefined
				if (straight) {
					plans.push({
						masterId,
						point: {
							x: start.value.x + (end.value.x - start.value.x) * input.amount,
							y: start.value.y + (end.value.y - start.value.y) * input.amount,
						},
					})
					continue
				}
				const split = splitCubicCurve(
					{
						p0: start.value,
						c1: {
							x: start.value.x + (start.value.outgoing?.x ?? 0),
							y: start.value.y + (start.value.outgoing?.y ?? 0),
						},
						c2: {
							x: end.value.x + (end.value.incoming?.x ?? 0),
							y: end.value.y + (end.value.incoming?.y ?? 0),
						},
						p3: end.value,
					},
					input.amount,
				)
				const nextStartOutgoing = {
					x: split.left.c1.x - split.left.p0.x,
					y: split.left.c1.y - split.left.p0.y,
				}
				const nextEndIncoming = {
					x: split.right.c2.x - split.right.p3.x,
					y: split.right.c2.y - split.right.p3.y,
				}
				if (
					startTopology.mode === "soft" &&
					start.value.incoming !== undefined &&
					!handlesShareOppositeRay(start.value.incoming, nextStartOutgoing)
				)
					hardenStart = true
				if (
					endTopology.mode === "soft" &&
					end.value.outgoing !== undefined &&
					!handlesShareOppositeRay(nextEndIncoming, end.value.outgoing)
				)
					hardenEnd = true
				plans.push({
					masterId,
					point: split.point,
					startOutgoing: nextStartOutgoing,
					leftIncoming: {
						x: split.left.c2.x - split.point.x,
						y: split.left.c2.y - split.point.y,
					},
					rightOutgoing: {
						x: split.right.c1.x - split.point.x,
						y: split.right.c1.y - split.point.y,
					},
					endIncoming: nextEndIncoming,
				})
			}

			const leftIds = [
				...pointIds.slice(0, input.segmentIndex + 1),
				input.leftPointId,
			]
			const rightIds = [
				input.rightPointId,
				...pointIds.slice(input.segmentIndex + 1),
			]
			if (closed) {
				set(
					contourPointIdsAtoms,
					[input.masterId, input.glyphId, input.contourId],
					deepFreeze([...rightIds, ...leftIds]),
				)
				set(
					contourClosedAtoms,
					[input.masterId, input.glyphId, input.contourId],
					false,
				)
			} else {
				const rightContourId = input.rightContourId
				if (rightContourId === undefined)
					throw new TypeError("Missing contour ID.")
				set(
					contourPointIdsAtoms,
					[input.masterId, input.glyphId, input.contourId],
					deepFreeze(leftIds),
				)
				set(
					contourPointIdsAtoms,
					[input.masterId, input.glyphId, rightContourId],
					deepFreeze(rightIds),
				)
				set(
					contourClosedAtoms,
					[input.masterId, input.glyphId, rightContourId],
					false,
				)
				const sourceIndex = contourIds.indexOf(input.contourId)
				set(
					glyphContourIdsAtoms,
					[input.masterId, input.glyphId],
					deepFreeze([
						...contourIds.slice(0, sourceIndex + 1),
						rightContourId,
						...contourIds.slice(sourceIndex + 1),
					]),
				)
			}
			set(
				pointAtoms,
				[input.masterId, input.glyphId, input.leftPointId],
				deepFreeze({ mode: "hard" }),
			)
			if (hardenStart) {
				set(
					pointAtoms,
					[input.masterId, input.glyphId, startPointId],
					deepFreeze({ mode: "hard" }),
				)
			}
			if (hardenEnd) {
				set(
					pointAtoms,
					[input.masterId, input.glyphId, endPointId],
					deepFreeze({ mode: "hard" }),
				)
			}
			set(
				pointAtoms,
				[input.masterId, input.glyphId, input.rightPointId],
				deepFreeze({ mode: "hard" }),
			)
			for (const plan of plans) {
				for (const pointId of [input.leftPointId, input.rightPointId]) {
					set(
						pointPositionValueAtoms,
						[plan.masterId, input.glyphId, pointId],
						deepFreeze(plan.point),
					)
				}
				writeHandleVector(
					set,
					[plan.masterId, input.glyphId, input.leftPointId],
					"incoming",
					plan.leftIncoming,
				)
				writeHandleVector(
					set,
					[plan.masterId, input.glyphId, input.leftPointId],
					"outgoing",
					undefined,
				)
				writeHandleVector(
					set,
					[plan.masterId, input.glyphId, input.rightPointId],
					"incoming",
					undefined,
				)
				writeHandleVector(
					set,
					[plan.masterId, input.glyphId, input.rightPointId],
					"outgoing",
					plan.rightOutgoing,
				)
				if (plan.startOutgoing !== undefined) {
					writeHandleVector(
						set,
						[plan.masterId, input.glyphId, startPointId],
						"outgoing",
						plan.startOutgoing,
					)
					writeHandleVector(
						set,
						[plan.masterId, input.glyphId, endPointId],
						"incoming",
						plan.endIncoming,
					)
				}
			}
		},
	})

	const joinOpenContoursTransaction = revisionedTransaction<
		(input: JoinOpenContoursInput) => void
	>({
		key: "joinOpenContours",
		do: ({ get, set }, input) => {
			if (input.transform !== undefined) {
				if (input.transform.glyphId !== input.glyphId) {
					throw new TypeError("Join transform belongs to another glyph.")
				}
				applyTransformControls(get, set, input.transform)
			}
			const sameContour = input.draggedContourId === input.targetContourId
			const contourIds = get(glyphContourIdsAtoms, [
				input.masterId,
				input.glyphId,
			])
			const sourceIds = get(contourPointIdsAtoms, [
				input.masterId,
				input.glyphId,
				input.draggedContourId,
			])
			const targetIds = get(contourPointIdsAtoms, [
				input.masterId,
				input.glyphId,
				input.targetContourId,
			])
			const sourceClosed = get(contourClosedAtoms, [
				input.masterId,
				input.glyphId,
				input.draggedContourId,
			])
			const targetClosed = get(contourClosedAtoms, [
				input.masterId,
				input.glyphId,
				input.targetContourId,
			])
			const masterIds = get(glyphLayerMasterIdsAtoms, input.glyphId)
			if (
				contourIds === null ||
				sourceIds === null ||
				targetIds === null ||
				sourceClosed === null ||
				targetClosed === null ||
				masterIds === null
			)
				throw new TypeError("Cannot join unknown contours.")
			if (sourceClosed || targetClosed)
				throw new TypeError("Only open contours can be joined.")
			if (sameContour) {
				const draggedIsFirst = sourceIds[0] === input.draggedPointId
				const draggedIsLast = sourceIds.at(-1) === input.draggedPointId
				const targetIsFirst = sourceIds[0] === input.targetPointId
				const targetIsLast = sourceIds.at(-1) === input.targetPointId
				if (
					sourceIds.length < 4 ||
					!(
						(draggedIsFirst && targetIsLast) ||
						(draggedIsLast && targetIsFirst)
					)
				) {
					throw new TypeError(
						"Only opposite endpoints of one open contour can be rejoined.",
					)
				}
				const targetTopology = get(pointAtoms, [
					input.masterId,
					input.glyphId,
					input.targetPointId,
				])
				if (targetTopology === null)
					throw new TypeError("Target endpoint is missing.")
				const plans: {
					readonly masterId: MasterId
					readonly incoming?: Vector2
					readonly outgoing?: Vector2
				}[] = []
				let keepSoft = targetTopology.mode === "soft"
				for (const masterId of [input.masterId]) {
					const draggedResult = get(layerNodeSelectors, [
						masterId,
						input.glyphId,
						input.draggedPointId,
					])
					const targetResult = get(layerNodeSelectors, [
						masterId,
						input.glyphId,
						input.targetPointId,
					])
					if (!draggedResult.ok || !targetResult.ok)
						throw new TypeError("Cannot rejoin invalid layer nodes.")
					const dragged = draggedResult.value
					const target = targetResult.value
					const reanchor = (
						handle: Vector2 | undefined,
					): Vector2 | undefined =>
						handle === undefined
							? undefined
							: {
									x: dragged.x + handle.x - target.x,
									y: dragged.y + handle.y - target.y,
								}
					const incoming = targetIsFirst
						? reanchor(dragged.incoming)
						: target.incoming
					const outgoing = targetIsLast
						? reanchor(dragged.outgoing)
						: target.outgoing
					if (
						(incoming === undefined && outgoing === undefined) ||
						(incoming !== undefined &&
							outgoing !== undefined &&
							!handlesShareOppositeRay(incoming, outgoing))
					)
						keepSoft = false
					plans.push({
						masterId,
						...(incoming === undefined ? {} : { incoming }),
						...(outgoing === undefined ? {} : { outgoing }),
					})
				}
				set(
					contourPointIdsAtoms,
					[input.masterId, input.glyphId, input.targetContourId],
					deepFreeze(
						targetIsFirst ? sourceIds.slice(0, -1) : sourceIds.slice(1),
					),
				)
				set(
					contourClosedAtoms,
					[input.masterId, input.glyphId, input.targetContourId],
					true,
				)
				set(
					pointAtoms,
					[input.masterId, input.glyphId, input.targetPointId],
					deepFreeze({ mode: keepSoft ? "soft" : "hard" }),
				)
				for (const plan of plans) {
					writeHandleVector(
						set,
						[plan.masterId, input.glyphId, input.targetPointId],
						"incoming",
						plan.incoming,
					)
					writeHandleVector(
						set,
						[plan.masterId, input.glyphId, input.targetPointId],
						"outgoing",
						plan.outgoing,
					)
					clearLayerPoint(set, [
						plan.masterId,
						input.glyphId,
						input.draggedPointId,
					])
				}
				set(
					pointAtoms,
					[input.masterId, input.glyphId, input.draggedPointId],
					null,
				)
				return
			}
			const sourceOrientation = orientOpenContourEndpoint(
				sourceIds,
				input.draggedPointId,
				"last",
			)
			const targetOrientation = orientOpenContourEndpoint(
				targetIds,
				input.targetPointId,
				"first",
			)
			const reverseSource = sourceOrientation.reversed
			const reverseTarget = targetOrientation.reversed
			const orientedSource = sourceOrientation.pointIds
			const orientedTarget = targetOrientation.pointIds
			const targetTopology = get(pointAtoms, [
				input.masterId,
				input.glyphId,
				input.targetPointId,
			])
			if (targetTopology === null)
				throw new TypeError("Target endpoint is missing.")
			const plans: {
				readonly masterId: MasterId
				readonly nodes: ReadonlyMap<PointId, EditorLayerNode>
				readonly incoming?: Vector2
				readonly outgoing?: Vector2
			}[] = []
			let keepSoft = targetTopology.mode === "soft"
			for (const masterId of [input.masterId]) {
				const nodes = new Map<PointId, EditorLayerNode>()
				for (const pointId of new Set([...sourceIds, ...targetIds])) {
					const node = get(layerNodeSelectors, [
						masterId,
						input.glyphId,
						pointId,
					])
					if (!node.ok)
						throw new TypeError(
							"Cannot join contours with invalid layer nodes.",
						)
					nodes.set(pointId, node.value)
				}
				const dragged = nodes.get(input.draggedPointId)
				const target = nodes.get(input.targetPointId)
				if (dragged === undefined || target === undefined)
					throw new TypeError("Join endpoints are missing.")
				const connectedSource = reverseSource
					? dragged.outgoing
					: dragged.incoming
				const connectedTarget = reverseTarget
					? target.incoming
					: target.outgoing
				const incoming =
					connectedSource === undefined
						? undefined
						: {
								x: dragged.x + connectedSource.x - target.x,
								y: dragged.y + connectedSource.y - target.y,
							}
				const outgoing = connectedTarget
				if (
					(incoming === undefined && outgoing === undefined) ||
					(incoming !== undefined &&
						outgoing !== undefined &&
						!handlesShareOppositeRay(incoming, outgoing))
				)
					keepSoft = false
				plans.push({
					masterId,
					nodes,
					...(incoming === undefined ? {} : { incoming }),
					...(outgoing === undefined ? {} : { outgoing }),
				})
			}

			const survivorPosition = Math.min(
				contourIds.indexOf(input.draggedContourId),
				contourIds.indexOf(input.targetContourId),
			)
			const remainingContours = contourIds.filter(
				(contourId) =>
					contourId !== input.draggedContourId &&
					contourId !== input.targetContourId,
			)
			remainingContours.splice(survivorPosition, 0, input.targetContourId)
			set(
				glyphContourIdsAtoms,
				[input.masterId, input.glyphId],
				deepFreeze(remainingContours),
			)
			set(
				contourPointIdsAtoms,
				[input.masterId, input.glyphId, input.targetContourId],
				deepFreeze([...orientedSource.slice(0, -1), ...orientedTarget]),
			)
			set(
				contourClosedAtoms,
				[input.masterId, input.glyphId, input.targetContourId],
				false,
			)
			set(
				contourPointIdsAtoms,
				[input.masterId, input.glyphId, input.draggedContourId],
				null,
			)
			set(
				contourClosedAtoms,
				[input.masterId, input.glyphId, input.draggedContourId],
				null,
			)
			set(
				pointAtoms,
				[input.masterId, input.glyphId, input.targetPointId],
				deepFreeze({ mode: keepSoft ? "soft" : "hard" }),
			)
			for (const plan of plans) {
				if (reverseSource) {
					for (const pointId of sourceIds) {
						const node = plan.nodes.get(pointId)
						if (node === undefined) continue
						writeHandleVector(
							set,
							[plan.masterId, input.glyphId, pointId],
							"incoming",
							node.outgoing,
						)
						writeHandleVector(
							set,
							[plan.masterId, input.glyphId, pointId],
							"outgoing",
							node.incoming,
						)
					}
				}
				if (reverseTarget) {
					for (const pointId of targetIds) {
						const node = plan.nodes.get(pointId)
						if (node === undefined) continue
						writeHandleVector(
							set,
							[plan.masterId, input.glyphId, pointId],
							"incoming",
							node.outgoing,
						)
						writeHandleVector(
							set,
							[plan.masterId, input.glyphId, pointId],
							"outgoing",
							node.incoming,
						)
					}
				}
				writeHandleVector(
					set,
					[plan.masterId, input.glyphId, input.targetPointId],
					"incoming",
					plan.incoming,
				)
				writeHandleVector(
					set,
					[plan.masterId, input.glyphId, input.targetPointId],
					"outgoing",
					plan.outgoing,
				)
				const removedKey: LayerPointKey = [
					plan.masterId,
					input.glyphId,
					input.draggedPointId,
				]
				clearLayerPoint(set, removedKey)
			}
			set(
				pointAtoms,
				[input.masterId, input.glyphId, input.draggedPointId],
				null,
			)
		},
	})

	const reverseContourTransaction = revisionedTransaction<
		(input: ReverseContourInput) => void
	>({
		key: "reverseContour",
		do: ({ get, set }, input) => {
			const pointIds = get(contourPointIdsAtoms, [
				input.masterId,
				input.glyphId,
				input.contourId,
			])
			const closed = get(contourClosedAtoms, [
				input.masterId,
				input.glyphId,
				input.contourId,
			])
			const masterIds = get(glyphLayerMasterIdsAtoms, input.glyphId)
			if (pointIds === null || closed === null || masterIds === null) {
				throw new TypeError(`Unknown contour ${input.contourId}.`)
			}
			if (pointIds.length < 2) return
			const first = pointIds[0]
			if (first === undefined) return
			set(
				contourPointIdsAtoms,
				[input.masterId, input.glyphId, input.contourId],
				deepFreeze(
					closed
						? [first, ...pointIds.slice(1).reverse()]
						: [...pointIds].reverse(),
				),
			)
			for (const masterId of [input.masterId]) {
				for (const pointId of pointIds) {
					const atomKey: LayerPointKey = [masterId, input.glyphId, pointId]
					const incomingX = get(incomingHandleXAtoms, atomKey)
					const incomingY = get(incomingHandleYAtoms, atomKey)
					const outgoingX = get(outgoingHandleXAtoms, atomKey)
					const outgoingY = get(outgoingHandleYAtoms, atomKey)
					set(incomingHandleXAtoms, atomKey, outgoingX)
					set(incomingHandleYAtoms, atomKey, outgoingY)
					set(outgoingHandleXAtoms, atomKey, incomingX)
					set(outgoingHandleYAtoms, atomKey, incomingY)
				}
			}
		},
	})

	const invertContourTransaction = revisionedTransaction<
		(input: InvertContourInput) => void
	>({
		key: "invertContour",
		do: ({ get, set }, input) => {
			if (input.axis !== "horizontal" && input.axis !== "vertical") {
				throw new TypeError('Invert axis must be "horizontal" or "vertical".')
			}
			const pointIds = get(contourPointIdsAtoms, [
				input.masterId,
				input.glyphId,
				input.contourId,
			])
			const closed = get(contourClosedAtoms, [
				input.masterId,
				input.glyphId,
				input.contourId,
			])
			const masterIds = get(glyphLayerMasterIdsAtoms, input.glyphId)
			if (pointIds === null || closed === null || masterIds === null) {
				throw new TypeError(`Unknown contour ${input.contourId}.`)
			}
			if (!masterIds.includes(input.masterId)) {
				throw new TypeError(
					`Glyph ${input.glyphId} has no ${input.masterId} layer.`,
				)
			}
			if (pointIds.length === 0) return

			if (!Number.isFinite(input.centerX) || !Number.isFinite(input.centerY)) {
				throw new TypeError("Contour control bounds center must be finite.")
			}

			const activeGeometry = new Map<
				PointId,
				{
					readonly position: Vector2
					readonly incoming: Vector2 | null
					readonly outgoing: Vector2 | null
				}
			>()
			const readHandle = (
				atomKey: LayerPointKey,
				handle: EditorHandleKind,
			): Vector2 | null => {
				const x = get(
					handle === "incoming" ? incomingHandleXAtoms : outgoingHandleXAtoms,
					atomKey,
				)
				const y = get(
					handle === "incoming" ? incomingHandleYAtoms : outgoingHandleYAtoms,
					atomKey,
				)
				if ((x === null) !== (y === null)) {
					throw new TypeError(
						`The ${handle} handle on ${atomKey[2]} is incomplete.`,
					)
				}
				return x === null || y === null ? null : { x, y }
			}
			for (const pointId of pointIds) {
				if (
					get(pointAtoms, [input.masterId, input.glyphId, pointId]) === null
				) {
					throw new TypeError(
						`Unknown point ${pointId} in contour ${input.contourId}.`,
					)
				}
				const atomKey: LayerPointKey = [input.masterId, input.glyphId, pointId]
				const position = readPointPosition(get, atomKey)
				if (position === null) {
					throw new TypeError(`Point ${pointId} has incomplete coordinates.`)
				}
				const incoming = readHandle(atomKey, "incoming")
				const outgoing = readHandle(atomKey, "outgoing")
				activeGeometry.set(pointId, { position, incoming, outgoing })
			}

			const plans: {
				readonly atomKey: LayerPointKey
				readonly position?: Vector2
				readonly incoming: Vector2 | null
				readonly outgoing: Vector2 | null
			}[] = []
			const reflectVector = (vector: Vector2 | null): Vector2 | null =>
				vector === null
					? null
					: input.axis === "horizontal"
						? { x: -vector.x, y: vector.y }
						: { x: vector.x, y: -vector.y }
			for (const masterId of [input.masterId]) {
				for (const pointId of pointIds) {
					const atomKey: LayerPointKey = [masterId, input.glyphId, pointId]
					const incoming = readHandle(atomKey, "incoming")
					const outgoing = readHandle(atomKey, "outgoing")
					const geometry = activeGeometry.get(pointId)
					if (geometry === undefined)
						throw new Error("Missing active geometry.")
					plans.push({
						atomKey,
						position:
							input.axis === "horizontal"
								? {
										x: 2 * input.centerX - geometry.position.x,
										y: geometry.position.y,
									}
								: {
										x: geometry.position.x,
										y: 2 * input.centerY - geometry.position.y,
									},
						incoming: reflectVector(outgoing),
						outgoing: reflectVector(incoming),
					})
				}
			}

			const first = pointIds[0]
			if (first === undefined) return
			set(
				contourPointIdsAtoms,
				[input.masterId, input.glyphId, input.contourId],
				deepFreeze(
					closed
						? [first, ...pointIds.slice(1).reverse()]
						: [...pointIds].reverse(),
				),
			)
			for (const plan of plans) {
				if (plan.position !== undefined) {
					set(pointPositionValueAtoms, plan.atomKey, deepFreeze(plan.position))
				}
				set(incomingHandleXAtoms, plan.atomKey, plan.incoming?.x ?? null)
				set(incomingHandleYAtoms, plan.atomKey, plan.incoming?.y ?? null)
				set(outgoingHandleXAtoms, plan.atomKey, plan.outgoing?.x ?? null)
				set(outgoingHandleYAtoms, plan.atomKey, plan.outgoing?.y ?? null)
			}
		},
	})

	const makeNodeFirstTransaction = revisionedTransaction<
		(input: MakeNodeFirstInput) => void
	>({
		key: "makeNodeFirst",
		do: ({ get, set }, input) => {
			const pointIds = get(contourPointIdsAtoms, [
				input.masterId,
				input.glyphId,
				input.contourId,
			])
			const closed = get(contourClosedAtoms, [
				input.masterId,
				input.glyphId,
				input.contourId,
			])
			if (pointIds === null || closed === null) {
				throw new TypeError(`Unknown contour ${input.contourId}.`)
			}
			if (!closed)
				throw new TypeError("Only closed contours have a rotatable first node.")
			const index = pointIds.indexOf(input.pointId)
			if (index < 0)
				throw new TypeError(`Point ${input.pointId} is not in the contour.`)
			if (index === 0) return
			set(
				contourPointIdsAtoms,
				[input.masterId, input.glyphId, input.contourId],
				deepFreeze([...pointIds.slice(index), ...pointIds.slice(0, index)]),
			)
		},
	})

	const createContourTransaction = revisionedTransaction<
		(input: CreateContourInput) => void
	>({
		key: "createContour",
		do: ({ get, set }, input) => {
			const contourIds = get(glyphContourIdsAtoms, [
				input.masterId,
				input.glyphId,
			])
			const layerMasterIds = get(glyphLayerMasterIdsAtoms, input.glyphId)
			if (contourIds === null || layerMasterIds === null) {
				throw new TypeError(`Unknown glyph ${input.glyphId}.`)
			}
			for (const contourId of contourIds) {
				if (contourId === input.contourId) {
					throw new TypeError(
						`Contour ID ${input.contourId} is already in use.`,
					)
				}
				if (
					(
						get(contourPointIdsAtoms, [
							input.masterId,
							input.glyphId,
							contourId,
						]) ?? []
					).includes(input.point.id)
				) {
					throw new TypeError(`Point ID ${input.point.id} is already in use.`)
				}
			}
			if (input.point.mode !== "soft" && input.point.mode !== "hard") {
				throw new TypeError('Node mode must be "soft" or "hard".')
			}
			assertUnique(
				input.coordinates.map((coordinate) => coordinate.masterId),
				"New contour coordinate master IDs",
			)
			const coordinateIds = new Set(
				input.coordinates.map((coordinate) => coordinate.masterId),
			)
			if (
				!layerMasterIds.includes(input.masterId) ||
				!coordinateIds.has(input.masterId)
			) {
				throw new TypeError(
					"A new contour point requires coordinates for the active glyph layer.",
				)
			}
			for (const coordinate of input.coordinates) {
				if (!Number.isFinite(coordinate.x) || !Number.isFinite(coordinate.y)) {
					throw new TypeError("Point coordinates must be finite numbers.")
				}
				if (coordinate.incoming !== undefined) {
					assertFiniteVector(coordinate.incoming, "Incoming handle")
				}
				if (coordinate.outgoing !== undefined) {
					assertFiniteVector(coordinate.outgoing, "Outgoing handle")
				}
				if (input.point.mode === "soft") {
					if (
						coordinate.incoming === undefined &&
						coordinate.outgoing === undefined
					) {
						throw new TypeError("A soft node requires at least one handle.")
					}
					if (
						coordinate.incoming !== undefined &&
						coordinate.outgoing !== undefined &&
						!handlesShareOppositeRay(coordinate.incoming, coordinate.outgoing)
					) {
						throw new TypeError(
							"A soft node's handles must be collinear and opposite.",
						)
					}
				}
			}

			set(
				glyphContourIdsAtoms,
				[input.masterId, input.glyphId],
				deepFreeze([...contourIds, input.contourId]),
			)
			set(
				contourPointIdsAtoms,
				[input.masterId, input.glyphId, input.contourId],
				deepFreeze([input.point.id]),
			)
			set(
				contourClosedAtoms,
				[input.masterId, input.glyphId, input.contourId],
				false,
			)
			set(
				pointAtoms,
				[input.masterId, input.glyphId, input.point.id],
				deepFreeze({ mode: input.point.mode }),
			)
			for (const coordinate of input.coordinates.filter(
				(coordinate) => coordinate.masterId === input.masterId,
			)) {
				const atomKey: LayerPointKey = [
					coordinate.masterId,
					input.glyphId,
					input.point.id,
				]
				set(
					pointPositionValueAtoms,
					atomKey,
					deepFreeze({ x: coordinate.x, y: coordinate.y }),
				)
				set(incomingHandleXAtoms, atomKey, coordinate.incoming?.x ?? null)
				set(incomingHandleYAtoms, atomKey, coordinate.incoming?.y ?? null)
				set(outgoingHandleXAtoms, atomKey, coordinate.outgoing?.x ?? null)
				set(outgoingHandleYAtoms, atomKey, coordinate.outgoing?.y ?? null)
			}
		},
	})

	const setContourClosedTransaction = revisionedTransaction<
		(input: SetContourClosedInput) => void
	>({
		key: "setContourClosed",
		do: ({ get, set }, input) => {
			const pointIds = get(contourPointIdsAtoms, [
				input.masterId,
				input.glyphId,
				input.contourId,
			])
			if (pointIds === null) {
				throw new TypeError(
					`Unknown contour ${input.contourId} in glyph ${input.glyphId}.`,
				)
			}
			if (input.closed && pointIds.length < 3) {
				throw new TypeError("A closed contour requires at least three points.")
			}
			set(
				contourClosedAtoms,
				[input.masterId, input.glyphId, input.contourId],
				input.closed,
			)
		},
	})

	const reorderContourTransaction = revisionedTransaction<
		(input: ReorderContourInput) => void
	>({
		key: "reorderContour",
		do: ({ get, set }, input) => {
			const contourIds = get(glyphContourIdsAtoms, [
				input.masterId,
				input.glyphId,
			])
			if (contourIds === null) {
				throw new TypeError(
					`Unknown glyph layer ${input.glyphId}/${input.masterId}.`,
				)
			}
			const fromIndex = contourIds.indexOf(input.contourId)
			if (fromIndex < 0) {
				throw new TypeError(`Unknown contour ${input.contourId}.`)
			}
			if (
				!Number.isInteger(input.toIndex) ||
				input.toIndex < 0 ||
				input.toIndex >= contourIds.length
			) {
				throw new RangeError("Path order index is outside the layer.")
			}
			if (fromIndex === input.toIndex) return
			const next = [...contourIds]
			next.splice(fromIndex, 1)
			next.splice(input.toIndex, 0, input.contourId)
			set(
				glyphContourIdsAtoms,
				[input.masterId, input.glyphId],
				deepFreeze(next),
			)
		},
	})

	const closeContourTransaction = revisionedTransaction<
		(input: CloseContourInput) => void
	>({
		key: "closeContour",
		do: ({ get, set }, input) => {
			const pointIds = get(contourPointIdsAtoms, [
				input.masterId,
				input.glyphId,
				input.contourId,
			])
			const closed = get(contourClosedAtoms, [
				input.masterId,
				input.glyphId,
				input.contourId,
			])
			const layerMasterIds = get(glyphLayerMasterIdsAtoms, input.glyphId)
			if (pointIds === null || closed === null || layerMasterIds === null) {
				throw new TypeError(
					`Unknown contour ${input.contourId} in glyph ${input.glyphId}.`,
				)
			}
			if (closed) throw new TypeError("Contour is already closed.")
			if (pointIds.length < 3) {
				throw new TypeError("A closed contour requires at least three points.")
			}
			const firstPointId = pointIds[0]
			if (
				firstPointId === undefined ||
				get(pointAtoms, [input.masterId, input.glyphId, firstPointId]) === null
			) {
				throw new TypeError("The contour's first point is missing.")
			}
			for (const masterId of [input.masterId]) {
				const firstPoint = get(layerNodeSelectors, [
					masterId,
					input.glyphId,
					firstPointId,
				])
				if (!firstPoint.ok) {
					throw new TypeError(
						`The contour's first point is invalid in layer ${masterId}.`,
					)
				}
			}

			if (input.firstPoint !== undefined && input.lastPoint !== undefined) {
				throw new TypeError("A closure can replace only one endpoint.")
			}
			const replacement = input.firstPoint ?? input.lastPoint
			const replacementPointId =
				input.lastPoint === undefined ? firstPointId : pointIds.at(-1)
			if (replacement !== undefined) {
				if (
					replacementPointId === undefined ||
					replacement.pointId !== replacementPointId
				) {
					throw new TypeError(
						`Point ${replacement.pointId} is not the requested closure endpoint.`,
					)
				}
				for (const masterId of [input.masterId]) {
					const endpoint = get(layerNodeSelectors, [
						masterId,
						input.glyphId,
						replacement.pointId,
					])
					if (!endpoint.ok) {
						throw new TypeError(
							`The closure endpoint is invalid in layer ${masterId}.`,
						)
					}
				}
				if (replacement.mode !== "soft") {
					throw new TypeError('A replacement closure point must be "soft".')
				}
				assertUnique(
					replacement.coordinates.map((coordinate) => coordinate.masterId),
					"Closure point coordinate master IDs",
				)
				const coordinateIds = new Set(
					replacement.coordinates.map((coordinate) => coordinate.masterId),
				)
				if (!coordinateIds.has(input.masterId)) {
					throw new TypeError(
						"A replacement closure point requires handles for the active glyph layer.",
					)
				}
				for (const coordinate of replacement.coordinates) {
					assertFiniteVector(coordinate.incoming, "Incoming handle")
					assertFiniteVector(coordinate.outgoing, "Outgoing handle")
					if (
						!handlesShareOppositeRay(coordinate.incoming, coordinate.outgoing)
					) {
						throw new TypeError(
							"A replacement closure point's handles must be collinear and opposite.",
						)
					}
				}
			}

			if (replacement !== undefined) {
				set(
					pointAtoms,
					[input.masterId, input.glyphId, replacement.pointId],
					deepFreeze({ mode: replacement.mode }),
				)
				for (const coordinate of replacement.coordinates.filter(
					(coordinate) => coordinate.masterId === input.masterId,
				)) {
					const atomKey: LayerPointKey = [
						coordinate.masterId,
						input.glyphId,
						replacement.pointId,
					]
					set(incomingHandleXAtoms, atomKey, coordinate.incoming.x)
					set(incomingHandleYAtoms, atomKey, coordinate.incoming.y)
					set(outgoingHandleXAtoms, atomKey, coordinate.outgoing.x)
					set(outgoingHandleYAtoms, atomKey, coordinate.outgoing.y)
				}
			}
			set(
				contourClosedAtoms,
				[input.masterId, input.glyphId, input.contourId],
				true,
			)
		},
	})

	const createCompleteContourTransaction = revisionedTransaction<
		(input: CreateCompleteContourInput) => void
	>({
		key: "createCompleteContour",
		do: ({ get, set }, input) => {
			const contourIds = get(glyphContourIdsAtoms, [
				input.masterId,
				input.glyphId,
			])
			const layerMasterIds = get(glyphLayerMasterIdsAtoms, input.glyphId)
			if (contourIds === null || layerMasterIds === null) {
				throw new TypeError(`Unknown glyph ${input.glyphId}.`)
			}
			if (!input.contour.closed || input.contour.points.length < 3) {
				throw new TypeError(
					"A complete authored contour must be closed with at least three points.",
				)
			}
			const pointIds = input.contour.points.map((point) => point.id)
			assertUnique(pointIds, "Complete contour point IDs")
			for (const point of input.contour.points) {
				if (point.mode !== "soft" && point.mode !== "hard") {
					throw new TypeError('Node mode must be "soft" or "hard".')
				}
			}
			const occupiedContours = new Set<ContourId>()
			const occupiedPoints = new Set<PointId>()
			for (const contourId of contourIds) {
				occupiedContours.add(contourId)
				for (const pointId of get(contourPointIdsAtoms, [
					input.masterId,
					input.glyphId,
					contourId,
				]) ?? []) {
					occupiedPoints.add(pointId)
				}
			}
			if (occupiedContours.has(input.contour.id)) {
				throw new TypeError(`Contour ID ${input.contour.id} is already in use.`)
			}
			for (const pointId of pointIds) {
				if (occupiedPoints.has(pointId)) {
					throw new TypeError(`Point ID ${pointId} is already in use.`)
				}
			}

			assertUnique(
				input.layers.map((layer) => layer.masterId),
				"Complete contour layer master IDs",
			)
			const layersByMaster = new Map(
				input.layers.map((layer) => [layer.masterId, layer]),
			)
			if (
				!layerMasterIds.includes(input.masterId) ||
				!layersByMaster.has(input.masterId)
			) {
				throw new TypeError(
					"A complete contour requires coordinates for the active glyph layer.",
				)
			}
			const pointIdSet = new Set(pointIds)
			const modes = new Map(
				input.contour.points.map((point) => [point.id, point.mode]),
			)
			for (const layer of input.layers.filter(
				(layer) => layer.masterId === input.masterId,
			)) {
				assertUnique(
					layer.points.map((point) => point.pointId),
					`Complete contour ${layer.masterId} point IDs`,
				)
				if (
					layer.points.length !== pointIds.length ||
					layer.points.some((point) => !pointIdSet.has(point.pointId))
				) {
					throw new TypeError(
						`Complete contour layer ${layer.masterId} must contain every point exactly once.`,
					)
				}
				for (const point of layer.points) {
					if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
						throw new TypeError("Point coordinates must be finite numbers.")
					}
					if (point.incoming !== undefined) {
						assertFiniteVector(point.incoming, "Incoming handle")
					}
					if (point.outgoing !== undefined) {
						assertFiniteVector(point.outgoing, "Outgoing handle")
					}
					if (modes.get(point.pointId) === "soft") {
						if (point.incoming === undefined && point.outgoing === undefined) {
							throw new TypeError("A soft node requires at least one handle.")
						}
						if (
							point.incoming !== undefined &&
							point.outgoing !== undefined &&
							!handlesShareOppositeRay(point.incoming, point.outgoing)
						) {
							throw new TypeError(
								"A soft node's handles must be collinear and opposite.",
							)
						}
					}
				}
			}

			set(
				glyphContourIdsAtoms,
				[input.masterId, input.glyphId],
				deepFreeze([...contourIds, input.contour.id]),
			)
			set(
				contourPointIdsAtoms,
				[input.masterId, input.glyphId, input.contour.id],
				deepFreeze(pointIds),
			)
			set(
				contourClosedAtoms,
				[input.masterId, input.glyphId, input.contour.id],
				true,
			)
			for (const point of input.contour.points) {
				set(
					pointAtoms,
					[input.masterId, input.glyphId, point.id],
					deepFreeze({ mode: point.mode }),
				)
			}
			for (const layer of input.layers.filter(
				(layer) => layer.masterId === input.masterId,
			)) {
				for (const point of layer.points) {
					const atomKey: LayerPointKey = [
						layer.masterId,
						input.glyphId,
						point.pointId,
					]
					set(
						pointPositionValueAtoms,
						atomKey,
						deepFreeze({ x: point.x, y: point.y }),
					)
					set(incomingHandleXAtoms, atomKey, point.incoming?.x ?? null)
					set(incomingHandleYAtoms, atomKey, point.incoming?.y ?? null)
					set(outgoingHandleXAtoms, atomKey, point.outgoing?.x ?? null)
					set(outgoingHandleYAtoms, atomKey, point.outgoing?.y ?? null)
				}
			}
		},
	})

	const pasteContoursTransaction = revisionedTransaction<
		(input: PasteContoursInput) => void
	>({
		key: "pasteContours",
		do: ({ get, set }, input) => {
			const contourIds = get(glyphContourIdsAtoms, [
				input.masterId,
				input.glyphId,
			])
			const layerMasterIds = get(glyphLayerMasterIdsAtoms, input.glyphId)
			if (contourIds === null || layerMasterIds === null) {
				throw new TypeError(`Unknown glyph ${input.glyphId}.`)
			}
			if (input.contours.length === 0) {
				throw new TypeError(
					"Pasted outlines must contain at least one contour.",
				)
			}

			const pastedContourIds = input.contours.map((contour) => contour.id)
			const pastedPoints = input.contours.flatMap((contour) => contour.points)
			const pastedPointIds = pastedPoints.map((point) => point.id)
			assertUnique(pastedContourIds, "Pasted contour IDs")
			assertUnique(pastedPointIds, "Pasted point IDs")
			if (pastedPoints.length === 0) {
				throw new TypeError("Pasted contours must contain points.")
			}
			for (const contour of input.contours) {
				if (contour.points.length === 0) {
					throw new TypeError(`Pasted contour ${contour.id} is empty.`)
				}
				if (contour.closed && contour.points.length < 3) {
					throw new TypeError(
						"A closed contour requires at least three points.",
					)
				}
				for (const point of contour.points) {
					if (point.mode !== "soft" && point.mode !== "hard") {
						throw new TypeError('Node mode must be "soft" or "hard".')
					}
				}
			}

			const occupiedContours = new Set<ContourId>()
			const occupiedPoints = new Set<PointId>()
			for (const contourId of contourIds) {
				occupiedContours.add(contourId)
				for (const pointId of get(contourPointIdsAtoms, [
					input.masterId,
					input.glyphId,
					contourId,
				]) ?? []) {
					occupiedPoints.add(pointId)
				}
			}
			for (const contourId of pastedContourIds) {
				if (occupiedContours.has(contourId)) {
					throw new TypeError(`Contour ID ${contourId} is already in use.`)
				}
			}
			for (const pointId of pastedPointIds) {
				if (occupiedPoints.has(pointId)) {
					throw new TypeError(`Point ID ${pointId} is already in use.`)
				}
			}

			assertUnique(
				input.layers.map((layer) => layer.masterId),
				"Pasted layer master IDs",
			)
			const layersByMaster = new Map(
				input.layers.map((layer) => [layer.masterId, layer]),
			)
			if (
				!layerMasterIds.includes(input.masterId) ||
				!layersByMaster.has(input.masterId)
			) {
				throw new TypeError(
					"Pasted outlines require coordinates for the active destination layer.",
				)
			}
			const pastedPointIdSet = new Set(pastedPointIds)
			for (const layer of input.layers.filter(
				(layer) => layer.masterId === input.masterId,
			)) {
				assertUnique(
					layer.points.map((point) => point.pointId),
					`Pasted ${layer.masterId} point IDs`,
				)
				if (
					layer.points.length !== pastedPointIds.length ||
					layer.points.some((point) => !pastedPointIdSet.has(point.pointId))
				) {
					throw new TypeError(
						`Pasted layer ${layer.masterId} must contain every pasted point exactly once.`,
					)
				}
				for (const point of layer.points) {
					if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
						throw new TypeError("Point coordinates must be finite numbers.")
					}
					if (point.incoming !== undefined) {
						assertFiniteVector(point.incoming, "Incoming handle")
					}
					if (point.outgoing !== undefined) {
						assertFiniteVector(point.outgoing, "Outgoing handle")
					}
				}
			}

			set(
				glyphContourIdsAtoms,
				[input.masterId, input.glyphId],
				deepFreeze([...contourIds, ...pastedContourIds]),
			)
			for (const contour of input.contours) {
				set(
					contourPointIdsAtoms,
					[input.masterId, input.glyphId, contour.id],
					deepFreeze(contour.points.map((point) => point.id)),
				)
				set(
					contourClosedAtoms,
					[input.masterId, input.glyphId, contour.id],
					contour.closed,
				)
				for (const point of contour.points) {
					set(
						pointAtoms,
						[input.masterId, input.glyphId, point.id],
						deepFreeze({ mode: point.mode }),
					)
				}
			}
			for (const layer of input.layers.filter(
				(layer) => layer.masterId === input.masterId,
			)) {
				for (const point of layer.points) {
					const atomKey: LayerPointKey = [
						layer.masterId,
						input.glyphId,
						point.pointId,
					]
					set(
						pointPositionValueAtoms,
						atomKey,
						deepFreeze({ x: point.x, y: point.y }),
					)
					set(incomingHandleXAtoms, atomKey, point.incoming?.x ?? null)
					set(incomingHandleYAtoms, atomKey, point.incoming?.y ?? null)
					set(outgoingHandleXAtoms, atomKey, point.outgoing?.x ?? null)
					set(outgoingHandleYAtoms, atomKey, point.outgoing?.y ?? null)
				}
			}
		},
	})

	const deleteSelectionTransaction = revisionedTransaction<
		(input: DeleteSelectionInput) => void
	>({
		key: "deleteSelection",
		do: ({ get, set }, input) => {
			const contourIds = get(glyphContourIdsAtoms, [
				input.masterId,
				input.glyphId,
			])
			const layerMasterIds = get(glyphLayerMasterIdsAtoms, input.glyphId)
			if (contourIds === null || layerMasterIds === null) {
				throw new TypeError(`Unknown glyph ${input.glyphId}.`)
			}
			if (!layerMasterIds.includes(input.masterId)) {
				throw new TypeError(
					`Glyph ${input.glyphId} has no ${input.masterId} layer.`,
				)
			}
			assertUnique(input.pointIds, "Deleted point IDs")
			const deleted = new Set(input.pointIds)
			for (const pointId of deleted) {
				if (
					get(pointAtoms, [input.masterId, input.glyphId, pointId]) === null
				) {
					throw new TypeError(
						`Unknown point ${pointId} in glyph ${input.glyphId}.`,
					)
				}
			}

			const handled = new Set<string>()
			const breakHandles: {
				readonly pointId: PointId
				readonly handle: EditorHandleKind
			}[] = []
			for (const selection of input.handles) {
				if (deleted.has(selection.pointId)) continue
				const selectionKey = `${selection.pointId}/${selection.handle}`
				if (handled.has(selectionKey)) continue
				handled.add(selectionKey)
				if (
					get(pointAtoms, [
						input.masterId,
						input.glyphId,
						selection.pointId,
					]) === null
				) {
					throw new TypeError(
						`Unknown point ${selection.pointId} in glyph ${input.glyphId}.`,
					)
				}
				if (input.breakPaths) breakHandles.push(selection)
				const atomKey: LayerPointKey = [
					input.masterId,
					input.glyphId,
					selection.pointId,
				]
				set(
					selection.handle === "incoming"
						? incomingHandleXAtoms
						: outgoingHandleXAtoms,
					atomKey,
					null,
				)
				set(
					selection.handle === "incoming"
						? incomingHandleYAtoms
						: outgoingHandleYAtoms,
					atomKey,
					null,
				)
				set(
					pointAtoms,
					[input.masterId, input.glyphId, selection.pointId],
					deepFreeze({ mode: "hard" }),
				)
			}

			if (deleted.size === 0 && breakHandles.length === 0) return
			const nextContourIds: ContourId[] = []
			const knownContourIds = new Set(contourIds)
			for (const contourId of contourIds) {
				const pointIds = get(contourPointIdsAtoms, [
					input.masterId,
					input.glyphId,
					contourId,
				])
				const closed = get(contourClosedAtoms, [
					input.masterId,
					input.glyphId,
					contourId,
				])
				if (pointIds === null || closed === null) {
					throw new TypeError(
						`Unknown contour ${contourId} in glyph ${input.glyphId}.`,
					)
				}
				const contourDeleted = new Set(
					pointIds.filter((pointId) => deleted.has(pointId)),
				)
				const brokenSegmentStarts = new Set<PointId>()
				for (const selection of breakHandles) {
					const pointIndex: number = pointIds.indexOf(selection.pointId)
					if (pointIndex === -1) continue
					const startIndex: number =
						selection.handle === "outgoing" ? pointIndex : pointIndex - 1
					if (
						!closed &&
						(startIndex < 0 || startIndex >= pointIds.length - 1)
					) {
						continue
					}
					const wrappedStartIndex =
						(startIndex + pointIds.length) % pointIds.length
					const startPointId = pointIds[wrappedStartIndex]
					if (startPointId !== undefined) brokenSegmentStarts.add(startPointId)
				}
				if (contourDeleted.size === 0 && brokenSegmentStarts.size === 0) {
					nextContourIds.push(contourId)
					continue
				}
				const runs = input.breakPaths
					? remainingPointRuns(
							pointIds,
							contourDeleted,
							brokenSegmentStarts,
							closed,
						)
					: [pointIds.filter((pointId) => !contourDeleted.has(pointId))]
				const nonEmptyRuns = runs.filter((run) => run.length > 0)
				if (nonEmptyRuns.length === 0) {
					set(
						contourPointIdsAtoms,
						[input.masterId, input.glyphId, contourId],
						null,
					)
					set(
						contourClosedAtoms,
						[input.masterId, input.glyphId, contourId],
						null,
					)
					continue
				}
				for (const [runIndex, run] of nonEmptyRuns.entries()) {
					const firstPointId = run[0]
					if (firstPointId === undefined) continue
					const nextContourId =
						runIndex === 0
							? contourId
							: splitContourId(input.glyphId, firstPointId)
					if (runIndex > 0 && knownContourIds.has(nextContourId)) {
						throw new TypeError(
							`Generated contour ID ${nextContourId} is in use.`,
						)
					}
					knownContourIds.add(nextContourId)
					nextContourIds.push(nextContourId)
					set(
						contourPointIdsAtoms,
						[input.masterId, input.glyphId, nextContourId],
						deepFreeze([...run]),
					)
					set(
						contourClosedAtoms,
						[input.masterId, input.glyphId, nextContourId],
						input.breakPaths ? false : closed,
					)
					if (!input.breakPaths) continue
					const lastPointId = run.at(-1)
					if (lastPointId === undefined) continue
					for (const masterId of [input.masterId]) {
						set(
							incomingHandleXAtoms,
							[masterId, input.glyphId, firstPointId],
							null,
						)
						set(
							incomingHandleYAtoms,
							[masterId, input.glyphId, firstPointId],
							null,
						)
						set(
							outgoingHandleXAtoms,
							[masterId, input.glyphId, lastPointId],
							null,
						)
						set(
							outgoingHandleYAtoms,
							[masterId, input.glyphId, lastPointId],
							null,
						)
					}
					set(
						pointAtoms,
						[input.masterId, input.glyphId, firstPointId],
						deepFreeze({ mode: "hard" }),
					)
					set(
						pointAtoms,
						[input.masterId, input.glyphId, lastPointId],
						deepFreeze({ mode: "hard" }),
					)
				}
			}
			set(
				glyphContourIdsAtoms,
				[input.masterId, input.glyphId],
				deepFreeze(nextContourIds),
			)
			for (const pointId of deleted) {
				set(pointAtoms, [input.masterId, input.glyphId, pointId], null)
				for (const masterId of [input.masterId]) {
					const atomKey: LayerPointKey = [masterId, input.glyphId, pointId]
					set(pointPositionValueAtoms, atomKey, null)
					set(incomingHandleXAtoms, atomKey, null)
					set(incomingHandleYAtoms, atomKey, null)
					set(outgoingHandleXAtoms, atomKey, null)
					set(outgoingHandleYAtoms, atomKey, null)
				}
			}
		},
	})

	const setKerningPairTransaction = revisionedTransaction<
		(input: SetKerningPairInput) => void
	>({
		key: "setKerningPair",
		do: ({ get, set }, input) => {
			if (
				!get(glyphIdsAtom).includes(input.left) ||
				!get(glyphIdsAtom).includes(input.right)
			)
				throw new TypeError("Kerning pairs require known glyphs.")
			if (
				input.value !== null &&
				(!Number.isInteger(input.value) ||
					input.value < MIN_INT16 ||
					input.value > MAX_INT16)
			)
				throw new TypeError("Kerning values must be signed 16-bit integers.")
			const pairs = [
				...get(kerningAtom).filter(
					(pair) => pair.left !== input.left || pair.right !== input.right,
				),
			]
			if (input.value !== null && input.value !== 0)
				pairs.push({ left: input.left, right: input.right, value: input.value })
			set(kerningAtom, deepFreeze(pairs))
		},
	})

	const runReplaceFont = silo.runTransaction(replaceFontTransaction)
	const runMovePoints = silo.runTransaction(movePointsTransaction)
	const runSetHorizontalMetrics = silo.runTransaction(
		setHorizontalMetricsTransaction,
	)
	const runMoveHandle = silo.runTransaction(moveHandleTransaction)
	const runTransformControls = silo.runTransaction(transformControlsTransaction)
	const runSlideSoftNode = silo.runTransaction(slideSoftNodeTransaction)
	const runSetNodeMode = silo.runTransaction(setNodeModeTransaction)
	const runToggleNodeModes = silo.runTransaction(toggleNodeModesTransaction)
	const runAuthorPenEndpoint = silo.runTransaction(authorPenEndpointTransaction)
	const runInsertPoint = silo.runTransaction(insertPointTransaction)
	const runAddSegmentHandles = silo.runTransaction(addSegmentHandlesTransaction)
	const runSplitSegment = silo.runTransaction(splitSegmentTransaction)
	const runCutSegment = silo.runTransaction(cutSegmentTransaction)
	const runJoinOpenContours = silo.runTransaction(joinOpenContoursTransaction)
	const runReverseContour = silo.runTransaction(reverseContourTransaction)
	const runInvertContour = silo.runTransaction(invertContourTransaction)
	const runMakeNodeFirst = silo.runTransaction(makeNodeFirstTransaction)
	const runCreateContour = silo.runTransaction(createContourTransaction)
	const runSetContourClosed = silo.runTransaction(setContourClosedTransaction)
	const runReorderContour = silo.runTransaction(reorderContourTransaction)
	const runCloseContour = silo.runTransaction(closeContourTransaction)
	const runCreateCompleteContour = silo.runTransaction(
		createCompleteContourTransaction,
	)
	const runPasteContours = silo.runTransaction(pasteContoursTransaction)
	const runDeleteSelection = silo.runTransaction(deleteSelectionTransaction)
	const runSetKerningPair = silo.runTransaction(setKerningPairTransaction)

	const assertKnownGlyphHistory = (glyphId: GlyphId): void => {
		if (!silo.getState(glyphIdsAtom).includes(glyphId)) {
			throw new TypeError(`Unknown glyph history ${glyphId}.`)
		}
	}

	return {
		silo,
		atoms: {
			documentRevision: documentRevisionAtom,
			metadata: metadataAtom,
			names: namesAtom,
			metrics: metricsAtom,
			style: styleAtom,
			axisIds: axisIdsAtom,
			masterIds: masterIdsAtom,
			defaultMasterId: defaultMasterIdAtom,
			instanceIds: instanceIdsAtom,
			glyphIds: glyphIdsAtom,
			cmapCodePoints: cmapCodePointsAtom,
			axis: axisAtoms,
			master: masterAtoms,
			masterCoordinate: masterCoordinateAtoms,
			masterSupportStart: masterSupportStartAtoms,
			masterSupportEnd: masterSupportEndAtoms,
			instance: instanceAtoms,
			instanceCoordinate: instanceCoordinateAtoms,
			glyph: glyphAtoms,
			glyphEditor: glyphEditorAtoms,
			glyphContourIds: glyphContourIdsAtoms,
			contourPointIds: contourPointIdsAtoms,
			contourClosed: contourClosedAtoms,
			point: pointAtoms,
			glyphLayerMasterIds: glyphLayerMasterIdsAtoms,
			advanceWidth: advanceWidthSelectors,
			pointPosition: pointPositionSelectors,
			incomingHandleX: incomingHandleXAtoms,
			incomingHandleY: incomingHandleYAtoms,
			outgoingHandleX: outgoingHandleXAtoms,
			outgoingHandleY: outgoingHandleYAtoms,
			cmapGlyph: cmapGlyphAtoms,
			kerning: kerningAtom,
		},
		selectors: {
			editorSource: editorSourceSelector,
			editorAxisSource: editorAxisSourceSelectors,
			editorAxesSource: editorAxesSourceSelector,
			editorMasterSource: editorMasterSourceSelectors,
			editorMastersSource: editorMastersSourceSelector,
			editorInstanceSource: editorInstanceSourceSelectors,
			editorInstancesSource: editorInstancesSourceSelector,
			editorGlyphSource: editorGlyphSourceSelectors,
			editorStructure: editorStructureSelector,
			axisSource: axisSourceSelectors,
			axesSource: axesSourceSelector,
			masterUserLocation: masterUserLocationSelectors,
			masterRegion: masterRegionSelectors,
			variationModel: variationModelSelector,
			instanceSource: instanceSourceSelectors,
			instancesSource: instancesSourceSelector,
			layerNode: layerNodeSelectors,
			layerBounds: layerBoundsSelectors,
			leftSideBearing: leftSideBearingSelectors,
			rightSideBearing: rightSideBearingSelectors,
			curveSegmentPlan: curveSegmentPlanSelectors,
			glyphLayer: glyphLayerSelectors,
			glyphCompatibility: glyphCompatibilitySelectors,
			glyphVariations: glyphVariationSelectors,
			glyphSource: glyphSourceSelectors,
			livePreviewGlyphSource: livePreviewGlyphSourceSelectors,
			exportedGlyphIds: exportedGlyphIdsSelector,
			glyphsSource: glyphsSourceSelector,
			livePreviewGlyphsSource: livePreviewGlyphsSourceSelector,
			cmapEntry: cmapEntrySelectors,
			cmapSource: cmapSourceSelector,
			metadataSource: metadataSourceSelector,
			namesSource: namesSourceSelector,
			metricsSource: metricsSourceSelector,
			styleSource: styleSourceSelector,
			fontSource: fontSourceSelector,
			compilation: fontCompilationSelector,
			livePreviewCompilation: livePreviewFontCompilationSelector,
		},
		transactions: {
			movePoints: movePointsTransaction,
			setHorizontalMetrics: setHorizontalMetricsTransaction,
			moveHandle: moveHandleTransaction,
			transformControls: transformControlsTransaction,
			slideSoftNode: slideSoftNodeTransaction,
			setNodeMode: setNodeModeTransaction,
			toggleNodeModes: toggleNodeModesTransaction,
			authorPenEndpoint: authorPenEndpointTransaction,
			insertPoint: insertPointTransaction,
			addSegmentHandles: addSegmentHandlesTransaction,
			splitSegment: splitSegmentTransaction,
			cutSegment: cutSegmentTransaction,
			joinOpenContours: joinOpenContoursTransaction,
			reverseContour: reverseContourTransaction,
			invertContour: invertContourTransaction,
			makeNodeFirst: makeNodeFirstTransaction,
			createContour: createContourTransaction,
			setContourClosed: setContourClosedTransaction,
			reorderContour: reorderContourTransaction,
			closeContour: closeContourTransaction,
			createCompleteContour: createCompleteContourTransaction,
			pasteContours: pasteContoursTransaction,
			deleteSelection: deleteSelectionTransaction,
			setKerningPair: setKerningPairTransaction,
		},
		glyphHistoryTimelines,
		kerningTimeline,
		actions: {
			setGlyphRules({ glyphId, rules }: SetGlyphRulesInput): void {
				assertKnownGlyphHistory(glyphId)
				const editor = silo.getState(glyphEditorAtoms, glyphId)
				if (editor === null) throw new TypeError(`Unknown glyph ${glyphId}.`)
				const seen = new Set<string>()
				for (const rule of rules) {
					if (seen.has(rule.id))
						throw new TypeError(`Duplicate rule ID ${rule.id}.`)
					seen.add(rule.id)
					if (
						![rule.a.x, rule.a.y, rule.b.x, rule.b.y].every(Number.isFinite) ||
						Math.hypot(rule.b.x - rule.a.x, rule.b.y - rule.a.y) <= 1e-6
					)
						throw new TypeError(`Rule ${rule.id} is invalid.`)
				}
				silo.setState(
					glyphEditorAtoms,
					glyphId,
					deepFreeze({ ...editor, rules: [...rules] }),
				)
				markDocumentChanged()
			},
			setFeatureSubstitutions(
				substitutions: readonly {
					readonly feature: string
					readonly from: readonly GlyphId[]
					readonly to: GlyphId
					readonly contextIndex?: number
				}[],
			): void {
				silo.setState(featureSubstitutionsAtom, deepFreeze([...substitutions]))
			},
			markDocumentChanged,
			load<const CoWrites extends readonly FontLoadCoWriteCandidate[]>(
				source: EditorFontSource,
				coWrites?: CoWrites & FontLoadCoWrites<CoWrites>,
			): void {
				const previousGlyphIds = silo.getState(glyphIdsAtom)
				runReplaceFont(source, coWrites)
				const nextGlyphIds = silo.getState(glyphIdsAtom)
				const nextGlyphIdSet = new Set(nextGlyphIds)
				for (const glyphId of previousGlyphIds) {
					if (!nextGlyphIdSet.has(glyphId)) {
						silo.disposeTimeline(glyphHistoryTimelines, glyphId)
					}
				}
				for (const glyphId of nextGlyphIds) {
					silo.clearTimeline(glyphHistoryTimelines, glyphId)
				}
				silo.clearTimeline(kerningTimeline)
			},
			movePoints(input: MovePointsInput): void {
				runMovePoints(input)
			},
			setHorizontalMetrics(input: SetHorizontalMetricsInput): void {
				runSetHorizontalMetrics(input)
			},
			moveHandle(input: MoveHandleInput): void {
				runMoveHandle(input)
			},
			transformControls(input: TransformControlsInput): void {
				runTransformControls(input)
			},
			slideSoftNode(input: SlideSoftNodeInput): void {
				runSlideSoftNode(input)
			},
			setNodeMode(input: SetNodeModeInput): void {
				runSetNodeMode(input)
			},
			toggleNodeModes(input: ToggleNodeModesInput): ToggleNodeModesResult {
				return runToggleNodeModes(input)
			},
			authorPenEndpoint(input: AuthorPenEndpointInput): void {
				runAuthorPenEndpoint(input)
			},
			insertPoint(input: InsertPointInput): void {
				runInsertPoint(input)
			},
			addSegmentHandles(input: AddSegmentHandlesInput): boolean {
				return runAddSegmentHandles(input)
			},
			splitSegment(input: SplitSegmentInput): void {
				runSplitSegment(input)
			},
			cutSegment(input: CutSegmentInput): void {
				runCutSegment(input)
			},
			joinOpenContours(input: JoinOpenContoursInput): void {
				runJoinOpenContours(input)
			},
			reverseContour(input: ReverseContourInput): void {
				runReverseContour(input)
			},
			invertContour(input: InvertContourInput): void {
				runInvertContour(input)
			},
			makeNodeFirst(input: MakeNodeFirstInput): void {
				runMakeNodeFirst(input)
			},
			createContour(input: CreateContourInput): void {
				runCreateContour(input)
			},
			setContourClosed(input: SetContourClosedInput): void {
				runSetContourClosed(input)
			},
			reorderContour(input: ReorderContourInput): void {
				runReorderContour(input)
			},
			closeContour(input: CloseContourInput): void {
				runCloseContour(input)
			},
			createCompleteContour(input: CreateCompleteContourInput): void {
				runCreateCompleteContour(input)
			},
			pasteContours(input: PasteContoursInput): void {
				runPasteContours(input)
			},
			deleteSelection(input: DeleteSelectionInput): void {
				runDeleteSelection(input)
			},
			setKerningPair(input: SetKerningPairInput): void {
				runSetKerningPair(input)
			},
			undoKerning(): void {
				silo.undo(kerningTimeline)
				markDocumentChanged()
			},
			redoKerning(): void {
				silo.redo(kerningTimeline)
				markDocumentChanged()
			},
		},
		read: {
			editorSource: (): EditorFontSource | null =>
				silo.getState(editorSourceSelector),
			glyphLayer: (masterId: MasterId, glyphId: GlyphId) =>
				silo.getState(glyphLayerSelectors, [masterId, glyphId]),
			glyphCompatibility: (
				referenceMasterId: MasterId,
				comparisonMasterId: MasterId,
				glyphId: GlyphId,
			) =>
				silo.getState(glyphCompatibilitySelectors, [
					referenceMasterId,
					comparisonMasterId,
					glyphId,
				]),
			layerNode: (masterId: MasterId, glyphId: GlyphId, pointId: PointId) =>
				silo.getState(layerNodeSelectors, [masterId, glyphId, pointId]),
			glyphSource: (glyphId: GlyphId) =>
				silo.getState(glyphSourceSelectors, glyphId),
			editorGlyphSource: (glyphId: GlyphId) =>
				silo.getState(editorGlyphSourceSelectors, glyphId),
			variationModel: () => silo.getState(variationModelSelector),
			fontSource: () => silo.getState(fontSourceSelector),
			compilation: (): FontCompilation =>
				silo.getState(fontCompilationSelector),
			livePreviewCompilation: (): FontCompilation =>
				silo.getState(livePreviewFontCompilationSelector),
		},
		undo: (glyphId: GlyphId): void => {
			assertKnownGlyphHistory(glyphId)
			silo.undo(glyphHistoryTimelines, glyphId)
			markDocumentChanged()
		},
		redo: (glyphId: GlyphId): void => {
			assertKnownGlyphHistory(glyphId)
			silo.redo(glyphHistoryTimelines, glyphId)
			markDocumentChanged()
		},
		clearHistory: (glyphId?: GlyphId): void => {
			if (glyphId !== undefined) {
				assertKnownGlyphHistory(glyphId)
				silo.clearTimeline(glyphHistoryTimelines, glyphId)
				return
			}
			for (const currentGlyphId of silo.getState(glyphIdsAtom)) {
				silo.clearTimeline(glyphHistoryTimelines, currentGlyphId)
			}
		},
	}
}
