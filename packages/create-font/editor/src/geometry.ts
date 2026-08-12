import {
	lowerCornerProfiles,
	lowerInferredCorners,
} from "@create-art/vector-geometry"
import {
	evaluateCubicCurve,
	normalizeEditorLocation,
	regionScalar,
	type CubicCurve,
	type EditorAxisSource,
	type EditorHandleVectorSource,
	type GlyphId,
	type PointId,
} from "@create-font/states"

export interface OutlinePoint {
	readonly id?: PointId
	readonly x: number
	readonly y: number
	readonly onCurve: boolean
}

export interface NearestEditorSegment {
	readonly segmentIndex: number
	readonly amount: number
	readonly x: number
	readonly y: number
	readonly distance: number
}

export interface CombinedPathPreview {
	/** Nonzero-fill path data for closed contours only. */
	readonly path: string
	readonly fillRule: "nonzero"
	readonly sourceContourCount: number
	readonly nonDestructive: true
}

export interface EditorContourPaintPaths {
	/** Closed contours, suitable for fill and outline painting. */
	readonly closedPath: string
	/** Open contours, suitable for stroke-only painting. */
	readonly openPath: string
	/** Inferred authored overextensions for an editor-only guide. */
	readonly overflowPath: string
}

export interface ContourStartDirection {
	readonly angle: number
	readonly x: number
	readonly y: number
}

export interface EditorOutlineNode {
	readonly pointId?: PointId
	readonly x: number
	readonly y: number
	readonly incoming?: EditorHandleVectorSource
	readonly outgoing?: EditorHandleVectorSource
	readonly corner?: Readonly<{
		readonly profile: "circular" | "squircle"
		readonly amount: number
	}>
}

export interface UnitVector {
	readonly x: number
	readonly y: number
}

export function editorSegmentCubic(
	contour: readonly EditorOutlineNode[],
	segmentIndex: number,
	closed: boolean,
): CubicCurve | null {
	const segmentCount = Math.max(0, contour.length - (closed ? 0 : 1))
	if (
		!Number.isInteger(segmentIndex) ||
		segmentIndex < 0 ||
		segmentIndex >= segmentCount
	)
		return null
	const from = contour[segmentIndex]
	const to = contour[(segmentIndex + 1) % contour.length]
	if (from === undefined || to === undefined) return null
	return {
		p0: { x: from.x, y: from.y },
		c1: {
			x: from.x + (from.outgoing?.x ?? 0),
			y: from.y + (from.outgoing?.y ?? 0),
		},
		c2: {
			x: to.x + (to.incoming?.x ?? 0),
			y: to.y + (to.incoming?.y ?? 0),
		},
		p3: { x: to.x, y: to.y },
	}
}

function squaredDistance(
	left: Readonly<{ x: number; y: number }>,
	right: Readonly<{ x: number; y: number }>,
): number {
	return (left.x - right.x) ** 2 + (left.y - right.y) ** 2
}

function nearestAmountOnCubic(
	cubic: CubicCurve,
	pointer: Readonly<{ x: number; y: number }>,
): number {
	const samples = 64
	let bestIndex = 0
	let bestDistance = Number.POSITIVE_INFINITY
	for (let index = 0; index <= samples; index += 1) {
		const distance = squaredDistance(
			evaluateCubicCurve(cubic, index / samples),
			pointer,
		)
		if (distance < bestDistance) {
			bestIndex = index
			bestDistance = distance
		}
	}
	let low = Math.max(0, (bestIndex - 1) / samples)
	let high = Math.min(1, (bestIndex + 1) / samples)
	for (let iteration = 0; iteration < 28; iteration += 1) {
		const first = low + (high - low) / 3
		const second = high - (high - low) / 3
		if (
			squaredDistance(evaluateCubicCurve(cubic, first), pointer) <=
			squaredDistance(evaluateCubicCurve(cubic, second), pointer)
		) {
			high = second
		} else {
			low = first
		}
	}
	return (low + high) / 2
}

