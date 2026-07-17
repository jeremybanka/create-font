import { scopeFamily, Silo } from "atom.io"
import {
	ingestVariableFont,
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

import { splitCubicCurve, straightSegmentHandles } from "./curve-geometry.ts"

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
	type EditorContourSource,
	type EditorFontSource,
	type EditorGlyphSource,
	type EditorHandleKind,
	type EditorHandleVectorSource,
	type EditorLayerPointSource,
	type EditorMasterSource,
	type EditorNodeMode,
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
export type GlyphContourKey = readonly [glyphId: GlyphId, contourId: ContourId]
export type GlyphPointKey = readonly [glyphId: GlyphId, pointId: PointId]
export type LayerKey = readonly [masterId: MasterId, glyphId: GlyphId]
export type LayerPointKey = readonly [
	masterId: MasterId,
	glyphId: GlyphId,
	pointId: PointId,
]
export type CurveSegmentKey = readonly [
	glyphId: GlyphId,
	contourId: ContourId,
	segmentIndex: number,
]

function splitContourId(glyphId: GlyphId, firstPointId: PointId): ContourId {
	return `contour:${glyphId}:split:${firstPointId}`
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
export interface EditorLayerNode extends EditorLayerPointSource {
	readonly mode: EditorNodeMode
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

export type SetHorizontalMetricsInput = Readonly<{
	masterId: MasterId
	glyphId: GlyphId
}> &
	(
		| Readonly<{ advanceWidth: number; leftSideBearing?: number }>
		| Readonly<{ advanceWidth?: number; leftSideBearing: number }>
	)

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

export interface SplitSegmentInput {
	readonly glyphId: GlyphId
	readonly contourId: ContourId
	readonly segmentIndex: number
	readonly pointId: PointId
	/** Shared curve parameter applied to every master. */
	readonly amount: number
}

export interface AddSegmentHandlesInput {
	readonly glyphId: GlyphId
	readonly contourId: ContourId
	readonly segmentIndex: number
}

export interface ReverseContourInput {
	readonly glyphId: GlyphId
	readonly contourId: ContourId
}

export interface MakeNodeFirstInput extends ReverseContourInput {
	readonly pointId: PointId
}

export interface SetNodeModeInput {
	readonly glyphId: GlyphId
	readonly pointId: PointId
	readonly mode: EditorNodeMode
}

export interface InsertPointInput {
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

export interface CreateContourInput {
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

/** Complete outline fragments ready to append to an existing glyph. */
export interface PasteContoursInput {
	readonly glyphId: GlyphId
	readonly contours: readonly EditorContourSource[]
	readonly layers: readonly {
		readonly masterId: MasterId
		readonly points: readonly EditorLayerPointSource[]
	}[]
}

export interface SetContourClosedInput {
	readonly glyphId: GlyphId
	readonly contourId: ContourId
	readonly closed: boolean
}

export interface CloseContourInput {
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
	return {
		x: (direction.x / directionLength) * length,
		y: (direction.y / directionLength) * length,
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

	const contourIds = new Set<ContourId>()
	const pointIds = new Set<PointId>()
	for (const glyph of source.glyphs) {
		assertUnique(
			glyph.contours.map((contour) => contour.id),
			`Contour IDs in glyph ${glyph.id}`,
		)
		assertUnique(
			glyph.layers.map((layer) => layer.masterId),
			`Layer master IDs in glyph ${glyph.id}`,
		)
		const glyphPointIds = new Set<PointId>()
		const glyphPoints = new Map<
			PointId,
			EditorGlyphSource["contours"][number]["points"][number]
		>()
		for (const contour of glyph.contours) {
			if (typeof contour.closed !== "boolean") {
				throw new TypeError(`Contour ${contour.id} must declare closed state.`)
			}
			if (contourIds.has(contour.id)) {
				throw new TypeError(`Contour ID ${contour.id} is not globally unique.`)
			}
			contourIds.add(contour.id)
			assertUnique(
				contour.points.map((point) => point.id),
				`Point IDs in contour ${contour.id}`,
			)
			for (const point of contour.points) {
				if (point.mode !== "soft" && point.mode !== "hard") {
					throw new TypeError(`Point ${point.id} has an invalid node mode.`)
				}
				if (pointIds.has(point.id)) {
					throw new TypeError(`Point ID ${point.id} is not globally unique.`)
				}
				pointIds.add(point.id)
				glyphPointIds.add(point.id)
				glyphPoints.set(point.id, point)
			}
		}
		for (const layer of glyph.layers) {
			if (!masterIds.has(layer.masterId)) {
				throw new TypeError(
					`Glyph ${glyph.id} layer refers to unknown master ${layer.masterId}.`,
				)
			}
			assertUnique(
				layer.points.map((point) => point.pointId),
				`Layer point IDs in ${glyph.id}/${layer.masterId}`,
			)
			for (const point of layer.points) {
				if (!glyphPointIds.has(point.pointId)) {
					throw new TypeError(
						`Glyph ${glyph.id} layer refers to unknown point ${point.pointId}.`,
					)
				}
				if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
					throw new TypeError(
						`Glyph ${glyph.id} layer point ${point.pointId} must contain finite coordinates.`,
					)
				}
				if (point.incoming !== undefined) {
					assertFiniteVector(
						point.incoming,
						`Incoming handle for ${point.pointId}`,
					)
				}
				if (point.outgoing !== undefined) {
					assertFiniteVector(
						point.outgoing,
						`Outgoing handle for ${point.pointId}`,
					)
				}
				if (glyphPoints.get(point.pointId)?.mode === "soft") {
					if (point.incoming === undefined && point.outgoing === undefined) {
						throw new TypeError(
							`Soft node ${point.pointId} must have at least one handle.`,
						)
					}
					if (
						point.incoming !== undefined &&
						point.outgoing !== undefined &&
						!handlesShareOppositeRay(point.incoming, point.outgoing)
					) {
						throw new TypeError(
							`Soft node ${point.pointId} handles must be collinear and opposite.`,
						)
					}
				}
			}
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
	const cmapCodePointsAtom = silo.atom<readonly number[]>({
		key: "cmapCodePoints",
		default: Object.freeze([]),
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
		GlyphId
	>({
		key: "glyphContourIds",
		default: null,
	})
	const contourPointIdsAtoms = silo.atomFamily<
		readonly PointId[] | null,
		GlyphContourKey
	>({
		key: "contourPointIds",
		default: null,
	})
	const contourClosedAtoms = silo.atomFamily<boolean | null, GlyphContourKey>({
		key: "contourClosed",
		default: null,
	})
	const pointAtoms = silo.atomFamily<PointState | null, GlyphPointKey>({
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
	const advanceWidthAtoms = silo.atomFamily<number | null, LayerKey>({
		key: "advanceWidth",
		default: null,
	})
	const leftSideBearingAtoms = silo.atomFamily<number | null, LayerKey>({
		key: "leftSideBearing",
		default: null,
	})
	const pointPositionAtoms = silo.atomFamily<Vector2 | null, LayerPointKey>({
		key: "pointPosition",
		default: null,
	})
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
	const cmapGlyphAtoms = silo.atomFamily<GlyphId | null, number>({
		key: "cmapGlyph",
		default: null,
	})
	const glyphHistoryTimelines = silo.timelineFamily<GlyphId>({
		key: "glyphHistory",
		scope: [
			scopeFamily(glyphAtoms, { timelineKey: (glyphId) => glyphId }),
			scopeFamily(glyphEditorAtoms, { timelineKey: (glyphId) => glyphId }),
			scopeFamily(glyphContourIdsAtoms, {
				timelineKey: (glyphId) => glyphId,
			}),
			scopeFamily(glyphLayerMasterIdsAtoms, {
				timelineKey: (glyphId) => glyphId,
			}),
			scopeFamily(contourPointIdsAtoms, {
				timelineKey: ([glyphId]) => glyphId,
			}),
			scopeFamily(contourClosedAtoms, {
				timelineKey: ([glyphId]) => glyphId,
			}),
			scopeFamily(pointAtoms, {
				timelineKey: ([glyphId]) => glyphId,
			}),
			scopeFamily(advanceWidthAtoms, {
				timelineKey: ([, glyphId]) => glyphId,
			}),
			scopeFamily(leftSideBearingAtoms, {
				timelineKey: ([, glyphId]) => glyphId,
			}),
			scopeFamily(pointPositionAtoms, {
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
				const topology = get(pointAtoms, [glyphId, pointId])
				const position = get(pointPositionAtoms, [masterId, glyphId, pointId])
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
						const contourId = (get(glyphContourIdsAtoms, glyphId) ?? []).find(
							(candidate) =>
								(
									get(contourPointIdsAtoms, [glyphId, candidate]) ?? []
								).includes(pointId),
						)
						if (contourId !== undefined) {
							const pointIds =
								get(contourPointIdsAtoms, [glyphId, contourId]) ?? []
							const closed =
								get(contourClosedAtoms, [glyphId, contourId]) ?? false
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
								const neighborPosition = get(pointPositionAtoms, [
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

	const curveSegmentPlanSelectors = silo.selectorFamily<
		ProjectionResult<CurveSegmentPlan>,
		CurveSegmentKey
	>({
		key: "curveSegmentPlan",
		get:
			([glyphId, contourId, segmentIndex]) =>
			({ get }) => {
				const path = `$.glyphs[${glyphId}].contours[${contourId}].segments[${segmentIndex}]`
				const pointIds = get(contourPointIdsAtoms, [glyphId, contourId])
				const closed = get(contourClosedAtoms, [glyphId, contourId])
				const masterIds = get(glyphLayerMasterIdsAtoms, glyphId)
				const segmentCount =
					pointIds === null
						? 0
						: Math.max(0, pointIds.length - (closed ? 0 : 1))
				if (
					pointIds === null ||
					closed === null ||
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
					const start = get(layerNodeSelectors, [
						masterId,
						glyphId,
						startPointId,
					])
					const end = get(layerNodeSelectors, [masterId, glyphId, endPointId])
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

	const glyphLayerSelectors = silo.selectorFamily<
		ProjectionResult<CompiledGlyphLayer>,
		LayerKey
	>({
		key: "glyphLayer",
		get:
			([masterId, glyphId]) =>
			({ get }) => {
				const path = `$.glyphs[${glyphId}].layers[${masterId}]`
				const glyph = get(glyphAtoms, glyphId)
				const master = get(masterAtoms, masterId)
				const layerMasterIds = get(glyphLayerMasterIdsAtoms, glyphId)
				const contourIds = get(glyphContourIdsAtoms, glyphId)
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
					get(advanceWidthAtoms, [masterId, glyphId]),
					0,
					MAX_UINT16,
					`${path}.advanceWidth`,
					glyphId,
				)
				const leftSideBearing = projectRoundedInteger(
					get(leftSideBearingAtoms, [masterId, glyphId]),
					MIN_INT16,
					MAX_INT16,
					`${path}.leftSideBearing`,
					glyphId,
				)
				warnings.push(...advanceWidth.warnings, ...leftSideBearing.warnings)
				if (!advanceWidth.ok) errors.push(...advanceWidth.errors)
				if (!leftSideBearing.ok) errors.push(...leftSideBearing.errors)

				const contours: PointSource[][] = []
				const flattenedPoints: PointSource[] = []
				const seenPointIds = new Set<PointId>()
				for (const contourId of contourIds ?? []) {
					const pointIds = get(contourPointIdsAtoms, [glyphId, contourId])
					const closed = get(contourClosedAtoms, [glyphId, contourId])
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
								`$.glyphs[${glyphId}].contours[${contourId}]`,
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
						const start = get(layerNodeSelectors, [masterId, glyphId, pointId])
						const end = get(layerNodeSelectors, [masterId, glyphId, endPointId])
						const plan = get(curveSegmentPlanSelectors, [
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
				if (errors.length > 0 || !advanceWidth.ok || !leftSideBearing.ok) {
					return projectionFailure(errors, warnings)
				}
				return projectionSuccess(
					{
						masterId,
						glyphId,
						contours,
						flattenedPoints,
						advanceWidth: advanceWidth.value,
						leftSideBearing: leftSideBearing.value,
						xMin: xMinOf(flattenedPoints),
					},
					warnings,
				)
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
								"topology.incompatible",
								`$.glyphs[${glyphId}].layers[${layer.masterId}]`,
								"Every master layer must use the shared point topology.",
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
			const ids = get(exportedGlyphIdsSelector)
			if (!ids.ok) return ids
			return resultWithWarnings(
				collectProjectionResults(
					ids.value.map((glyphId) => get(glyphSourceSelectors, glyphId)),
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
			const globalContourIds = new Set<ContourId>()
			const globalPointIds = new Set<PointId>()
			for (const glyphId of glyphIds) {
				const contourIds = get(glyphContourIdsAtoms, glyphId)
				const layerMasterIds = get(glyphLayerMasterIdsAtoms, glyphId)
				if (contourIds === null) {
					errors.push(
						projectionError(
							"topology.missing",
							`$.glyphs[${glyphId}].contours`,
							"Glyph contour index is missing.",
							glyphId,
						),
					)
				} else {
					errors.push(
						...duplicateValueErrors(
							contourIds,
							`$.glyphs[${glyphId}].contourIds`,
							"topology.duplicate_contour",
						),
					)
					for (const contourId of contourIds) {
						if (globalContourIds.has(contourId)) {
							errors.push(
								projectionError(
									"topology.duplicate_contour",
									`$.glyphs[${glyphId}].contours[${contourId}]`,
									"Contour IDs must be unique across the editor document.",
									contourId,
								),
							)
						} else globalContourIds.add(contourId)
						const pointIds = get(contourPointIdsAtoms, [glyphId, contourId])
						const closed = get(contourClosedAtoms, [glyphId, contourId])
						if (pointIds === null || closed === null) {
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
						errors.push(
							...duplicateValueErrors(
								pointIds,
								`$.glyphs[${glyphId}].contours[${contourId}].pointIds`,
								"topology.duplicate_point",
							),
						)
						for (const pointId of pointIds) {
							if (globalPointIds.has(pointId)) {
								errors.push(
									projectionError(
										"topology.duplicate_point",
										`$.glyphs[${glyphId}].points[${pointId}]`,
										"Point IDs must be unique across the editor document.",
										pointId,
									),
								)
							} else globalPointIds.add(pointId)
							if (get(pointAtoms, [glyphId, pointId]) === null) {
								errors.push(
									projectionError(
										"topology.missing",
										`$.glyphs[${glyphId}].points[${pointId}]`,
										"Point topology state is missing.",
										pointId,
									),
								)
							}
						}
					}
				}
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
				}
			}
			return errors.length > 0
				? projectionFailure(errors)
				: projectionSuccess(true)
		},
	})

	const fontSourceSelector = silo.selector<
		ProjectionResult<VariableFontSource>
	>({
		key: "fontSource",
		get: ({ get }) => {
			const structure = get(editorStructureSelector)
			const metadata = get(metadataSourceSelector)
			const names = get(namesSourceSelector)
			const metrics = get(metricsSourceSelector)
			const style = get(styleSourceSelector)
			const axes = get(axesSourceSelector)
			const instances = get(instancesSourceSelector)
			const glyphs = get(glyphsSourceSelector)
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
				},
				warnings,
			)
		},
	})

	const fontCompilationSelector = silo.selector<FontCompilation>({
		key: "fontCompilation",
		get: ({ get }) => {
			const projected = get(fontSourceSelector)
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
			return deepFreeze({
				ok: true,
				stage: "compiled",
				source: projected.value,
				font: ingested.value,
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
				const contourIds = get(glyphContourIdsAtoms, glyphId)
				const layerMasterIds = get(glyphLayerMasterIdsAtoms, glyphId)
				if (
					glyph === null ||
					glyphEditor === null ||
					contourIds === null ||
					layerMasterIds === null
				) {
					return null
				}
				const contours: EditorGlyphSource["contours"][number][] = []
				const orderedPointIds: PointId[] = []
				for (const contourId of contourIds) {
					const pointIds = get(contourPointIdsAtoms, [glyphId, contourId])
					const closed = get(contourClosedAtoms, [glyphId, contourId])
					if (pointIds === null || closed === null) return null
					const points: EditorGlyphSource["contours"][number]["points"][number][] =
						[]
					for (const pointId of pointIds) {
						const point = get(pointAtoms, [glyphId, pointId])
						if (point === null) return null
						orderedPointIds.push(pointId)
						points.push({ id: pointId, mode: point.mode })
					}
					contours.push({ id: contourId, closed, points })
				}
				const layers: EditorGlyphSource["layers"][number][] = []
				for (const masterId of layerMasterIds) {
					const points: EditorGlyphSource["layers"][number]["points"][number][] =
						[]
					for (const pointId of orderedPointIds) {
						const position = get(pointPositionAtoms, [
							masterId,
							glyphId,
							pointId,
						])
						if (position === null) continue
						const incomingX = get(incomingHandleXAtoms, [
							masterId,
							glyphId,
							pointId,
						])
						const incomingY = get(incomingHandleYAtoms, [
							masterId,
							glyphId,
							pointId,
						])
						const outgoingX = get(outgoingHandleXAtoms, [
							masterId,
							glyphId,
							pointId,
						])
						const outgoingY = get(outgoingHandleYAtoms, [
							masterId,
							glyphId,
							pointId,
						])
						if ((incomingX === null) !== (incomingY === null)) return null
						if ((outgoingX === null) !== (outgoingY === null)) return null
						const projected = get(layerNodeSelectors, [
							masterId,
							glyphId,
							pointId,
						])
						if (!projected.ok) return null
						const { incoming, outgoing } = projected.value
						points.push({
							pointId,
							x: projected.value.x,
							y: projected.value.y,
							...(incoming === undefined ? {} : { incoming }),
							...(outgoing === undefined ? {} : { outgoing }),
						})
					}
					const advanceWidth = get(advanceWidthAtoms, [masterId, glyphId])
					const leftSideBearing = get(leftSideBearingAtoms, [masterId, glyphId])
					if (advanceWidth === null || leftSideBearing === null) return null
					layers.push({ masterId, advanceWidth, leftSideBearing, points })
				}
				return deepFreeze({
					id: glyphId,
					name: glyph.name,
					export: glyph.export,
					...(glyphEditor.note.length === 0 ? {} : { note: glyphEditor.note }),
					...(glyphEditor.color === null ? {} : { color: glyphEditor.color }),
					...(glyph.overlap ? { overlap: true } : {}),
					contours,
					layers,
				})
			},
	})

	const editorSourceSelector = silo.selector<EditorFontSource | null>({
		key: "editorSource",
		get: ({ get }) => {
			if (!get(editorStructureSelector).ok) return null
			const metadata = get(metadataAtom)
			const names = get(namesAtom)
			const metrics = get(metricsAtom)
			const style = get(styleAtom)
			const defaultMasterId = get(defaultMasterIdAtom)
			if (
				metadata === null ||
				names === null ||
				metrics === null ||
				style === null ||
				defaultMasterId === null
			)
				return null

			const axes = get(editorAxesSourceSelector)
			const masters = get(editorMastersSourceSelector)
			const instances = get(editorInstancesSourceSelector)
			if (axes === null || masters === null || instances === null) return null

			const glyphs: EditorGlyphSource[] = []
			for (const glyphId of get(glyphIdsAtom)) {
				const glyph = get(editorGlyphSourceSelectors, glyphId)
				if (glyph === null) return null
				glyphs.push(glyph)
			}

			const cmap: EditorCmapEntrySource[] = []
			for (const codePoint of get(cmapCodePointsAtom)) {
				const glyphId = get(cmapGlyphAtoms, codePoint)
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
			})
		},
	})

	const replaceFontTransaction = silo.transaction<
		(source: EditorFontSource) => void
	>({
		key: "replaceFont",
		do: ({ get, set }, source) => {
			validateEditorSourceStructure(source)

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
				const contourIds = get(glyphContourIdsAtoms, glyphId) ?? []
				const layerMasterIds = get(glyphLayerMasterIdsAtoms, glyphId) ?? []
				const pointIds: PointId[] = []
				for (const contourId of contourIds) {
					const contourPoints =
						get(contourPointIdsAtoms, [glyphId, contourId]) ?? []
					pointIds.push(...contourPoints)
					for (const pointId of contourPoints) {
						set(pointAtoms, [glyphId, pointId], null)
					}
					set(contourPointIdsAtoms, [glyphId, contourId], null)
					set(contourClosedAtoms, [glyphId, contourId], null)
				}
				for (const masterId of layerMasterIds) {
					set(advanceWidthAtoms, [masterId, glyphId], null)
					set(leftSideBearingAtoms, [masterId, glyphId], null)
					for (const pointId of pointIds) {
						set(pointPositionAtoms, [masterId, glyphId, pointId], null)
						set(incomingHandleXAtoms, [masterId, glyphId, pointId], null)
						set(incomingHandleYAtoms, [masterId, glyphId, pointId], null)
						set(outgoingHandleXAtoms, [masterId, glyphId, pointId], null)
						set(outgoingHandleYAtoms, [masterId, glyphId, pointId], null)
					}
				}
				set(glyphAtoms, glyphId, null)
				set(glyphEditorAtoms, glyphId, null)
				set(glyphContourIdsAtoms, glyphId, null)
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
					}),
				)
				set(
					glyphContourIdsAtoms,
					glyph.id,
					deepFreeze(glyph.contours.map((contour) => contour.id)),
				)
				for (const contour of glyph.contours) {
					set(contourClosedAtoms, [glyph.id, contour.id], contour.closed)
					set(
						contourPointIdsAtoms,
						[glyph.id, contour.id],
						deepFreeze(contour.points.map((point) => point.id)),
					)
					for (const point of contour.points) {
						set(
							pointAtoms,
							[glyph.id, point.id],
							deepFreeze({ mode: point.mode }),
						)
					}
				}
				set(
					glyphLayerMasterIdsAtoms,
					glyph.id,
					deepFreeze(glyph.layers.map((layer) => layer.masterId)),
				)
				const glyphPointIds = glyph.contours.flatMap((contour) =>
					contour.points.map((point) => point.id),
				)
				for (const layer of glyph.layers) {
					set(advanceWidthAtoms, [layer.masterId, glyph.id], layer.advanceWidth)
					set(
						leftSideBearingAtoms,
						[layer.masterId, glyph.id],
						layer.leftSideBearing,
					)
					const coordinates = new Map(
						layer.points.map((point) => [point.pointId, point] as const),
					)
					for (const pointId of glyphPointIds) {
						const point = coordinates.get(pointId)
						set(
							pointPositionAtoms,
							[layer.masterId, glyph.id, pointId],
							point === undefined
								? null
								: deepFreeze({ x: point.x, y: point.y }),
						)
						set(
							incomingHandleXAtoms,
							[layer.masterId, glyph.id, pointId],
							point?.incoming?.x ?? null,
						)
						set(
							incomingHandleYAtoms,
							[layer.masterId, glyph.id, pointId],
							point?.incoming?.y ?? null,
						)
						set(
							outgoingHandleXAtoms,
							[layer.masterId, glyph.id, pointId],
							point?.outgoing?.x ?? null,
						)
						set(
							outgoingHandleYAtoms,
							[layer.masterId, glyph.id, pointId],
							point?.outgoing?.y ?? null,
						)
					}
				}
			}
			for (const entry of source.cmap) {
				set(cmapGlyphAtoms, entry.codePoint, entry.glyphId)
			}
		},
	})

	const movePointsTransaction = silo.transaction<
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
				if (get(pointAtoms, [input.glyphId, point.pointId]) === null) {
					throw new TypeError(
						`Unknown point ${point.pointId} in glyph ${input.glyphId}.`,
					)
				}
				if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
					throw new TypeError("Point coordinates must be finite numbers.")
				}
			}
			for (const point of input.points) {
				set(
					pointPositionAtoms,
					[input.masterId, input.glyphId, point.pointId],
					deepFreeze({ x: point.x, y: point.y }),
				)
			}
		},
	})

	const setHorizontalMetricsTransaction = silo.transaction<
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
			if (input.advanceWidth !== undefined) {
				if (
					!Number.isInteger(input.advanceWidth) ||
					input.advanceWidth < 0 ||
					input.advanceWidth > MAX_UINT16
				) {
					throw new TypeError(
						"Advance width must be an integer from 0 through 65535.",
					)
				}
				set(
					advanceWidthAtoms,
					[input.masterId, input.glyphId],
					input.advanceWidth,
				)
			}
			if (input.leftSideBearing !== undefined) {
				if (
					!Number.isInteger(input.leftSideBearing) ||
					input.leftSideBearing < MIN_INT16 ||
					input.leftSideBearing > MAX_INT16
				) {
					throw new TypeError(
						"Left side bearing must be an integer from -32768 through 32767.",
					)
				}
				set(
					leftSideBearingAtoms,
					[input.masterId, input.glyphId],
					input.leftSideBearing,
				)
			}
		},
	})

	const moveHandleTransaction = silo.transaction<
		(input: MoveHandleInput) => void
	>({
		key: "moveHandle",
		do: ({ get, set }, input) => {
			const layerMasterIds = get(glyphLayerMasterIdsAtoms, input.glyphId)
			const point = get(pointAtoms, [input.glyphId, input.pointId])
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

			if (input.vector === null) {
				set(selectedX, atomKey, null)
				set(selectedY, atomKey, null)
				set(
					pointAtoms,
					[input.glyphId, input.pointId],
					deepFreeze({ mode: "hard" }),
				)
				return
			}

			set(selectedX, atomKey, input.vector.x)
			set(selectedY, atomKey, input.vector.y)
			if (point.mode === "hard") return

			const oldOppositeX = get(oppositeX, atomKey)
			const oldOppositeY = get(oppositeY, atomKey)
			if ((oldOppositeX === null) !== (oldOppositeY === null)) {
				throw new TypeError("The opposite soft-node handle is incomplete.")
			}
			if (oldOppositeX === null || oldOppositeY === null) return
			const movedLength = Math.hypot(input.vector.x, input.vector.y)
			const oppositeLength = Math.hypot(oldOppositeX, oldOppositeY)
			if (movedLength === 0) {
				set(oppositeX, atomKey, oldOppositeX)
				set(oppositeY, atomKey, oldOppositeY)
				return
			}
			set(oppositeX, atomKey, (-input.vector.x / movedLength) * oppositeLength)
			set(oppositeY, atomKey, (-input.vector.y / movedLength) * oppositeLength)
		},
	})

	const transformControlsTransaction = silo.transaction<
		(input: TransformControlsInput) => void
	>({
		key: "transformControls",
		do: ({ get, set }, input) => {
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
				if (get(pointAtoms, [input.glyphId, pointId]) === null) {
					throw new TypeError(
						`Unknown point ${pointId} in glyph ${input.glyphId}.`,
					)
				}
				const atomKey: LayerPointKey = [input.masterId, input.glyphId, pointId]
				const position = get(pointPositionAtoms, atomKey)
				if (position === null) {
					throw new TypeError(`Point ${pointId} has incomplete coordinates.`)
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

			for (const point of input.points) {
				const atomKey: LayerPointKey = [
					input.masterId,
					input.glyphId,
					point.pointId,
				]
				set(pointPositionAtoms, atomKey, deepFreeze({ x: point.x, y: point.y }))
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
			for (const [pointId, selected] of selectedHandles) {
				const topology = get(pointAtoms, [input.glyphId, pointId])
				if (topology === null) continue
				const atomKey: LayerPointKey = [input.masterId, input.glyphId, pointId]
				const incomingX = get(incomingHandleXAtoms, atomKey)
				const incomingY = get(incomingHandleYAtoms, atomKey)
				const outgoingX = get(outgoingHandleXAtoms, atomKey)
				const outgoingY = get(outgoingHandleYAtoms, atomKey)
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
				if (incoming !== undefined) writeHandle(atomKey, "incoming", incoming)
				if (outgoing !== undefined) writeHandle(atomKey, "outgoing", outgoing)
			}
		},
	})

	const setNodeModeTransaction = silo.transaction<
		(input: SetNodeModeInput) => void
	>({
		key: "setNodeMode",
		do: ({ get, set }, input) => {
			const point = get(pointAtoms, [input.glyphId, input.pointId])
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
				const contourId = (get(glyphContourIdsAtoms, input.glyphId) ?? []).find(
					(candidate) =>
						(
							get(contourPointIdsAtoms, [input.glyphId, candidate]) ?? []
						).includes(input.pointId),
				)
				if (contourId === undefined) return
				const contourPointIds =
					get(contourPointIdsAtoms, [input.glyphId, contourId]) ?? []
				const closed =
					get(contourClosedAtoms, [input.glyphId, contourId]) ?? false
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
				for (const masterId of layerMasterIds) {
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
						const position = get(pointPositionAtoms, atomKey)
						const neighborPosition = get(pointPositionAtoms, [
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
						const position = get(pointPositionAtoms, atomKey)
						const neighborPosition = get(pointPositionAtoms, [
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
				[input.glyphId, input.pointId],
				deepFreeze({ mode: input.mode }),
			)
		},
	})

	const insertPointTransaction = silo.transaction<
		(input: InsertPointInput) => void
	>({
		key: "insertPoint",
		do: ({ get, set }, input) => {
			if (input.point.mode !== "soft" && input.point.mode !== "hard") {
				throw new TypeError('Node mode must be "soft" or "hard".')
			}
			const pointIds = get(contourPointIdsAtoms, [
				input.glyphId,
				input.contourId,
			])
			const layerMasterIds = get(glyphLayerMasterIdsAtoms, input.glyphId)
			if (pointIds === null || layerMasterIds === null) {
				throw new TypeError(
					`Unknown contour ${input.contourId} in glyph ${input.glyphId}.`,
				)
			}
			for (const glyphId of get(glyphIdsAtom)) {
				for (const contourId of get(glyphContourIdsAtoms, glyphId) ?? []) {
					if (
						(get(contourPointIdsAtoms, [glyphId, contourId]) ?? []).includes(
							input.point.id,
						)
					)
						throw new TypeError(`Point ID ${input.point.id} is already in use.`)
				}
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
				coordinateIds.size !== layerMasterIds.length ||
				layerMasterIds.some((masterId) => !coordinateIds.has(masterId))
			) {
				throw new TypeError(
					"A new point requires coordinates for every glyph layer.",
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
				[input.glyphId, input.contourId],
				deepFreeze([
					...pointIds.slice(0, at),
					input.point.id,
					...pointIds.slice(at),
				]),
			)
			set(
				pointAtoms,
				[input.glyphId, input.point.id],
				deepFreeze({ mode: input.point.mode }),
			)
			for (const coordinate of input.coordinates) {
				set(
					pointPositionAtoms,
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

	const addSegmentHandlesTransaction = silo.transaction<
		(input: AddSegmentHandlesInput) => boolean
	>({
		key: "addSegmentHandles",
		do: ({ get, set }, input) => {
			const pointIds = get(contourPointIdsAtoms, [
				input.glyphId,
				input.contourId,
			])
			const closed = get(contourClosedAtoms, [input.glyphId, input.contourId])
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
			const startTopology = get(pointAtoms, [input.glyphId, startPointId])
			const endTopology = get(pointAtoms, [input.glyphId, endPointId])
			if (startTopology === null || endTopology === null) return false

			const plans: {
				readonly masterId: MasterId
				readonly startOutgoing: Vector2
				readonly endIncoming: Vector2
			}[] = []
			let hardenStart = false
			let hardenEnd = false
			for (const masterId of layerMasterIds) {
				const startKey: LayerPointKey = [masterId, input.glyphId, startPointId]
				const endKey: LayerPointKey = [masterId, input.glyphId, endPointId]
				const start = get(pointPositionAtoms, startKey)
				const end = get(pointPositionAtoms, endKey)
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
					[input.glyphId, startPointId],
					deepFreeze({ mode: "hard" }),
				)
			}
			if (hardenEnd) {
				set(
					pointAtoms,
					[input.glyphId, endPointId],
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

	const splitSegmentTransaction = silo.transaction<
		(input: SplitSegmentInput) => void
	>({
		key: "splitSegment",
		do: ({ get, set }, input) => {
			const pointIds = get(contourPointIdsAtoms, [
				input.glyphId,
				input.contourId,
			])
			const closed = get(contourClosedAtoms, [input.glyphId, input.contourId])
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
			for (const glyphId of get(glyphIdsAtom)) {
				for (const contourId of get(glyphContourIdsAtoms, glyphId) ?? []) {
					if (
						(get(contourPointIdsAtoms, [glyphId, contourId]) ?? []).includes(
							input.pointId,
						)
					)
						throw new TypeError(`Point ID ${input.pointId} is already in use.`)
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
				readonly straight: boolean
				readonly startOutgoing?: Vector2
				readonly incoming?: Vector2
				readonly outgoing?: Vector2
				readonly endIncoming?: Vector2
			}[] = []
			for (const masterId of layerMasterIds) {
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
				[input.glyphId, input.contourId],
				deepFreeze([
					...pointIds.slice(0, input.segmentIndex + 1),
					input.pointId,
					...pointIds.slice(input.segmentIndex + 1),
				]),
			)
			set(
				pointAtoms,
				[input.glyphId, input.pointId],
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
					pointPositionAtoms,
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

	const reverseContourTransaction = silo.transaction<
		(input: ReverseContourInput) => void
	>({
		key: "reverseContour",
		do: ({ get, set }, input) => {
			const pointIds = get(contourPointIdsAtoms, [
				input.glyphId,
				input.contourId,
			])
			const closed = get(contourClosedAtoms, [input.glyphId, input.contourId])
			const masterIds = get(glyphLayerMasterIdsAtoms, input.glyphId)
			if (pointIds === null || closed === null || masterIds === null) {
				throw new TypeError(`Unknown contour ${input.contourId}.`)
			}
			if (!closed)
				throw new TypeError(
					"Only closed contours can preserve their first node when reversed.",
				)
			if (pointIds.length < 2) return
			const first = pointIds[0]
			if (first === undefined) return
			set(
				contourPointIdsAtoms,
				[input.glyphId, input.contourId],
				deepFreeze([first, ...pointIds.slice(1).reverse()]),
			)
			for (const masterId of masterIds) {
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

	const makeNodeFirstTransaction = silo.transaction<
		(input: MakeNodeFirstInput) => void
	>({
		key: "makeNodeFirst",
		do: ({ get, set }, input) => {
			const pointIds = get(contourPointIdsAtoms, [
				input.glyphId,
				input.contourId,
			])
			const closed = get(contourClosedAtoms, [input.glyphId, input.contourId])
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
				[input.glyphId, input.contourId],
				deepFreeze([...pointIds.slice(index), ...pointIds.slice(0, index)]),
			)
		},
	})

	const createContourTransaction = silo.transaction<
		(input: CreateContourInput) => void
	>({
		key: "createContour",
		do: ({ get, set }, input) => {
			const contourIds = get(glyphContourIdsAtoms, input.glyphId)
			const layerMasterIds = get(glyphLayerMasterIdsAtoms, input.glyphId)
			if (contourIds === null || layerMasterIds === null) {
				throw new TypeError(`Unknown glyph ${input.glyphId}.`)
			}
			for (const glyphId of get(glyphIdsAtom)) {
				for (const contourId of get(glyphContourIdsAtoms, glyphId) ?? []) {
					if (contourId === input.contourId) {
						throw new TypeError(
							`Contour ID ${input.contourId} is already in use.`,
						)
					}
					if (
						(get(contourPointIdsAtoms, [glyphId, contourId]) ?? []).includes(
							input.point.id,
						)
					) {
						throw new TypeError(`Point ID ${input.point.id} is already in use.`)
					}
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
				coordinateIds.size !== layerMasterIds.length ||
				layerMasterIds.some((masterId) => !coordinateIds.has(masterId))
			) {
				throw new TypeError(
					"A new contour point requires coordinates for every glyph layer.",
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
				input.glyphId,
				deepFreeze([...contourIds, input.contourId]),
			)
			set(
				contourPointIdsAtoms,
				[input.glyphId, input.contourId],
				deepFreeze([input.point.id]),
			)
			set(contourClosedAtoms, [input.glyphId, input.contourId], false)
			set(
				pointAtoms,
				[input.glyphId, input.point.id],
				deepFreeze({ mode: input.point.mode }),
			)
			for (const coordinate of input.coordinates) {
				const atomKey: LayerPointKey = [
					coordinate.masterId,
					input.glyphId,
					input.point.id,
				]
				set(
					pointPositionAtoms,
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

	const setContourClosedTransaction = silo.transaction<
		(input: SetContourClosedInput) => void
	>({
		key: "setContourClosed",
		do: ({ get, set }, input) => {
			const pointIds = get(contourPointIdsAtoms, [
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
			set(contourClosedAtoms, [input.glyphId, input.contourId], input.closed)
		},
	})

	const closeContourTransaction = silo.transaction<
		(input: CloseContourInput) => void
	>({
		key: "closeContour",
		do: ({ get, set }, input) => {
			const pointIds = get(contourPointIdsAtoms, [
				input.glyphId,
				input.contourId,
			])
			const closed = get(contourClosedAtoms, [input.glyphId, input.contourId])
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
				get(pointAtoms, [input.glyphId, firstPointId]) === null
			) {
				throw new TypeError("The contour's first point is missing.")
			}
			for (const masterId of layerMasterIds) {
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

			const replacement = input.firstPoint
			if (replacement !== undefined) {
				if (replacement.pointId !== firstPointId) {
					throw new TypeError(
						`Point ${replacement.pointId} is not the contour's first point.`,
					)
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
				if (
					coordinateIds.size !== layerMasterIds.length ||
					layerMasterIds.some((masterId) => !coordinateIds.has(masterId))
				) {
					throw new TypeError(
						"A replacement closure point requires handles for every glyph layer.",
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
					[input.glyphId, firstPointId],
					deepFreeze({ mode: replacement.mode }),
				)
				for (const coordinate of replacement.coordinates) {
					const atomKey: LayerPointKey = [
						coordinate.masterId,
						input.glyphId,
						firstPointId,
					]
					set(incomingHandleXAtoms, atomKey, coordinate.incoming.x)
					set(incomingHandleYAtoms, atomKey, coordinate.incoming.y)
					set(outgoingHandleXAtoms, atomKey, coordinate.outgoing.x)
					set(outgoingHandleYAtoms, atomKey, coordinate.outgoing.y)
				}
			}
			set(contourClosedAtoms, [input.glyphId, input.contourId], true)
		},
	})

	const pasteContoursTransaction = silo.transaction<
		(input: PasteContoursInput) => void
	>({
		key: "pasteContours",
		do: ({ get, set }, input) => {
			const contourIds = get(glyphContourIdsAtoms, input.glyphId)
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
			for (const glyphId of get(glyphIdsAtom)) {
				for (const contourId of get(glyphContourIdsAtoms, glyphId) ?? []) {
					occupiedContours.add(contourId)
					for (const pointId of get(contourPointIdsAtoms, [
						glyphId,
						contourId,
					]) ?? []) {
						occupiedPoints.add(pointId)
					}
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
				layersByMaster.size !== layerMasterIds.length ||
				layerMasterIds.some((masterId) => !layersByMaster.has(masterId))
			) {
				throw new TypeError(
					"Pasted outlines require coordinates for every destination glyph layer.",
				)
			}
			const pastedPointIdSet = new Set(pastedPointIds)
			for (const layer of input.layers) {
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
				input.glyphId,
				deepFreeze([...contourIds, ...pastedContourIds]),
			)
			for (const contour of input.contours) {
				set(
					contourPointIdsAtoms,
					[input.glyphId, contour.id],
					deepFreeze(contour.points.map((point) => point.id)),
				)
				set(contourClosedAtoms, [input.glyphId, contour.id], contour.closed)
				for (const point of contour.points) {
					set(
						pointAtoms,
						[input.glyphId, point.id],
						deepFreeze({ mode: point.mode }),
					)
				}
			}
			for (const layer of input.layers) {
				for (const point of layer.points) {
					const atomKey: LayerPointKey = [
						layer.masterId,
						input.glyphId,
						point.pointId,
					]
					set(
						pointPositionAtoms,
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

	const deleteSelectionTransaction = silo.transaction<
		(input: DeleteSelectionInput) => void
	>({
		key: "deleteSelection",
		do: ({ get, set }, input) => {
			const contourIds = get(glyphContourIdsAtoms, input.glyphId)
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
				if (get(pointAtoms, [input.glyphId, pointId]) === null) {
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
				if (get(pointAtoms, [input.glyphId, selection.pointId]) === null) {
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
					[input.glyphId, selection.pointId],
					deepFreeze({ mode: "hard" }),
				)
			}

			if (deleted.size === 0 && breakHandles.length === 0) return
			const nextContourIds: ContourId[] = []
			const knownContourIds = new Set(contourIds)
			for (const contourId of contourIds) {
				const pointIds = get(contourPointIdsAtoms, [input.glyphId, contourId])
				const closed = get(contourClosedAtoms, [input.glyphId, contourId])
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
					set(contourPointIdsAtoms, [input.glyphId, contourId], null)
					set(contourClosedAtoms, [input.glyphId, contourId], null)
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
						[input.glyphId, nextContourId],
						deepFreeze([...run]),
					)
					set(
						contourClosedAtoms,
						[input.glyphId, nextContourId],
						input.breakPaths ? false : closed,
					)
					if (!input.breakPaths) continue
					const lastPointId = run.at(-1)
					if (lastPointId === undefined) continue
					for (const masterId of layerMasterIds) {
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
						[input.glyphId, firstPointId],
						deepFreeze({ mode: "hard" }),
					)
					set(
						pointAtoms,
						[input.glyphId, lastPointId],
						deepFreeze({ mode: "hard" }),
					)
				}
			}
			set(glyphContourIdsAtoms, input.glyphId, deepFreeze(nextContourIds))
			for (const pointId of deleted) {
				set(pointAtoms, [input.glyphId, pointId], null)
				for (const masterId of layerMasterIds) {
					const atomKey: LayerPointKey = [masterId, input.glyphId, pointId]
					set(pointPositionAtoms, atomKey, null)
					set(incomingHandleXAtoms, atomKey, null)
					set(incomingHandleYAtoms, atomKey, null)
					set(outgoingHandleXAtoms, atomKey, null)
					set(outgoingHandleYAtoms, atomKey, null)
				}
			}
		},
	})

	const runReplaceFont = silo.runTransaction(replaceFontTransaction)
	const runMovePoints = silo.runTransaction(movePointsTransaction)
	const runSetHorizontalMetrics = silo.runTransaction(
		setHorizontalMetricsTransaction,
	)
	const runMoveHandle = silo.runTransaction(moveHandleTransaction)
	const runTransformControls = silo.runTransaction(transformControlsTransaction)
	const runSetNodeMode = silo.runTransaction(setNodeModeTransaction)
	const runInsertPoint = silo.runTransaction(insertPointTransaction)
	const runAddSegmentHandles = silo.runTransaction(addSegmentHandlesTransaction)
	const runSplitSegment = silo.runTransaction(splitSegmentTransaction)
	const runReverseContour = silo.runTransaction(reverseContourTransaction)
	const runMakeNodeFirst = silo.runTransaction(makeNodeFirstTransaction)
	const runCreateContour = silo.runTransaction(createContourTransaction)
	const runSetContourClosed = silo.runTransaction(setContourClosedTransaction)
	const runCloseContour = silo.runTransaction(closeContourTransaction)
	const runPasteContours = silo.runTransaction(pasteContoursTransaction)
	const runDeleteSelection = silo.runTransaction(deleteSelectionTransaction)

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
			advanceWidth: advanceWidthAtoms,
			leftSideBearing: leftSideBearingAtoms,
			pointPosition: pointPositionAtoms,
			incomingHandleX: incomingHandleXAtoms,
			incomingHandleY: incomingHandleYAtoms,
			outgoingHandleX: outgoingHandleXAtoms,
			outgoingHandleY: outgoingHandleYAtoms,
			cmapGlyph: cmapGlyphAtoms,
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
			curveSegmentPlan: curveSegmentPlanSelectors,
			glyphLayer: glyphLayerSelectors,
			glyphVariations: glyphVariationSelectors,
			glyphSource: glyphSourceSelectors,
			exportedGlyphIds: exportedGlyphIdsSelector,
			glyphsSource: glyphsSourceSelector,
			cmapEntry: cmapEntrySelectors,
			cmapSource: cmapSourceSelector,
			metadataSource: metadataSourceSelector,
			namesSource: namesSourceSelector,
			metricsSource: metricsSourceSelector,
			styleSource: styleSourceSelector,
			fontSource: fontSourceSelector,
			compilation: fontCompilationSelector,
		},
		transactions: {
			replaceFont: replaceFontTransaction,
			movePoints: movePointsTransaction,
			setHorizontalMetrics: setHorizontalMetricsTransaction,
			moveHandle: moveHandleTransaction,
			transformControls: transformControlsTransaction,
			setNodeMode: setNodeModeTransaction,
			insertPoint: insertPointTransaction,
			addSegmentHandles: addSegmentHandlesTransaction,
			splitSegment: splitSegmentTransaction,
			reverseContour: reverseContourTransaction,
			makeNodeFirst: makeNodeFirstTransaction,
			createContour: createContourTransaction,
			setContourClosed: setContourClosedTransaction,
			closeContour: closeContourTransaction,
			pasteContours: pasteContoursTransaction,
			deleteSelection: deleteSelectionTransaction,
		},
		glyphHistoryTimelines,
		actions: {
			markDocumentChanged,
			load(source: EditorFontSource): void {
				const previousGlyphIds = silo.getState(glyphIdsAtom)
				runReplaceFont(source)
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
				markDocumentChanged()
			},
			movePoints(input: MovePointsInput): void {
				runMovePoints(input)
				markDocumentChanged()
			},
			setHorizontalMetrics(input: SetHorizontalMetricsInput): void {
				runSetHorizontalMetrics(input)
				markDocumentChanged()
			},
			moveHandle(input: MoveHandleInput): void {
				runMoveHandle(input)
				markDocumentChanged()
			},
			transformControls(input: TransformControlsInput): void {
				runTransformControls(input)
				markDocumentChanged()
			},
			setNodeMode(input: SetNodeModeInput): void {
				runSetNodeMode(input)
				markDocumentChanged()
			},
			insertPoint(input: InsertPointInput): void {
				runInsertPoint(input)
				markDocumentChanged()
			},
			addSegmentHandles(input: AddSegmentHandlesInput): boolean {
				const changed = runAddSegmentHandles(input)
				if (changed) markDocumentChanged()
				return changed
			},
			splitSegment(input: SplitSegmentInput): void {
				runSplitSegment(input)
				markDocumentChanged()
			},
			reverseContour(input: ReverseContourInput): void {
				runReverseContour(input)
				markDocumentChanged()
			},
			makeNodeFirst(input: MakeNodeFirstInput): void {
				runMakeNodeFirst(input)
				markDocumentChanged()
			},
			createContour(input: CreateContourInput): void {
				runCreateContour(input)
				markDocumentChanged()
			},
			setContourClosed(input: SetContourClosedInput): void {
				runSetContourClosed(input)
				markDocumentChanged()
			},
			closeContour(input: CloseContourInput): void {
				runCloseContour(input)
				markDocumentChanged()
			},
			pasteContours(input: PasteContoursInput): void {
				runPasteContours(input)
				markDocumentChanged()
			},
			deleteSelection(input: DeleteSelectionInput): void {
				runDeleteSelection(input)
				markDocumentChanged()
			},
		},
		read: {
			editorSource: (): EditorFontSource | null =>
				silo.getState(editorSourceSelector),
			glyphLayer: (masterId: MasterId, glyphId: GlyphId) =>
				silo.getState(glyphLayerSelectors, [masterId, glyphId]),
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
