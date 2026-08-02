import {
	writeVectorClipboard,
	type VectorClipboardPayload,
} from "@create-font/editor/shared"
import {
	decodeDesignDocument,
	validateDesignDocument,
} from "@create-design/source"

import {
	IDENTITY_DESIGN_TRANSFORM,
	objectBounds,
	projectDesignObjectContours,
	translateObject,
} from "./geometry.ts"
import { duplicateDesignHierarchySelection } from "./design-hierarchy.ts"
import {
	documentToInterchangePoint,
	documentToInterchangeVector,
	interchangeToDocumentPoint,
	interchangeToDocumentVector,
} from "./coordinates.ts"
import type {
	DesignArtboard,
	DesignContour,
	DesignDocument,
	DesignObject,
	DesignPoint,
	DesignSwatch,
} from "./types.ts"

export const DESIGN_VECTOR_MIME =
	"application/vnd.create-design.vector+json" as const
export const FONT_OUTLINE_MIME =
	"application/vnd.create-font.outline+json" as const
export const FONT_TEXT_PREFIX = "create-font-outline:" as const
const MASTER_ID = "master:create-design"

interface DesignClipboardPayload {
	readonly format: "create-design.vector"
	readonly version: 3
	readonly coordinateSpace: "global-document-y-down"
	readonly objects: readonly DesignObject[]
	readonly swatches: readonly DesignSwatch[]
}

interface FontOutlinePayload {
	readonly format: "create-font.outline"
	readonly version: 1
	readonly sourceApplication?: "create-font" | "create-design"
	readonly masterIds: readonly string[]
	readonly contours: readonly {
		readonly closed: boolean
		readonly points: readonly {
			readonly key: string
			readonly mode: "soft" | "hard"
		}[]
	}[]
	readonly layers: readonly {
		readonly masterId: string
		readonly points: readonly {
			readonly key: string
			readonly x: number
			readonly y: number
			readonly incoming?: Readonly<{ readonly x: number; readonly y: number }>
			readonly outgoing?: Readonly<{ readonly x: number; readonly y: number }>
		}[]
	}[]
}

export interface ClipboardWriter {
	setData(format: string, value: string): void
}

export interface ClipboardReader {
	getData(format: string): string
}

const cloneDesignObject = (
	object: DesignObject,
	nextId: () => string,
	deltaX = 0,
	deltaY = 0,
): DesignObject =>
	translateObject(
		{
			...object,
			id: `object:${nextId()}`,
			geometry:
				object.geometry.kind === "path"
					? {
							...object.geometry,
							contours: object.geometry.contours.map((contour) => ({
								...contour,
								id: `contour:${nextId()}`,
								points: contour.points.map((point) => ({
									...point,
									id: `point:${nextId()}`,
								})),
							})),
						}
					: object.geometry,
		},
		deltaX,
		deltaY,
	)

/** Creates one ordered, offset duplicate batch suitable for a single history entry. */
export function duplicateDesignObjects(
	document: DesignDocument,
	objectIds: readonly string[],
	nextId: () => string,
	deltaX = 12,
	deltaY = 12,
): Readonly<{
	document: DesignDocument
	selection: readonly string[]
}> | null {
	const selectedIds = new Set(objectIds)
	const sources = document.objects.filter((object) =>
		selectedIds.has(object.id),
	)
	const duplicates = sources.map((object) =>
		cloneDesignObject(object, nextId, deltaX, deltaY),
	)
	if (duplicates.length === 0) return null
	const idMap = new Map(
		sources.map((object, index) => [object.id, duplicates[index]!.id] as const),
	)
	const withDuplicates = {
		...document,
		objects: [...document.objects, ...duplicates],
	}
	const hierarchy = duplicateDesignHierarchySelection(
		withDuplicates,
		objectIds,
		idMap,
		nextId,
	)
	if (hierarchy !== null) return hierarchy
	return {
		document: withDuplicates,
		selection: duplicates.map((object) => object.id),
	}
}

