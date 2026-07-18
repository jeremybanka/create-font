import type { EditorGlyphSource, MasterId } from "@create-font/states"

import { editorContourPaintPaths } from "./geometry.ts"

export type GlyphPreview = Readonly<{
	advanceWidth: number
	path: string
	openPath: string
	viewBox: string
}>

type GlyphPreviewMetrics = Readonly<{
	ascender: number
	descender: number
}>

const PREVIEW_PADDING = 0.08

export function createGlyphPreview(
	glyph: EditorGlyphSource,
	masterId: MasterId,
	metrics: GlyphPreviewMetrics,
	unitsPerEm: number,
): GlyphPreview | null {
	const layer = glyph.layers.find(
		(candidate) => candidate.masterId === masterId,
	)
	if (layer === undefined) return null
	const layerPoints = new Map(
		layer.points.map((point) => [point.pointId, point] as const),
	)
	const contours = []
	for (const contour of glyph.contours) {
		const nodes = []
		for (const point of contour.points) {
			const layerPoint = layerPoints.get(point.id)
			if (layerPoint === undefined) return null
			nodes.push(layerPoint)
		}
		contours.push({ closed: contour.closed, nodes })
	}

	let minX = 0
	let maxX = layer.advanceWidth
	let minY = metrics.descender
	let maxY = metrics.ascender
	for (const point of layer.points) {
		minX = Math.min(
			minX,
			point.x,
			point.x + (point.incoming?.x ?? 0),
			point.x + (point.outgoing?.x ?? 0),
		)
		maxX = Math.max(
			maxX,
			point.x,
			point.x + (point.incoming?.x ?? 0),
			point.x + (point.outgoing?.x ?? 0),
		)
		minY = Math.min(
			minY,
			point.y,
			point.y + (point.incoming?.y ?? 0),
			point.y + (point.outgoing?.y ?? 0),
		)
		maxY = Math.max(
			maxY,
			point.y,
			point.y + (point.incoming?.y ?? 0),
			point.y + (point.outgoing?.y ?? 0),
		)
	}

	const centerX = (minX + maxX) / 2
	const centerY = (minY + maxY) / 2
	const size =
		Math.max(unitsPerEm, maxX - minX, maxY - minY, 1) *
		(1 + PREVIEW_PADDING * 2)
	const paintPaths = editorContourPaintPaths(contours)
	return {
		advanceWidth: layer.advanceWidth,
		path: paintPaths.closedPath,
		openPath: paintPaths.openPath,
		viewBox: [centerX - size / 2, -centerY - size / 2, size, size].join(` `),
	}
}