/** Finds the nearest authored line/cubic segment in font units. */
export function nearestEditorSegment(
	contour: readonly EditorOutlineNode[],
	closed: boolean,
	pointer: Readonly<{ x: number; y: number }>,
): NearestEditorSegment | null {
	const segmentCount = Math.max(0, contour.length - (closed ? 0 : 1))
	let nearest: NearestEditorSegment | null = null
	for (let segmentIndex = 0; segmentIndex < segmentCount; segmentIndex += 1) {
		const cubic = editorSegmentCubic(contour, segmentIndex, closed)
		if (cubic === null) continue
		const from = contour[segmentIndex]
		const to = contour[(segmentIndex + 1) % contour.length]
		if (from === undefined || to === undefined) continue
		let amount: number
		const straight = from.outgoing === undefined && to.incoming === undefined
		if (straight) {
			const dx = to.x - from.x
			const dy = to.y - from.y
			const denominator = dx * dx + dy * dy
			amount =
				denominator === 0
					? 0
					: Math.max(
							0,
							Math.min(
								1,
								((pointer.x - from.x) * dx + (pointer.y - from.y) * dy) /
									denominator,
							),
						)
		} else {
			amount = nearestAmountOnCubic(cubic, pointer)
		}
		const point = straight
			? {
					x: from.x + (to.x - from.x) * amount,
					y: from.y + (to.y - from.y) * amount,
				}
			: evaluateCubicCurve(cubic, amount)
		const distance = Math.sqrt(squaredDistance(point, pointer))
		if (nearest === null || distance < nearest.distance) {
			nearest = { segmentIndex, amount, ...point, distance }
		}
	}
	return nearest
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

/** Resolves live-corner profiles into the exact nodes used for rendering. */
export function renderEditorContour(
	contour: readonly EditorOutlineNode[],
	closed = true,
): readonly EditorOutlineNode[] {
	return contour.some(({ corner }) => corner !== undefined)
		? lowerCornerProfiles({
				closed,
				points: contour.map((node, index) => ({
					id: node.pointId ?? `point:${index}`,
					point: { x: node.x, y: node.y },
					...(node.incoming === undefined
						? {}
						: {
								incoming: {
									x: node.x + node.incoming.x,
									y: node.y + node.incoming.y,
								},
							}),
					...(node.outgoing === undefined
						? {}
						: {
								outgoing: {
									x: node.x + node.outgoing.x,
									y: node.y + node.outgoing.y,
								},
							}),
					...(node.corner === undefined ? {} : { corner: node.corner }),
				})),
			}).points.map((node) => ({
				x: node.point.x,
				y: node.point.y,
				...(node.incoming === undefined
					? {}
					: {
							incoming: {
								x: node.incoming.x - node.point.x,
								y: node.incoming.y - node.point.y,
							},
						}),
				...(node.outgoing === undefined
					? {}
					: {
							outgoing: {
								x: node.outgoing.x - node.point.x,
								y: node.outgoing.y - node.point.y,
							},
						}),
			}))
		: contour
}

/** Writes an editor contour using node-owned cubic handles. */
export function editorContourToPath(
	contour: readonly EditorOutlineNode[],
	closed = true,
): string {
	const renderContour = renderEditorContour(contour, closed)
	const start = renderContour[0]
	if (start === undefined) return ""
	const commands = [`M ${format(start.x)} ${format(start.y)}`]
	const segmentCount = Math.max(0, renderContour.length - (closed ? 0 : 1))
	for (let index = 0; index < segmentCount; index += 1) {
		const from = renderContour[index]
		const to = renderContour[(index + 1) % renderContour.length]
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

/** Partitions editor contours by topology so open contours are never filled. */
export function editorContourPaintPaths(
	contours: readonly (
		| readonly EditorOutlineNode[]
		| { readonly closed: boolean; readonly nodes: readonly EditorOutlineNode[] }
	)[],
): EditorContourPaintPaths {
	const inferableContours = contours.flatMap((contour, contourIndex) => {
		if (!("nodes" in contour) || !contour.closed) return []
		return [
			{
				id: `contour:${contourIndex}`,
				closed: true,
				points: contour.nodes.map((node, pointIndex) => ({
					id:
						node.pointId ?? (`point:${contourIndex}:${pointIndex}` as PointId),
					point: { x: node.x, y: node.y },
					...(node.incoming === undefined
						? {}
						: {
								incoming: {
									x: node.x + node.incoming.x,
									y: node.y + node.incoming.y,
								},
							}),
					...(node.outgoing === undefined
						? {}
						: {
								outgoing: {
									x: node.x + node.outgoing.x,
									y: node.y + node.outgoing.y,
								},
							}),
					...(node.corner === undefined ? {} : { corner: node.corner }),
				})),
			},
		]
	})
	const inferred = lowerInferredCorners(inferableContours)
	const inferredByContourIndex = new Map(
		inferred.contours.map((contour) => [
			Number(contour.id.slice("contour:".length)),
			contour,
		]),
	)
	const closedContours = []
	const openContours = []
	const overflowCommands: string[] = []
	for (const [contourIndex, contour] of contours.entries()) {
		const inferredContour = inferredByContourIndex.get(contourIndex)
		const renderContour =
			!("nodes" in contour) || inferredContour === undefined
				? contour
				: {
						...contour,
						nodes: inferredContour.points.flatMap((point) => {
							const authoredIndex = contour.nodes.findIndex(
								(node, pointIndex) =>
									(node.pointId ??
										(`point:${contourIndex}:${pointIndex}` as PointId)) ===
									point.id,
							)
							const node = contour.nodes[authoredIndex]
							return node === undefined
								? []
								: [{ ...node, x: point.point.x, y: point.point.y }]
						}),
					}
		if (!("nodes" in renderContour) || renderContour.closed)
			closedContours.push(renderContour)
		else openContours.push(renderContour)
	}
	for (const segment of inferred.overflowSegments)
		overflowCommands.push(
			`M ${format(segment.start.x)} ${format(segment.start.y)} L ${format(segment.end.x)} ${format(segment.end.y)}`,
		)
	return {
		closedPath: editorContoursToPath(closedContours),
		openPath: editorContoursToPath(openContours),
		overflowPath: overflowCommands.join(" "),
	}
}

/**
 * Produces the non-destructive paint representation used for overlap preview.
 * Nonzero fill visually unions same-winding overlaps without changing source
 * topology; this deliberately does not claim compiler-compatible boolean
 * normalization across variable masters.
 */
export function combinedEditorPathPreview(
	contours: readonly (
		| readonly EditorOutlineNode[]
		| { readonly closed: boolean; readonly nodes: readonly EditorOutlineNode[] }
	)[],
): CombinedPathPreview {
	return {
		path: editorContourPaintPaths(contours).closedPath,
		fillRule: "nonzero",
		sourceContourCount: contours.length,
		nonDestructive: true,
	}
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
