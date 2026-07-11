import type { VariationRegionSource } from "trigraph"

import type {
	EditorAxisSource,
	ProjectionIssue,
	ProjectionResult,
} from "./types.ts"
import { deepFreeze } from "./projection.ts"

const FIXED_ONE = 65_536
const F2_DOT_14_ONE = 16_384
const MIN_FIXED_16_DOT_16 = -32_768
const MAX_FIXED_16_DOT_16 = 32_767 + 65_535 / FIXED_ONE
const MIN_VARIATION_DELTA = -32_768
const MAX_VARIATION_DELTA = 32_767
const MATRIX_PIVOT_EPSILON = 1e-12
const INTEGER_SOLUTION_EPSILON = 1e-8

export type AxisIdLocation = Readonly<Record<string, number>>
export type NormalizedTagLocation = Readonly<Record<string, number>>
export type ScalarMatrix = readonly (readonly number[])[]

export interface MasterScalarMatrix {
	readonly size: number
	/** Rows are master locations; columns are tuple-variation regions. */
	readonly matrix: ScalarMatrix
	/** The inverse of `matrix`, used to turn raw master deltas into tuples. */
	readonly inverse: ScalarMatrix
}

type ProjectionError = Extract<ProjectionIssue, { readonly severity: "error" }>

export function projectionSuccess<Value>(
	value: Value,
): ProjectionResult<Value> {
	return deepFreeze({ ok: true, value: deepFreeze(value), warnings: [] })
}

export function projectionFailure<Value = never>(
	first: ProjectionError,
	...rest: ProjectionError[]
): ProjectionResult<Value> {
	return deepFreeze({ ok: false, errors: [first, ...rest], warnings: [] })
}

function issue(
	code: string,
	path: string,
	message: string,
	entityId?: EditorAxisSource["id"],
): ProjectionError {
	return entityId === undefined
		? { severity: "error", code, path, message }
		: { severity: "error", code, path, message, entityId }
}

function failureFrom<Value>(
	errors: readonly ProjectionError[],
): ProjectionResult<Value> {
	const first = errors[0]
	if (first === undefined) {
		throw new Error("Expected at least one projection issue.")
	}
	return projectionFailure(first, ...errors.slice(1))
}

function clamp(value: number, minimum: number, maximum: number): number {
	return Math.min(maximum, Math.max(minimum, value))
}

/**
 * Rounds to the nearest OpenType Fixed16.16 value, resolving exact halves
 * toward positive infinity. Inputs outside the Fixed domain are not clamped;
 * callers projecting editor data should diagnose those before quantization.
 */
export function quantizeFixed16Dot16(value: number): number {
	return Math.floor(value * FIXED_ONE + 0.5) / FIXED_ONE
}

/**
 * Quantizes a normalized value through Fixed16.16 to F2Dot14. The two-step
 * conversion mirrors the lowering boundary and avoids a second interpretation
 * of half-way negative values. Normalized output is clamped to [-1, 1].
 */
export function quantizeF2Dot14(value: number): number {
	const fixedRaw = Math.floor(value * FIXED_ONE + 0.5)
	const f2Dot14Raw = Math.floor((fixedRaw + 2) / 4)
	return clamp(f2Dot14Raw, -F2_DOT_14_ONE, F2_DOT_14_ONE) / F2_DOT_14_ONE
}

