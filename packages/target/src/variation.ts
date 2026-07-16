import {
	type Diagnostic,
	type F2Dot14,
	type GlyphId,
	type LocationResult,
	type MasterDeltaResult,
	type NonEmptyReadonlyArray,
	type NormalizedLocation,
	type PointSource,
	type SimpleGlyph,
	type VariableFont,
	type VariationRegion,
} from "./model.ts"
import { assertVariableFontValidated } from "./proof.ts"

const MIN_INT16 = -32_768
const MAX_INT16 = 32_767
const MIN_GLYPH_COORDINATE = -16_384
const MAX_GLYPH_COORDINATE = 16_383
const FIXED_ONE = 65_536
const F2_DOT_14_ONE = 16_384

const own = (value: object, key: string): boolean =>
	Object.prototype.hasOwnProperty.call(value, key)

function diagnostic(
	code: Diagnostic["code"],
	path: string,
	message: string,
	table: string,
): Diagnostic {
	return { severity: "error", code, path, message, table }
}

function sortDiagnostics(diagnostics: Diagnostic[]): readonly Diagnostic[] {
	const compare = (left: string, right: string): number =>
		left < right ? -1 : left > right ? 1 : 0
	return diagnostics.sort(
		(left, right) =>
			compare(left.path, right.path) ||
			compare(left.code, right.code) ||
			compare(left.message, right.message),
	)
}

function asNonEmptyDiagnostics(
	diagnostics: readonly Diagnostic[],
): NonEmptyReadonlyArray<Diagnostic> {
	const first = diagnostics[0]
	if (first === undefined) {
		throw new Error("Expected at least one variation diagnostic.")
	}
	return [first, ...diagnostics.slice(1)]
}

function deepFreeze<Value>(value: Value): Value {
	if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
		return value
	}
	for (const child of Object.values(value)) {
		deepFreeze(child)
	}
	return Object.freeze(value)
}

function clamp(value: number, minimum: number, maximum: number): number {
	return Math.min(maximum, Math.max(minimum, value))
}

function quantizeFixed16Dot16(value: number): number {
	return Math.floor(value * FIXED_ONE + 0.5) / FIXED_ONE
}

function fixed16Dot16ToF2Dot14(value: number): F2Dot14 {
	const fixedRaw = Math.floor(value * FIXED_ONE + 0.5)
	const f2Dot14Raw = (fixedRaw + 2) >> 2
	return (clamp(f2Dot14Raw, -F2_DOT_14_ONE, F2_DOT_14_ONE) /
		F2_DOT_14_ONE) as F2Dot14
}

function applyAxisMap(
	coordinate: number,
	map: NonNullable<VariableFont["axes"][number]["map"]>,
): number {
	if (map.length === 0) return coordinate

	const first = map[0]
	if (first === undefined) return coordinate
	if (coordinate <= first.from) return Number(first.to)

	for (let index = 1; index < map.length; index += 1) {
		const start = map[index - 1]
		const end = map[index]
		if (start === undefined || end === undefined) continue
		if (coordinate === end.from) return Number(end.to)
		if (coordinate < end.from) {
			const ratio = (coordinate - start.from) / (end.from - start.from)
			return Number(start.to) + ratio * (end.to - start.to)
		}
	}

	return Number(map[map.length - 1]?.to ?? coordinate)
}

/**
 * Converts user-space coordinates to normalized coordinates in `font.axes`
 * order. Missing axes use their fvar defaults; supplied values are clamped to
 * each fvar range before the optional avar mapping is applied.
 */
