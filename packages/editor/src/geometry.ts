import {
	normalizeEditorLocation,
	regionScalar,
	type EditorAxisSource,
	type EditorHandleVectorSource,
	type GlyphId,
	type PointId,
} from "@trigraph/states"

export interface OutlinePoint {
	readonly id?: PointId
	readonly x: number
	readonly y: number
	readonly onCurve: boolean
}

export interface ContourStartDirection {
	readonly angle: number
	readonly x: number
	readonly y: number
}

export interface EditorOutlineNode {
	readonly x: number
	readonly y: number
	readonly incoming?: EditorHandleVectorSource
	readonly outgoing?: EditorHandleVectorSource
}

export interface UnitVector {
	readonly x: number
	readonly y: number
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

/** Locates the first node and the first non-zero tangent in contour order. */
export function contourStartDirection(
	contour: readonly EditorOutlineNode[],
): ContourStartDirection | null {
	const first = contour[0]
	if (first === undefined) return null
	if (
		first.outgoing !== undefined &&
		(first.outgoing.x !== 0 || first.outgoing.y !== 0)
	) {
		return {
			x: first.x,
			y: first.y,
			angle: (Math.atan2(first.outgoing.y, first.outgoing.x) * 180) / Math.PI,
		}
	}
	for (let index = 1; index < contour.length; index += 1) {
		const next = contour[index]
		if (next === undefined) continue
		const deltaX = next.x - first.x
		const deltaY = next.y - first.y
		if (deltaX === 0 && deltaY === 0) continue
		return {
			x: first.x,
			y: first.y,
			angle: (Math.atan2(deltaY, deltaX) * 180) / Math.PI,
		}
	}
	return null
}

/** Returns the unit normal at either endpoint of an open editor contour. */
export function contourEndpointNormal(
	contour: readonly EditorOutlineNode[],
	pointIndex: number,
	closed: boolean,
): UnitVector | null {
	if (
		closed ||
		contour.length < 2 ||
		(pointIndex !== 0 && pointIndex !== contour.length - 1)
	) {
		return null
	}
	const point = contour[pointIndex]
	const adjacent = contour[pointIndex === 0 ? 1 : pointIndex - 1]
	if (point === undefined || adjacent === undefined) return null
	const candidates =
		pointIndex === 0
			? [
					point.outgoing,
					{
						x: adjacent.x + (adjacent.incoming?.x ?? 0) - point.x,
						y: adjacent.y + (adjacent.incoming?.y ?? 0) - point.y,
					},
					{ x: adjacent.x - point.x, y: adjacent.y - point.y },
				]
			: [
					point.incoming,
					{
						x: adjacent.x + (adjacent.outgoing?.x ?? 0) - point.x,
						y: adjacent.y + (adjacent.outgoing?.y ?? 0) - point.y,
					},
					{ x: adjacent.x - point.x, y: adjacent.y - point.y },
				]
	const tangent = candidates.find(
		(candidate) =>
			candidate !== undefined && (candidate.x !== 0 || candidate.y !== 0),
	)
	if (tangent === undefined) return null
	const length = Math.hypot(tangent.x, tangent.y)
	const normalX = -tangent.y / length
	const normalY = tangent.x / length
	return {
		x: Object.is(normalX, -0) ? 0 : normalX,
		y: Object.is(normalY, -0) ? 0 : normalY,
	}
}

/** Writes an editor contour using node-owned cubic handles. */
export function editorContourToPath(
	contour: readonly EditorOutlineNode[],
	closed = true,
): string {
	const start = contour[0]
	if (start === undefined) return ""
	const commands = [`M ${format(start.x)} ${format(start.y)}`]
	const segmentCount = Math.max(0, contour.length - (closed ? 0 : 1))
	for (let index = 0; index < segmentCount; index += 1) {
		const from = contour[index]
		const to = contour[(index + 1) % contour.length]
		if (from === undefined || to === undefined) continue
		if (from.outgoing === undefined && to.incoming === undefined) {
			commands.push(`L ${format(to.x)} ${format(to.y)}`)
			continue
		}
		const firstControl = {
			x: from.x + (from.outgoing?.x ?? 0),
			y: from.y + (from.outgoing?.y ?? 0),
		}
		const secondControl = {
			x: to.x + (to.incoming?.x ?? 0),
			y: to.y + (to.incoming?.y ?? 0),
		}
		commands.push(
			`C ${format(firstControl.x)} ${format(firstControl.y)} ${format(secondControl.x)} ${format(secondControl.y)} ${format(to.x)} ${format(to.y)}`,
		)
	}
	if (closed) commands.push("Z")
	return commands.join(" ")
}

export function editorContoursToPath(
	contours: readonly (
		| readonly EditorOutlineNode[]
		| { readonly closed: boolean; readonly nodes: readonly EditorOutlineNode[] }
	)[],
): string {
	return contours
		.map((contour) =>
			"nodes" in contour
				? editorContourToPath(contour.nodes, contour.closed)
				: editorContourToPath(contour),
		)
		.filter(Boolean)
		.join(" ")
}

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