function validateAxis(
	axis: EditorAxisSource,
	path: string,
): readonly ProjectionError[] {
	const errors: ProjectionError[] = []
	const values = [axis.min, axis.default, axis.max]
	const labels = ["min", "default", "max"] as const

	for (let index = 0; index < values.length; index += 1) {
		const value = values[index]
		const label = labels[index]
		if (
			typeof value !== "number" ||
			!Number.isFinite(value) ||
			value < MIN_FIXED_16_DOT_16 ||
			value > MAX_FIXED_16_DOT_16
		) {
			errors.push(
				issue(
					"variation.axis.invalid",
					`${path}.${label}`,
					`Axis ${label} must be a finite signed Fixed16.16 value.`,
					axis.id,
				),
			)
		}
	}

	if (errors.length === 0) {
		const minimum = quantizeFixed16Dot16(axis.min)
		const defaultValue = quantizeFixed16Dot16(axis.default)
		const maximum = quantizeFixed16Dot16(axis.max)
		if (
			!(minimum < maximum && minimum <= defaultValue && defaultValue <= maximum)
		) {
			errors.push(
				issue(
					"variation.axis.invalid",
					path,
					"Axis values must remain min <= default <= max with min < max after Fixed16.16 quantization.",
					axis.id,
				),
			)
		}
	}

	if (axis.map === undefined) return errors
	if (axis.map.length < 3) {
		errors.push(
			issue(
				"variation.axis.invalid",
				`${path}.map`,
				"An explicit avar map must contain at least the -1, 0, and 1 anchors.",
				axis.id,
			),
		)
		return errors
	}

	let previousFrom = -Infinity
	let previousTo = -Infinity
	for (let index = 0; index < axis.map.length; index += 1) {
		const entry = axis.map[index]
		if (entry === undefined) continue
		const entryPath = `${path}.map[${index}]`
		if (
			!Number.isFinite(entry.from) ||
			!Number.isFinite(entry.to) ||
			entry.from < -1 ||
			entry.from > 1 ||
			entry.to < -1 ||
			entry.to > 1
		) {
			errors.push(
				issue(
					"variation.axis.invalid",
					entryPath,
					"avar coordinates must be finite normalized values in [-1, 1].",
					axis.id,
				),
			)
			continue
		}

		const from = quantizeF2Dot14(entry.from)
		const to = quantizeF2Dot14(entry.to)
		if (from <= previousFrom) {
			errors.push(
				issue(
					"variation.axis.invalid",
					`${entryPath}.from`,
					"avar input coordinates must remain strictly increasing after F2Dot14 quantization.",
					axis.id,
				),
			)
		}
		if (to < previousTo) {
			errors.push(
				issue(
					"variation.axis.invalid",
					`${entryPath}.to`,
					"avar output coordinates must remain nondecreasing after F2Dot14 quantization.",
					axis.id,
				),
			)
		}
		previousFrom = from
		previousTo = to
	}

	const anchors = new Map<number, number>()
	for (const entry of axis.map) {
		anchors.set(quantizeF2Dot14(entry.from), quantizeF2Dot14(entry.to))
	}
	for (const anchor of [-1, 0, 1]) {
		if (anchors.get(anchor) !== anchor) {
			errors.push(
				issue(
					"variation.axis.invalid",
					`${path}.map`,
					`The avar map must preserve the ${anchor} anchor.`,
					axis.id,
				),
			)
		}
	}

	return errors
}

function applyAxisMap(
	coordinate: number,
	map: NonNullable<EditorAxisSource["map"]>,
): number {
	const first = map[0]
	if (first === undefined) return coordinate
	const firstFrom = quantizeF2Dot14(first.from)
	if (coordinate <= firstFrom) {
		return quantizeFixed16Dot16(quantizeF2Dot14(first.to))
	}

	for (let index = 1; index < map.length; index += 1) {
		const start = map[index - 1]
		const end = map[index]
		if (start === undefined || end === undefined) continue
		const startFrom = quantizeF2Dot14(start.from)
		const endFrom = quantizeF2Dot14(end.from)
		if (coordinate === endFrom) {
			return quantizeFixed16Dot16(quantizeF2Dot14(end.to))
		}
		if (coordinate < endFrom) {
			const ratio = (coordinate - startFrom) / (endFrom - startFrom)
			const mapped =
				quantizeF2Dot14(start.to) +
				ratio * (quantizeF2Dot14(end.to) - quantizeF2Dot14(start.to))
			return quantizeFixed16Dot16(mapped)
		}
	}

	return quantizeFixed16Dot16(
		map[map.length - 1] === undefined
			? coordinate
			: quantizeF2Dot14(map[map.length - 1]?.to ?? coordinate),
	)
}