export function normalizeLocation(
	font: VariableFont,
	coordinates: Readonly<Record<string, number>>,
): LocationResult {
	assertVariableFontValidated(font)
	const errors: Diagnostic[] = []
	if (
		typeof coordinates !== "object" ||
		coordinates === null ||
		Array.isArray(coordinates)
	) {
		errors.push(
			diagnostic(
				"scalar.type",
				"$.coordinates",
				"Expected a coordinate record.",
				"fvar",
			),
		)
		return deepFreeze({
			ok: false,
			errors: asNonEmptyDiagnostics(errors),
		})
	}

	const axisTags = new Set(font.axes.map((axis) => axis.tag as string))
	for (const key of Object.keys(coordinates).sort()) {
		if (!axisTags.has(key)) {
			errors.push(
				diagnostic(
					"instance.coordinate",
					`$.coordinates.${key}`,
					`Coordinate for unknown axis ${JSON.stringify(key)}.`,
					"fvar",
				),
			)
		}
	}

	const normalized = font.axes.map((axis) => {
		const tag = axis.tag as string
		const supplied = own(coordinates, tag)
			? coordinates[tag]
			: Number(axis.default)
		if (typeof supplied !== "number" || !Number.isFinite(supplied)) {
			errors.push(
				diagnostic(
					"instance.coordinate",
					`$.coordinates.${tag}`,
					`Coordinate for axis ${JSON.stringify(tag)} must be finite.`,
					"fvar",
				),
			)
			return 0
		}

		const minimum = Number(axis.min)
		const defaultValue = Number(axis.default)
		const maximum = Number(axis.max)
		const userValue = quantizeFixed16Dot16(clamp(supplied, minimum, maximum))
		let value = 0
		if (userValue < defaultValue) {
			value = -(defaultValue - userValue) / (defaultValue - minimum)
		} else if (userValue > defaultValue) {
			value = (userValue - defaultValue) / (maximum - defaultValue)
		}
		value = quantizeFixed16Dot16(clamp(value, -1, 1))
		if (axis.map !== null) {
			value = quantizeFixed16Dot16(applyAxisMap(value, axis.map))
		}
		return fixed16Dot16ToF2Dot14(clamp(value, -1, 1))
	})

	if (errors.length > 0) {
		return deepFreeze({
			ok: false,
			errors: asNonEmptyDiagnostics(sortDiagnostics(errors)),
		})
	}
	return deepFreeze({
		ok: true,
		value: normalized as unknown as NormalizedLocation,
	})
}

