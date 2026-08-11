import {
	cubicBounds,
	flattenCubic,
	intersectPolylines,
	normalizeContour,
	resolveFilledContours,
	signedArea,
	windingNumber,
	type Contour,
} from "@create-art/vector-geometry"
import type { EditorGlyphSource, MasterId } from "@create-font/states"

import {
	editorContourPaintPaths,
	editorSegmentCubic,
	renderEditorContour,
	type EditorOutlineNode,
} from "./geometry.ts"
import type { GlyphPreview } from "./glyph-preview.ts"

const FAVICON_FRAME_WIDTH_RATIO = 0.85
const FAVICON_OUTLINE_FLATNESS = 0.25

type OutlineBounds = Readonly<{
	xMin: number
	yMin: number
	xMax: number
	yMax: number
}>

function hasFiniteNode(node: EditorOutlineNode): boolean {
	return (
		Number.isFinite(node.x) &&
		Number.isFinite(node.y) &&
		(node.incoming === undefined ||
			(Number.isFinite(node.incoming.x) && Number.isFinite(node.incoming.y))) &&
		(node.outgoing === undefined ||
			(Number.isFinite(node.outgoing.x) && Number.isFinite(node.outgoing.y))) &&
		(node.corner === undefined || Number.isFinite(node.corner.amount))
	)
}

function exactClosedOutlineBounds(
	contours: readonly (readonly EditorOutlineNode[])[],
): OutlineBounds | null {
	let xMin = Number.POSITIVE_INFINITY
	let yMin = Number.POSITIVE_INFINITY
	let xMax = Number.NEGATIVE_INFINITY
	let yMax = Number.NEGATIVE_INFINITY
	for (const contour of contours) {
		if (contour.length === 0) continue
		if (!contour.every(hasFiniteNode)) return null
		const segmentCount = contour.length
		for (let segmentIndex = 0; segmentIndex < segmentCount; segmentIndex += 1) {
			const cubic = editorSegmentCubic(contour, segmentIndex, true)
			if (cubic === null) continue
			const bounds = cubicBounds(cubic)
			xMin = Math.min(xMin, bounds.minX)
			yMin = Math.min(yMin, bounds.minY)
			xMax = Math.max(xMax, bounds.maxX)
			yMax = Math.max(yMax, bounds.maxY)
		}
	}
	if (![xMin, yMin, xMax, yMax].every(Number.isFinite)) return null
	return { xMin, yMin, xMax, yMax }
}

function flattenClosedOutline(contour: readonly EditorOutlineNode[]): Contour {
	const points = contour.flatMap((_, segmentIndex) => {
		const cubic = editorSegmentCubic(contour, segmentIndex, true)
		if (cubic === null) return []
		const flattened = flattenCubic(cubic, {
			flatness: FAVICON_OUTLINE_FLATNESS,
		})
		return segmentIndex === 0 ? flattened : flattened.slice(1)
	})
	return normalizeContour({ closed: true, points }, { orientation: "preserve" })
}

/**
 * Assigns winding from geometric containment before resolving the favicon fill.
 * Intersecting contours are independent positive shapes, while a wholly nested
 * contour alternates between counter and island. This gives nonzero union the
 * intended glyph semantics without trusting source contour direction.
 */
function resolveFaviconContours(
	contours: readonly (readonly EditorOutlineNode[])[],
): readonly Contour[] {
	const flattened = contours.map(flattenClosedOutline)
	const parentIndexes = flattened.map((contour, contourIndex) => {
		const probe = contour.points[0]
		if (probe === undefined) return null
		return (
			flattened
				.map((candidate, candidateIndex) => ({ candidate, candidateIndex }))
				.filter(
					({ candidate, candidateIndex }) =>
						candidateIndex !== contourIndex &&
						intersectPolylines(contour.points, candidate.points, {
							firstClosed: true,
							secondClosed: true,
						}).length === 0 &&
						windingNumber(probe, candidate.points).classification === "inside",
				)
				.sort(
					(left, right) =>
						Math.abs(signedArea(left.candidate.points)) -
						Math.abs(signedArea(right.candidate.points)),
				)[0]?.candidateIndex ?? null
		)
	})
	const depths = new Map<number, number>()
	const depth = (index: number): number => {
		const known = depths.get(index)
		if (known !== undefined) return known
		const parentIndex = parentIndexes[index]
		const value =
			parentIndex === null || parentIndex === undefined
				? 0
				: depth(parentIndex) + 1
		depths.set(index, value)
		return value
	}
	const wound = flattened.map((contour, index) =>
		normalizeContour(contour, {
			orientation: depth(index) % 2 === 0 ? "counter-clockwise" : "clockwise",
		}),
	)
	return resolveFilledContours(wound, { fillRule: "nonzero" })
}

/** Creates the deliberately close-cropped lowercase-a favicon preview. */
export function createFaviconGlyphPreview(
	glyph: EditorGlyphSource,
	masterId: MasterId,
): GlyphPreview | null {
	const layer = glyph.layers.find(
		(candidate) => candidate.masterId === masterId,
	)
	if (layer === undefined) return null
	const closedContours: (readonly EditorOutlineNode[])[] = []
	try {
		for (const contour of layer.contours) {
			if (!contour.closed || contour.points.length === 0) continue
			const nodes = contour.points.map((point) => ({
				pointId: point.id,
				...point,
			}))
			if (!nodes.every(hasFiniteNode)) return null
			closedContours.push(renderEditorContour(nodes, true))
		}
		const bounds = exactClosedOutlineBounds(closedContours)
		if (bounds === null) return null
		const width = bounds.xMax - bounds.xMin
		const side = width * FAVICON_FRAME_WIDTH_RATIO
		if (!Number.isFinite(side) || side <= 0) return null
		const centerX = (bounds.xMin + bounds.xMax) / 2
		const centerY = (bounds.yMin + bounds.yMax) / 2
		const resolvedContours = resolveFaviconContours(closedContours)
		const path = editorContourPaintPaths(
			resolvedContours.map((contour) => ({
				closed: true,
				nodes: contour.points,
			})),
		).closedPath
		if (path.trim().length === 0) return null
		return {
			advanceWidth: layer.advanceWidth,
			path,
			openPath: "",
			viewBox: [centerX - side / 2, -centerY - side / 2, side, side].join(" "),
		}
	} catch {
		return null
	}
}