/** Normalizes one in-range editor coordinate and applies the axis avar map. */
export function normalizeAxisCoordinate(
	axis: EditorAxisSource,
	coordinate: number,
	path = "$.axis",
): ProjectionResult<number> {
	const errors = [...validateAxis(axis, path)]
	if (!Number.isFinite(coordinate)) {
		errors.push(
			issue(
				"variation.location.invalid",
				`${path}.coordinate`,
				"The editor coordinate must be finite.",
				axis.id,
			),
		)
		return failureFrom(errors)
	}

	if (errors.length > 0) return failureFrom(errors)
	const minimum = quantizeFixed16Dot16(axis.min)
	const defaultValue = quantizeFixed16Dot16(axis.default)
	const maximum = quantizeFixed16Dot16(axis.max)
	const value = quantizeFixed16Dot16(coordinate)
	if (value < minimum || value > maximum) {
		return projectionFailure(
			issue(
				"variation.location.range",
				`${path}.coordinate`,
				`The editor coordinate ${coordinate} is outside [${axis.min}, ${axis.max}].`,
				axis.id,
			),
		)
	}

	let normalized = 0
	if (value < defaultValue) {
		normalized = -(defaultValue - value) / (defaultValue - minimum)
	} else if (value > defaultValue) {
		normalized = (value - defaultValue) / (maximum - defaultValue)
	}
	normalized = quantizeFixed16Dot16(normalized)
	if (axis.map !== undefined) {
		normalized = applyAxisMap(normalized, axis.map)
	}
	return projectionSuccess(quantizeF2Dot14(normalized))
}

/**
 * Converts a complete, axis-ID-keyed editor location into an exact
 * F2Dot14, OpenType-tag-keyed location. The result is only constructed after
 * identity, range, and axis validation succeeds.
 */
export function normalizeEditorLocation(
	axes: readonly EditorAxisSource[],
	coordinates: AxisIdLocation,
	path = "$.location",
): ProjectionResult<NormalizedTagLocation> {
	const errors: ProjectionError[] = []
	const ids = new Map<string, number>()
	const tags = new Map<string, number>()

	for (let index = 0; index < axes.length; index += 1) {
		const axis = axes[index]
		if (axis === undefined) continue
		const axisPath = `$.axes[${index}]`
		const previousId = ids.get(axis.id)
		if (previousId !== undefined) {
			errors.push(
				issue(
					"variation.axis.duplicate_id",
					`${axisPath}.id`,
					`Axis ID ${JSON.stringify(axis.id)} duplicates $.axes[${previousId}].id.`,
					axis.id,
				),
			)
		} else {
			ids.set(axis.id, index)
		}

		const previousTag = tags.get(axis.tag)
		if (previousTag !== undefined) {
			errors.push(
				issue(
					"variation.axis.duplicate_tag",
					`${axisPath}.tag`,
					`Axis tag ${JSON.stringify(axis.tag)} duplicates $.axes[${previousTag}].tag.`,
					axis.id,
				),
			)
		} else {
			tags.set(axis.tag, index)
		}

		if (!Object.hasOwn(coordinates, axis.id)) {
			errors.push(
				issue(
					"variation.location.missing",
					`${path}.${axis.id}`,
					`The location is missing coordinate for axis ${JSON.stringify(axis.id)}.`,
					axis.id,
				),
			)
		}
	}

	for (const id of Object.keys(coordinates).sort()) {
		if (!ids.has(id)) {
			errors.push(
				issue(
					"variation.location.unknown_axis",
					`${path}.${id}`,
					`The location contains unknown axis ID ${JSON.stringify(id)}.`,
				),
			)
		}
	}

	const normalizedValues: number[] = []
	for (let index = 0; index < axes.length; index += 1) {
		const axis = axes[index]
		if (axis === undefined || !Object.hasOwn(coordinates, axis.id)) continue
		const result = normalizeAxisCoordinate(
			axis,
			coordinates[axis.id] as number,
			`$.axes[${index}]`,
		)
		if (result.ok) {
			normalizedValues[index] = result.value
		} else {
			errors.push(...result.errors)
		}
	}

	if (errors.length > 0) return failureFrom(errors)

	const normalized: Record<string, number> = {}
	for (let index = 0; index < axes.length; index += 1) {
		const axis = axes[index]
		const value = normalizedValues[index]
		if (axis !== undefined && value !== undefined) normalized[axis.tag] = value
	}
	return projectionSuccess(Object.freeze(normalized))
}

