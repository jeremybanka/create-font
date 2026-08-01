import { visibleObjectBounds } from "./painted-geometry.ts"
import type { DesignArtboard, DesignDocument, DesignObject } from "./types.ts"

export const DESIGN_ARTBOARD_PRESETS = [
	{ id: "letter", name: "US Letter", width: 612, height: 792 },
	{ id: "a4", name: "A4", width: 595, height: 842 },
	{ id: "screen", name: "HD screen", width: 1920, height: 1080 },
	{ id: "square", name: "Square", width: 1080, height: 1080 },
] as const

export type DesignArtboardPresetId =
	(typeof DESIGN_ARTBOARD_PRESETS)[number]["id"]

export interface DesignArtboardBounds {
	readonly x: number
	readonly y: number
	readonly width: number
	readonly height: number
}

export interface DesignArtboardMutation {
	readonly document: DesignDocument
	readonly activeArtboardId: string
}

const ARTBOARD_GAP = 48

function validBounds(bounds: DesignArtboardBounds): boolean {
	return (
		Number.isFinite(bounds.x) &&
		Number.isFinite(bounds.y) &&
		Number.isFinite(bounds.width) &&
		Number.isFinite(bounds.height) &&
		bounds.width > 0 &&
		bounds.height > 0
	)
}

export function artboardPreset(id: DesignArtboardPresetId) {
	return DESIGN_ARTBOARD_PRESETS.find((preset) => preset.id === id)!
}

export function allDesignArtboardsBounds(
	artboards: readonly DesignArtboard[],
): DesignArtboardBounds {
	const first = artboards[0]
	if (first === undefined)
		throw new Error("A create-design document requires at least one artboard.")
	const minX = Math.min(...artboards.map(({ x }) => x))
	const minY = Math.min(...artboards.map(({ y }) => y))
	const maxX = Math.max(...artboards.map(({ x, width }) => x + width))
	const maxY = Math.max(...artboards.map(({ y, height }) => y + height))
	return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

export function designArtboardsAtPoint(
	artboards: readonly DesignArtboard[],
	point: Readonly<{ x: number; y: number }>,
): readonly DesignArtboard[] {
	return artboards.filter(
		(artboard) =>
			point.x >= artboard.x &&
			point.x <= artboard.x + artboard.width &&
			point.y >= artboard.y &&
			point.y <= artboard.y + artboard.height,
	)
}

function intersects(
	a: Readonly<{ x: number; y: number; width: number; height: number }>,
	b: Readonly<{ minX: number; minY: number; maxX: number; maxY: number }>,
): boolean {
	return (
		b.maxX >= a.x &&
		b.minX <= a.x + a.width &&
		b.maxY >= a.y &&
		b.minY <= a.y + a.height
	)
}

export function objectsIntersectingDesignArtboard(
	document: DesignDocument,
	artboard: DesignArtboard,
): readonly DesignObject[] {
	return document.objects.filter((object) => {
		const bounds = visibleObjectBounds(object)
		return bounds !== null && intersects(artboard, bounds)
	})
}

export function createDesignArtboard(
	document: DesignDocument,
	id: string,
	bounds?: DesignArtboardBounds,
): DesignArtboardMutation {
	const last = document.artboards.at(-1)!
	const nextBounds =
		bounds ??
		({
			x: last.x + last.width + ARTBOARD_GAP,
			y: last.y,
			width: last.width,
			height: last.height,
		} satisfies DesignArtboardBounds)
	if (!validBounds(nextBounds))
		throw new Error("Artboard bounds must be valid.")
	const artboard: DesignArtboard = {
		id,
		name: `Artboard ${document.artboards.length + 1}`,
		...nextBounds,
	}
	return {
		document: { ...document, artboards: [...document.artboards, artboard] },
		activeArtboardId: id,
	}
}

export function duplicateDesignArtboard(
	document: DesignDocument,
	artboardId: string,
	id: string,
): DesignArtboardMutation {
	const index = document.artboards.findIndex(({ id }) => id === artboardId)
	if (index < 0) throw new Error(`Unknown artboard ${artboardId}.`)
	const source = document.artboards[index]!
	const artboard: DesignArtboard = {
		...source,
		id,
		name: `${source.name} copy`,
		x: source.x + ARTBOARD_GAP,
		y: source.y + ARTBOARD_GAP,
	}
	return {
		document: {
			...document,
			artboards: document.artboards.toSpliced(index + 1, 0, artboard),
		},
		activeArtboardId: id,
	}
}

export function updateDesignArtboard(
	document: DesignDocument,
	artboardId: string,
	properties: Partial<Omit<DesignArtboard, "id">>,
	options: Readonly<{ moveIntersectingArtwork?: boolean }> = {},
): DesignDocument {
	const source = document.artboards.find(({ id }) => id === artboardId)
	if (source === undefined) throw new Error(`Unknown artboard ${artboardId}.`)
	const updated = { ...source, ...properties }
	if (!validBounds(updated)) throw new Error("Artboard bounds must be valid.")
	const delta = { x: updated.x - source.x, y: updated.y - source.y }
	const movingArtwork =
		options.moveIntersectingArtwork === true && (delta.x !== 0 || delta.y !== 0)
			? new Set(
					objectsIntersectingDesignArtboard(document, source).map(
						({ id }) => id,
					),
				)
			: null
	return {
		...document,
		artboards: document.artboards.map((artboard) =>
			artboard.id === artboardId ? updated : artboard,
		),
		objects:
			movingArtwork === null
				? document.objects
				: document.objects.map((object) =>
						movingArtwork.has(object.id)
							? {
									...object,
									transform: {
										...object.transform,
										e: object.transform.e + delta.x,
										f: object.transform.f + delta.y,
									},
								}
							: object,
					),
	}
}

export function reorderDesignArtboard(
	document: DesignDocument,
	artboardId: string,
	destination: number,
): DesignDocument {
	const source = document.artboards.findIndex(({ id }) => id === artboardId)
	if (source < 0) throw new Error(`Unknown artboard ${artboardId}.`)
	const target = Math.max(
		0,
		Math.min(document.artboards.length - 1, destination),
	)
	if (target === source) return document
	const without = document.artboards.toSpliced(source, 1)
	return {
		...document,
		artboards: without.toSpliced(target, 0, document.artboards[source]!),
	}
}

export function deleteDesignArtboard(
	document: DesignDocument,
	artboardId: string,
): DesignArtboardMutation | null {
	if (document.artboards.length === 1) return null
	const index = document.artboards.findIndex(({ id }) => id === artboardId)
	if (index < 0) throw new Error(`Unknown artboard ${artboardId}.`)
	const artboards = document.artboards.filter(({ id }) => id !== artboardId)
	return {
		document: { ...document, artboards },
		activeArtboardId: artboards[Math.min(index, artboards.length - 1)]!.id,
	}
}