export function writeDesignClipboard(
	clipboard: ClipboardWriter,
	document: DesignDocument,
	objectIds: readonly string[],
	vectorPayload?: VectorClipboardPayload,
): number {
	const selected = document.objects.filter((object) =>
		objectIds.includes(object.id),
	)
	if (selected.length === 0) return 0
	const swatchIds = new Set(
		selected.flatMap((object) => [
			...(object.appearance.fill === undefined
				? []
				: [object.appearance.fill.swatchId]),
			...(object.appearance.stroke === undefined
				? []
				: [object.appearance.stroke.swatchId]),
		]),
	)
	const payload: DesignClipboardPayload = {
		format: "create-design.vector",
		version: 3,
		coordinateSpace: "global-document-y-down",
		objects: selected,
		swatches: document.swatches.filter((swatch) => swatchIds.has(swatch.id)),
	}
	const font = designObjectsToFontOutline(selected)
	clipboard.setData(DESIGN_VECTOR_MIME, JSON.stringify(payload))
	clipboard.setData(FONT_OUTLINE_MIME, JSON.stringify(font))
	clipboard.setData("text/plain", `${FONT_TEXT_PREFIX}${JSON.stringify(font)}`)
	if (vectorPayload !== undefined)
		writeVectorClipboard(clipboard, vectorPayload)
	return selected.length
}

export function readDesignClipboard(
	clipboard: ClipboardReader,
	document: DesignDocument,
	nextId: () => string,
	options: Readonly<{
		activeArtboard?: DesignArtboard
		nativeOnly?: boolean
	}> = {},
): Readonly<{
	objects: readonly DesignObject[]
	swatches: readonly DesignSwatch[]
}> | null {
	const design = clipboard.getData(DESIGN_VECTOR_MIME)
	if (design.length > 0) {
		const parsed = parseDesignPayload(design)
		if (parsed !== null) {
			const swatchIds = new Map<string, string>()
			const existingIds = new Set(document.swatches.map((swatch) => swatch.id))
			const swatches = parsed.swatches
				.map((swatch) => {
					if (!existingIds.has(swatch.id)) {
						swatchIds.set(swatch.id, swatch.id)
						return swatch
					}
					const existing = document.swatches.find(
						(candidate) => candidate.id === swatch.id,
					)
					if (JSON.stringify(existing) === JSON.stringify(swatch)) {
						swatchIds.set(swatch.id, swatch.id)
						return null
					}
					const id = `swatch:${nextId()}`
					swatchIds.set(swatch.id, id)
					return { ...swatch, id, name: `${swatch.name} copy` }
				})
				.filter((swatch): swatch is DesignSwatch => swatch !== null)
			return {
				swatches,
				objects: parsed.objects.map((object) =>
					cloneDesignObject(
						{
							...object,
							appearance: {
								...(object.appearance.fill === undefined
									? {}
									: {
											fill: {
												swatchId:
													swatchIds.get(object.appearance.fill.swatchId) ??
													object.appearance.fill.swatchId,
											},
										}),
								...(object.appearance.stroke === undefined
									? {}
									: {
											stroke: {
												...object.appearance.stroke,
												swatchId:
													swatchIds.get(object.appearance.stroke.swatchId) ??
													object.appearance.stroke.swatchId,
											},
										}),
							},
						},
						nextId,
					),
				),
			}
		}
	}
	if (options.nativeOnly === true) return null
	const serialized =
		clipboard.getData(FONT_OUTLINE_MIME) || clipboard.getData("text/plain")
	if (serialized.length === 0) return null
	const font = parseFontPayload(serialized)
	if (font === null) return null
	const artboard = options.activeArtboard ?? document.artboards[0]
	if (artboard === undefined) return null
	const object = fontOutlineToDesignObject(font, artboard, nextId)
	return object === null ? null : { objects: [object], swatches: [] }
}

export function designObjectsToFontOutline(
	objects: readonly DesignObject[],
): FontOutlinePayload {
	const contours: FontOutlinePayload["contours"][number][] = []
	const points: FontOutlinePayload["layers"][number]["points"][number][] = []
	let contourIndex = 0
	for (const object of objects) {
		for (const contour of projectDesignObjectContours(object)) {
			const outlinePoints = contour.points.map((point, pointIndex) => {
				const key = `${contourIndex}/${pointIndex}`
				const position = documentToInterchangePoint(point)
				points.push({
					key,
					...position,
					...(point.incoming === undefined
						? {}
						: {
								incoming: {
									...documentToInterchangeVector(point.incoming),
								},
							}),
					...(point.outgoing === undefined
						? {}
						: {
								outgoing: {
									...documentToInterchangeVector(point.outgoing),
								},
							}),
				})
				return {
					key,
					mode:
						point.incoming === undefined && point.outgoing === undefined
							? ("hard" as const)
							: ("soft" as const),
				}
			})
			if (outlinePoints.length > 0) {
				contours.push({ closed: contour.closed, points: outlinePoints })
				contourIndex += 1
			}
		}
	}
	return {
		format: "create-font.outline",
		version: 1,
		sourceApplication: "create-design",
		masterIds: [MASTER_ID],
		contours,
		layers: [{ masterId: MASTER_ID, points }],
	}
}