/** Calculates the OpenType tuple support scalar for tag-keyed coordinates. */
export function regionScalar(
	region: VariationRegionSource,
	normalizedLocation: NormalizedTagLocation,
): number {
	let scalar = 1
	for (const tag of Object.keys(region.peak).sort()) {
		const peak = region.peak[tag] ?? 0
		const coordinate = normalizedLocation[tag] ?? 0
		if (!Number.isFinite(peak) || !Number.isFinite(coordinate)) return 0

		let start: number
		let end: number
		if ("start" in region && region.start !== undefined) {
			start = region.start[tag] ?? 0
			end = region.end[tag] ?? 0
		} else if (peak < 0) {
			start = peak
			end = 0
		} else {
			start = 0
			end = peak
		}

		// Per OpenType, malformed or neutral axis supports do not contribute.
		if (
			start > peak ||
			peak > end ||
			(start < 0 && end > 0 && peak !== 0) ||
			peak === 0
		) {
			continue
		}
		if (coordinate < start || coordinate > end) return 0
		if (coordinate === peak) continue

		const axisScalar =
			coordinate < peak
				? (coordinate - start) / (peak - start)
				: (end - coordinate) / (end - peak)
		scalar *= axisScalar
		if (scalar === 0) return 0
	}
	return clamp(scalar, 0, 1)
}

function freezeMatrix(matrix: number[][]): ScalarMatrix {
	return Object.freeze(matrix.map((row) => Object.freeze([...row])))
}

/** Inverts a finite square matrix with stable, deterministic pivot selection. */
export function invertScalarMatrix(
	matrix: ScalarMatrix,
	path = "$.scalarMatrix",
): ProjectionResult<ScalarMatrix> {
	const size = matrix.length
	const errors: ProjectionError[] = []
	for (let rowIndex = 0; rowIndex < size; rowIndex += 1) {
		const row = matrix[rowIndex]
		if (row === undefined || row.length !== size) {
			errors.push(
				issue(
					"variation.matrix.shape",
					`${path}[${rowIndex}]`,
					`Expected ${size} scalar values in matrix row ${rowIndex}.`,
				),
			)
			continue
		}
		for (let columnIndex = 0; columnIndex < size; columnIndex += 1) {
			if (!Number.isFinite(row[columnIndex])) {
				errors.push(
					issue(
						"variation.matrix.shape",
						`${path}[${rowIndex}][${columnIndex}]`,
						"Scalar-matrix entries must be finite.",
					),
				)
			}
		}
	}
	if (errors.length > 0) return failureFrom(errors)
	if (size === 0) return projectionSuccess(Object.freeze([]))

	const augmented = matrix.map((row, rowIndex) => [
		...row,
		...Array.from({ length: size }, (_, columnIndex) =>
			rowIndex === columnIndex ? 1 : 0,
		),
	])

	for (let columnIndex = 0; columnIndex < size; columnIndex += 1) {
		let pivotRow = columnIndex
		let pivotMagnitude = Math.abs(augmented[columnIndex]?.[columnIndex] ?? 0)
		for (let rowIndex = columnIndex + 1; rowIndex < size; rowIndex += 1) {
			const magnitude = Math.abs(augmented[rowIndex]?.[columnIndex] ?? 0)
			if (magnitude > pivotMagnitude) {
				pivotMagnitude = magnitude
				pivotRow = rowIndex
			}
		}

		if (pivotMagnitude <= MATRIX_PIVOT_EPSILON) {
			return projectionFailure(
				issue(
					"variation.matrix.singular",
					`${path}[${columnIndex}]`,
					`Nondefault masters do not form an independent variation basis at column ${columnIndex}.`,
				),
			)
		}

		if (pivotRow !== columnIndex) {
			const temporary = augmented[columnIndex]
			augmented[columnIndex] = augmented[pivotRow] as number[]
			augmented[pivotRow] = temporary as number[]
		}

		const pivot = augmented[columnIndex]?.[columnIndex] as number
		const pivotData = augmented[columnIndex] as number[]
		for (let index = 0; index < size * 2; index += 1) {
			pivotData[index] = (pivotData[index] as number) / pivot
		}

		for (let rowIndex = 0; rowIndex < size; rowIndex += 1) {
			if (rowIndex === columnIndex) continue
			const row = augmented[rowIndex] as number[]
			const factor = row[columnIndex] as number
			if (factor === 0) continue
			for (let index = 0; index < size * 2; index += 1) {
				row[index] =
					(row[index] as number) - factor * (pivotData[index] as number)
			}
		}
	}

	return projectionSuccess(
		freezeMatrix(augmented.map((row) => row.slice(size))),
	)
}

/**
 * Builds A where A[master][tuple] is that tuple's support scalar at the
 * nondefault master, then computes its inverse for delta solving.
 */