/** Calculates the OpenType tuple-variation support scalar for a location. */
export function regionScalar(
	region: VariationRegion,
	normalizedCoordinates: NormalizedLocation,
): number {
	let scalar = 1
	for (let index = 0; index < region.peak.length; index += 1) {
		const peak = Number(region.peak[index] ?? 0)
		const coordinate = normalizedCoordinates[index] ?? 0
		if (!Number.isFinite(coordinate)) return 0

		let start: number
		let end: number
		if (region.kind === "intermediate") {
			start = Number(region.start[index] ?? 0)
			end = Number(region.end[index] ?? 0)
		} else if (peak < 0) {
			start = peak
			end = 0
		} else {
			start = 0
			end = peak
		}

		// OpenType specifies that malformed or deliberately neutral supports are
		// ignored for this axis rather than making the entire tuple inapplicable.
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

export interface InstantiatedPoint {
	readonly x: number
	readonly y: number
	readonly onCurve: boolean
}

export interface InstantiatedPhantomDeltas {
	readonly left: number
	readonly right: number
	readonly top: number
	readonly bottom: number
}

export interface InstantiatedSimpleGlyph {
	readonly kind: "simple"
	readonly glyphId: GlyphId
	readonly name: SimpleGlyph["name"]
	readonly normalizedLocation: NormalizedLocation
	readonly contours: readonly (readonly InstantiatedPoint[])[]
	readonly phantomDeltas: InstantiatedPhantomDeltas
	readonly leftSideBearing: number
	readonly advanceWidth: number
	readonly overlap: boolean
}

function getMinimumX(points: readonly { readonly x: number }[]): number {
	let minimum = 0
	let hasPoint = false
	for (const point of points) {
		minimum = hasPoint ? Math.min(minimum, point.x) : point.x
		hasPoint = true
	}
	return minimum
}

/** Evaluates a validated simple glyph at a user-space variation location. */
export function instantiateGlyph(
	font: VariableFont,
	glyphId: GlyphId,
	coordinates: Readonly<Record<string, number>>,
): InstantiatedSimpleGlyph {
	assertVariableFontValidated(font)
	if (
		!Number.isInteger(glyphId) ||
		glyphId < 0 ||
		glyphId >= font.glyphs.length
	) {
		throw new RangeError(
			`Glyph ID ${glyphId} is outside the font's glyph range.`,
		)
	}
	const glyph = font.glyphs[glyphId]
	if (glyph === undefined) {
		throw new RangeError(
			`Glyph ID ${glyphId} is outside the font's glyph range.`,
		)
	}
	const location = normalizeLocation(font, coordinates)
	if (!location.ok) {
		throw new TypeError("Cannot instantiate a glyph at an invalid location.", {
			cause: location.errors,
		})
	}

	const scalars = glyph.variations.map((variation) =>
		regionScalar(variation.region, location.value),
	)
	let pointIndex = 0
	const contours = glyph.contours.map((contour) =>
		contour.map((point): InstantiatedPoint => {
			let x = Number(point.x)
			let y = Number(point.y)
			for (
				let variationIndex = 0;
				variationIndex < glyph.variations.length;
				variationIndex += 1
			) {
				const variation = glyph.variations[variationIndex]
				const scalar = scalars[variationIndex] ?? 0
				const delta = variation?.deltas.points[pointIndex]
				if (delta !== undefined && scalar !== 0) {
					x += Number(delta.x) * scalar
					y += Number(delta.y) * scalar
				}
			}
			pointIndex += 1
			return { x, y, onCurve: point.onCurve }
		}),
	)

	let left = 0
	let right = 0
	let top = 0
	let bottom = 0
	for (let index = 0; index < glyph.variations.length; index += 1) {
		const variation = glyph.variations[index]
		const scalar = scalars[index] ?? 0
		if (variation === undefined || scalar === 0) continue
		left += Number(variation.deltas.phantom.left) * scalar
		right += Number(variation.deltas.phantom.right) * scalar
		top += Number(variation.deltas.phantom.top) * scalar
		bottom += Number(variation.deltas.phantom.bottom) * scalar
	}

	const basePoints = glyph.contours.flat()
	const instantiatedPoints = contours.flat()
	const baseXMin = getMinimumX(basePoints)
	const xMin = getMinimumX(instantiatedPoints)
	const originalLeftPhantom = baseXMin - Number(glyph.leftSideBearing)
	const leftSideBearing = xMin - (originalLeftPhantom + left)
	const advanceWidth = Number(glyph.advanceWidth) + right - left

	return deepFreeze({
		kind: "simple",
		glyphId,
		name: glyph.name,
		normalizedLocation: location.value,
		contours,
		phantomDeltas: { left, right, top, bottom },
		leftSideBearing,
		advanceWidth,
		overlap: glyph.overlap,
	})
}

interface ParsedPoint {
	readonly x: number
	readonly y: number
	readonly onCurve: boolean
}

function parseMasterPoint(
	value: PointSource | undefined,
	path: string,
	errors: Diagnostic[],
): ParsedPoint {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		errors.push(
			diagnostic(
				"scalar.type",
				path,
				"Expected a TrueType point object.",
				"glyf",
			),
		)
		return { x: 0, y: 0, onCurve: false }
	}

	const parseCoordinate = (
		coordinate: unknown,
		coordinatePath: string,
	): number => {
		if (typeof coordinate !== "number" || !Number.isFinite(coordinate)) {
			errors.push(
				diagnostic(
					"scalar.type",
					coordinatePath,
					"Expected a finite point coordinate.",
					"glyf",
				),
			)
			return 0
		}
		if (!Number.isInteger(coordinate)) {
			errors.push(
				diagnostic(
					"scalar.integer",
					coordinatePath,
					"TrueType source coordinates must be integers.",
					"glyf",
				),
			)
			return 0
		}
		if (
			coordinate < MIN_GLYPH_COORDINATE ||
			coordinate > MAX_GLYPH_COORDINATE
		) {
			errors.push(
				diagnostic(
					"glyph.coordinate",
					coordinatePath,
					"TrueType source coordinates must be within the grid [-16384, 16383].",
					"glyf",
				),
			)
			return 0
		}
		return coordinate
	}

	let onCurve = false
	if (typeof value.onCurve !== "boolean") {
		errors.push(
			diagnostic(
				"scalar.boolean",
				`${path}.onCurve`,
				"Expected a boolean onCurve flag.",
				"glyf",
			),
		)
	} else {
		onCurve = value.onCurve
	}
	return {
		x: parseCoordinate(value.x, `${path}.x`),
		y: parseCoordinate(value.y, `${path}.y`),
		onCurve,
	}
}

/**
 * Derives full, flattened gvar point deltas from two topology-compatible
 * simple-glyph masters.
 */
export function deriveSimpleGlyphDeltas(
	defaultContours: readonly (readonly PointSource[])[],
	masterContours: readonly (readonly PointSource[])[],
): MasterDeltaResult {
	const errors: Diagnostic[] = []
	if (!Array.isArray(defaultContours) || !Array.isArray(masterContours)) {
		errors.push(
			diagnostic(
				"scalar.type",
				"$",
				"Expected arrays of simple-glyph contours.",
				"glyf",
			),
		)
		return deepFreeze({
			ok: false,
			errors: asNonEmptyDiagnostics(errors),
		})
	}
	if (defaultContours.length !== masterContours.length) {
		errors.push(
			diagnostic(
				"glyph.contour_count",
				"$.masterContours",
				`Master contour count ${masterContours.length} does not match the default contour count ${defaultContours.length}.`,
				"gvar",
			),
		)
	}

	const deltas: { x: number; y: number }[] = []
	const contourCount = Math.max(defaultContours.length, masterContours.length)
	for (let contourIndex = 0; contourIndex < contourCount; contourIndex += 1) {
		const defaultContour = defaultContours[contourIndex]
		const masterContour = masterContours[contourIndex]
		if (!Array.isArray(defaultContour) || !Array.isArray(masterContour))
			continue
		if (defaultContour.length !== masterContour.length) {
			errors.push(
				diagnostic(
					"glyph.point_count",
					`$.masterContours[${contourIndex}]`,
					`Master point count ${masterContour.length} does not match the default point count ${defaultContour.length}.`,
					"gvar",
				),
			)
		}
		const pointCount = Math.min(defaultContour.length, masterContour.length)
		for (let pointIndex = 0; pointIndex < pointCount; pointIndex += 1) {
			const defaultSource = defaultContour[pointIndex]
			const masterSource = masterContour[pointIndex]
			const defaultPoint = parseMasterPoint(
				defaultSource,
				`$.defaultContours[${contourIndex}][${pointIndex}]`,
				errors,
			)
			const masterPoint = parseMasterPoint(
				masterSource,
				`$.masterContours[${contourIndex}][${pointIndex}]`,
				errors,
			)
			if (defaultSource === undefined || masterSource === undefined) continue
			if (defaultPoint.onCurve !== masterPoint.onCurve) {
				errors.push(
					diagnostic(
						"glyph.glyf_delta",
						`$.masterContours[${contourIndex}][${pointIndex}].onCurve`,
						"Master and default onCurve flags must match at every point.",
						"gvar",
					),
				)
			}
			const x = masterPoint.x - defaultPoint.x
			const y = masterPoint.y - defaultPoint.y
			if (x < MIN_INT16 || x > MAX_INT16) {
				errors.push(
					diagnostic(
						"glyph.glyf_delta",
						`$.masterContours[${contourIndex}][${pointIndex}].x`,
						"Derived X delta must fit a signed 16-bit gvar value.",
						"gvar",
					),
				)
			}
			if (y < MIN_INT16 || y > MAX_INT16) {
				errors.push(
					diagnostic(
						"glyph.glyf_delta",
						`$.masterContours[${contourIndex}][${pointIndex}].y`,
						"Derived Y delta must fit a signed 16-bit gvar value.",
						"gvar",
					),
				)
			}
			deltas.push({ x, y })
		}
	}

	if (errors.length > 0) {
		return deepFreeze({
			ok: false,
			errors: asNonEmptyDiagnostics(sortDiagnostics(errors)),
		})
	}
	return deepFreeze({ ok: true, value: deltas })
}
