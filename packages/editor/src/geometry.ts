import {
	normalizeEditorLocation,
	regionScalar,
	type EditorAxisSource,
	type GlyphId,
	type PointId,
} from "@trigraph/states"

export interface OutlinePoint {
	readonly id?: PointId
	readonly x: number
	readonly y: number
	readonly onCurve: boolean
}

export interface ResolvedGlyph {
	readonly glyphId: GlyphId
	readonly name: string
	readonly advanceWidth: number
	readonly leftSideBearing: number
	readonly contours: readonly (readonly OutlinePoint[])[]
}

export interface VariableGlyphLike {
	readonly name: string
	readonly advanceWidth: number
	readonly leftSideBearing: number
	readonly contours: readonly (readonly {
		readonly x: number
		readonly y: number
		readonly onCurve: boolean
	}[])[]
	readonly variations: readonly {
		readonly region: Parameters<typeof regionScalar>[0]
		readonly deltas: {
			readonly points: readonly {
				readonly x: number
				readonly y: number
			}[]
			readonly phantom: {
				readonly left: number
				readonly right: number
			}
		}
	}[]
}

const format = (value: number): string =>
	Number.isInteger(value) ? String(value) : value.toFixed(3)

const midpoint = (a: OutlinePoint, b: OutlinePoint): OutlinePoint => ({
	x: (a.x + b.x) / 2,
	y: (a.y + b.y) / 2,
	onCurve: true,
})

/** Converts a closed TrueType quadratic contour into SVG path commands. */
export function contourToPath(contour: readonly OutlinePoint[]): string {
	if (contour.length === 0) return ""
	const expanded: OutlinePoint[] = []
	for (let index = 0; index < contour.length; index += 1) {
		const point = contour[index]
		const next = contour[(index + 1) % contour.length]
		if (point === undefined || next === undefined) continue
		expanded.push(point)
		if (!point.onCurve && !next.onCurve) expanded.push(midpoint(point, next))
	}
	const startIndex = expanded.findIndex((point) => point.onCurve)
	if (startIndex === -1) return ""
	const ordered = [
		...expanded.slice(startIndex),
		...expanded.slice(0, startIndex),
	]
	const start = ordered[0]
	if (start === undefined) return ""
	const commands = [`M ${format(start.x)} ${format(start.y)}`]
	for (let index = 1; index <= ordered.length; index += 1) {
		const point = ordered[index % ordered.length]
		if (point === undefined) continue
		if (point.onCurve) {
			commands.push(`L ${format(point.x)} ${format(point.y)}`)
			continue
		}
		const end = ordered[(index + 1) % ordered.length]
		if (end === undefined) continue
		commands.push(
			`Q ${format(point.x)} ${format(point.y)} ${format(end.x)} ${format(end.y)}`,
		)
		index += 1
	}
	commands.push("Z")
	return commands.join(" ")
}

export function contoursToPath(
	contours: readonly (readonly OutlinePoint[])[],
): string {
	return contours.map(contourToPath).filter(Boolean).join(" ")
}

/** Evaluates solved gvar tuples at a user-space editor location. */
export function resolveVariableGlyph(
	glyphId: GlyphId,
	glyph: VariableGlyphLike,
	axes: readonly EditorAxisSource[],
	location: Readonly<Record<string, number>>,
): ResolvedGlyph | null {
	const normalized = normalizeEditorLocation(axes, location)
	if (!normalized.ok) return null
	const scalars = glyph.variations.map((variation) =>
		regionScalar(variation.region, normalized.value),
	)
	let pointIndex = 0
	const contours = glyph.contours.map((contour) =>
		contour.map((point) => {
			let x = point.x
			let y = point.y
			for (
				let variationIndex = 0;
				variationIndex < scalars.length;
				variationIndex += 1
			) {
				const delta =
					glyph.variations[variationIndex]?.deltas.points[pointIndex]
				const scalar = scalars[variationIndex] ?? 0
				if (delta !== undefined) {
					x += delta.x * scalar
					y += delta.y * scalar
				}
			}
			pointIndex += 1
			return { ...point, x, y }
		}),
	)
	let leftDelta = 0
	let rightDelta = 0
	for (let index = 0; index < scalars.length; index += 1) {
		const phantom = glyph.variations[index]?.deltas.phantom
		const scalar = scalars[index] ?? 0
		if (phantom !== undefined) {
			leftDelta += phantom.left * scalar
			rightDelta += phantom.right * scalar
		}
	}
	const minimumX = (
		outlines: readonly (readonly { readonly x: number }[])[],
	): number => {
		const values = outlines.flatMap((contour) =>
			contour.map((point) => point.x),
		)
		return values.length === 0 ? 0 : Math.min(...values)
	}
	const baseXMin = minimumX(glyph.contours)
	const resolvedXMin = minimumX(contours)
	return {
		glyphId,
		name: glyph.name,
		advanceWidth: glyph.advanceWidth + rightDelta - leftDelta,
		leftSideBearing:
			resolvedXMin - (baseXMin - glyph.leftSideBearing + leftDelta),
		contours,
	}
}