export function buildMasterScalarMatrix(
	normalizedMasterLocations: readonly NormalizedTagLocation[],
	regions: readonly VariationRegionSource[],
	path = "$.masters",
): ProjectionResult<MasterScalarMatrix> {
	if (normalizedMasterLocations.length !== regions.length) {
		return projectionFailure(
			issue(
				"variation.matrix.shape",
				path,
				`Expected one tuple region for each of ${normalizedMasterLocations.length} nondefault masters; received ${regions.length}.`,
			),
		)
	}

	const matrix = freezeMatrix(
		normalizedMasterLocations.map((location) =>
			regions.map((region) => regionScalar(region, location)),
		),
	)
	const inverse = invertScalarMatrix(matrix, `${path}.scalarMatrix`)
	if (!inverse.ok) return inverse
	return projectionSuccess(
		Object.freeze({
			size: matrix.length,
			matrix,
			inverse: inverse.value,
		}),
	)
}

/** Solves one A * delta = raw vector and enforces the gvar int16 domain. */
export function solveMasterDeltaVector(
	scalarMatrix: MasterScalarMatrix,
	rawVector: readonly number[],
	path = "$.delta",
): ProjectionResult<readonly number[]> {
	if (rawVector.length !== scalarMatrix.size) {
		return projectionFailure(
			issue(
				"variation.delta.count",
				path,
				`Expected ${scalarMatrix.size} raw master values; received ${rawVector.length}.`,
			),
		)
	}

	const solved: number[] = []
	const errors: ProjectionError[] = []
	for (let rowIndex = 0; rowIndex < scalarMatrix.size; rowIndex += 1) {
		const inverseRow = scalarMatrix.inverse[rowIndex]
		if (inverseRow === undefined || inverseRow.length !== scalarMatrix.size) {
			return projectionFailure(
				issue(
					"variation.matrix.shape",
					`$.scalarMatrix.inverse[${rowIndex}]`,
					"The cached inverse matrix does not match its declared size.",
				),
			)
		}

		let value = 0
		for (
			let columnIndex = 0;
			columnIndex < scalarMatrix.size;
			columnIndex += 1
		) {
			const raw = rawVector[columnIndex]
			if (!Number.isFinite(raw)) {
				errors.push(
					issue(
						"variation.delta.nonintegral",
						`${path}.raw[${columnIndex}]`,
						"Raw master deltas must be finite.",
					),
				)
				value = Number.NaN
				break
			}
			value += (inverseRow[columnIndex] as number) * (raw as number)
		}

		if (!Number.isFinite(value)) continue
		const integer = Math.round(value)
		const tolerance = INTEGER_SOLUTION_EPSILON * Math.max(1, Math.abs(value))
		if (Math.abs(value - integer) > tolerance) {
			errors.push(
				issue(
					"variation.delta.nonintegral",
					`${path}.solution[${rowIndex}]`,
					`Solved tuple delta ${value} is not an integer after variation decomposition.`,
				),
			)
			continue
		}
		if (integer < MIN_VARIATION_DELTA || integer > MAX_VARIATION_DELTA) {
			errors.push(
				issue(
					"variation.delta.range",
					`${path}.solution[${rowIndex}]`,
					`Solved tuple delta ${integer} is outside the signed 16-bit gvar range.`,
				),
			)
			continue
		}
		solved[rowIndex] = integer
	}

	if (errors.length > 0) return failureFrom(errors)
	return projectionSuccess(Object.freeze(solved))
}

/**
 * Solves independent raw vectors (for example each point x/y and phantom
 * coordinate) against the same nondefault-master basis.
 */
export function solveMasterDeltaVectors(
	scalarMatrix: MasterScalarMatrix,
	rawVectors: readonly (readonly number[])[],
	path = "$.deltas",
): ProjectionResult<readonly (readonly number[])[]> {
	const solved: (readonly number[])[] = []
	const errors: ProjectionError[] = []
	for (let index = 0; index < rawVectors.length; index += 1) {
		const result = solveMasterDeltaVector(
			scalarMatrix,
			rawVectors[index] ?? [],
			`${path}[${index}]`,
		)
		if (result.ok) solved[index] = result.value
		else errors.push(...result.errors)
	}
	if (errors.length > 0) return failureFrom(errors)
	return projectionSuccess(Object.freeze(solved))
}