function parseDesignPayload(value: string): DesignClipboardPayload | null {
	try {
		const parsed = JSON.parse(value) as Record<string, unknown>
		if (
			parsed.format !== "create-design.vector" ||
			(parsed.version !== 1 && parsed.version !== 2 && parsed.version !== 3) ||
			(parsed.version !== 1 &&
				parsed.coordinateSpace !== "global-document-y-down") ||
			!Array.isArray(parsed.objects) ||
			!Array.isArray(parsed.swatches)
		)
			return null
		const envelope = {
			format: "create-design.document" as const,
			title: "Clipboard",
			objects: parsed.objects,
			swatches: parsed.swatches,
			guides: [],
		}
		const compatible =
			parsed.version === 3
				? validateDesignDocument({
						...envelope,
						version: 5,
						artboards: [
							{
								id: "artboard:clipboard",
								name: "Clipboard",
								x: 0,
								y: 0,
								width: 1,
								height: 1,
							},
						],
					})
				: parsed.version === 2
					? decodeDesignDocument({
							...envelope,
							version: 3,
							page: { x: 0, y: 0, width: 1, height: 1 },
						})
					: decodeDesignDocument({
							...envelope,
							version: 2,
							page: { width: 1, height: 1 },
						})
		const ancient = compatible.ok
			? compatible
			: parsed.version === 1
				? decodeDesignDocument({
						...envelope,
						version: 1,
						page: { width: 1, height: 1 },
					})
				: compatible
		return ancient.ok
			? {
					format: "create-design.vector",
					version: 3,
					coordinateSpace: "global-document-y-down",
					objects: ancient.value.objects,
					swatches: ancient.value.swatches,
				}
			: null
	} catch {
		return null
	}
}

function parseFontPayload(value: string): FontOutlinePayload | null {
	const json = value.startsWith(FONT_TEXT_PREFIX)
		? value.slice(FONT_TEXT_PREFIX.length)
		: value
	try {
		const parsed = JSON.parse(json) as Partial<FontOutlinePayload>
		return parsed.format === "create-font.outline" &&
			parsed.version === 1 &&
			Array.isArray(parsed.contours) &&
			Array.isArray(parsed.layers) &&
			parsed.layers.length > 0
			? (parsed as FontOutlinePayload)
			: null
	} catch {
		return null
	}
}

function fontOutlineToDesignObject(
	payload: FontOutlinePayload,
	artboard: DesignArtboard,
	nextId: () => string,
): DesignObject | null {
	const layer = payload.layers[0]
	if (layer === undefined) return null
	const byKey = new Map(layer.points.map((point) => [point.key, point]))
	const contours: DesignContour[] = payload.contours.map((contour) => ({
		id: `contour:${nextId()}`,
		closed: contour.closed,
		points: contour.points.flatMap((point): DesignPoint[] => {
			const layerPoint = byKey.get(point.key)
			if (layerPoint === undefined) return []
			return [
				{
					id: `point:${nextId()}`,
					...interchangeToDocumentPoint(layerPoint),
					...(layerPoint.incoming === undefined
						? {}
						: {
								incoming: {
									...interchangeToDocumentVector(layerPoint.incoming),
								},
							}),
					...(layerPoint.outgoing === undefined
						? {}
						: {
								outgoing: {
									...interchangeToDocumentVector(layerPoint.outgoing),
								},
							}),
				},
			]
		}),
	}))
	const object: DesignObject = {
		id: `object:${nextId()}`,
		name: "Pasted create-font outline",
		geometry: { kind: "path", contours },
		transform: IDENTITY_DESIGN_TRANSFORM,
		appearance: { fill: { swatchId: "swatch:ink" } },
	}
	const bounds = objectBounds(object)
	if (bounds === null) return null
	return payload.sourceApplication === "create-design"
		? object
		: translateObject(
				object,
				artboard.x + artboard.width / 2 - (bounds.minX + bounds.maxX) / 2,
				artboard.y + artboard.height / 2 - (bounds.minY + bounds.maxY) / 2,
			)
}
