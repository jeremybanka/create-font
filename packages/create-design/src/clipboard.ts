import {
	writeVectorClipboard,
	type VectorClipboardPayload,
} from "@create-font/editor/shared"
import { validateDesignDocument } from "@create-design/source"

import {
	IDENTITY_DESIGN_TRANSFORM,
	objectBounds,
	projectDesignObjectContours,
	translateObject,
} from "./geometry.ts"
import type {
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
	readonly version: 1
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
		version: 1,
		objects: selected,
		swatches: document.swatches.filter((swatch) => swatchIds.has(swatch.id)),
	}
	const font = designObjectsToFontOutline(selected, document.page.height)
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
					translateObject(
						{
							...object,
							id: `object:${nextId()}`,
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
						12,
						12,
					),
				),
			}
		}
	}
	const serialized =
		clipboard.getData(FONT_OUTLINE_MIME) || clipboard.getData("text/plain")
	if (serialized.length === 0) return null
	const font = parseFontPayload(serialized)
	if (font === null) return null
	const object = fontOutlineToDesignObject(
		font,
		document.page.width,
		document.page.height,
		nextId,
	)
	return object === null ? null : { objects: [object], swatches: [] }
}

export function designObjectsToFontOutline(
	objects: readonly DesignObject[],
	pageHeight: number,
): FontOutlinePayload {
	const contours: FontOutlinePayload["contours"][number][] = []
	const points: FontOutlinePayload["layers"][number]["points"][number][] = []
	let contourIndex = 0
	for (const object of objects) {
		for (const contour of projectDesignObjectContours(object)) {
			const outlinePoints = contour.points.map((point, pointIndex) => {
				const key = `${contourIndex}/${pointIndex}`
				points.push({
					key,
					x: point.x,
					y: pageHeight - point.y,
					...(point.incoming === undefined
						? {}
						: {
								incoming: {
									x: point.incoming.x,
									y: -point.incoming.y,
								},
							}),
					...(point.outgoing === undefined
						? {}
						: {
								outgoing: {
									x: point.outgoing.x,
									y: -point.outgoing.y,
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
		const parsed = JSON.parse(value) as Partial<DesignClipboardPayload>
		if (
			parsed.format !== "create-design.vector" ||
			parsed.version !== 1 ||
			!Array.isArray(parsed.objects) ||
			!Array.isArray(parsed.swatches)
		)
			return null
		const normalized = validateDesignDocument({
			format: "create-design.document",
			version: 1,
			title: "Clipboard",
			page: { width: 1, height: 1 },
			objects: parsed.objects,
			swatches: parsed.swatches,
			guides: [],
		})
		return normalized.ok
			? {
					format: "create-design.vector",
					version: 1,
					objects: normalized.value.objects,
					swatches: normalized.value.swatches,
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
	pageWidth: number,
	pageHeight: number,
	nextId: () => string,
): DesignObject | null {
	const layer = payload.layers[0]
	if (layer === undefined) return null
	const byKey = new Map(layer.points.map((point) => [point.key, point]))
	const contours: DesignContour[] = payload.contours.map((contour) => ({
		closed: contour.closed,
		points: contour.points.flatMap((point): DesignPoint[] => {
			const layerPoint = byKey.get(point.key)
			if (layerPoint === undefined) return []
			return [
				{
					x: layerPoint.x,
					y: -layerPoint.y,
					...(layerPoint.incoming === undefined
						? {}
						: {
								incoming: {
									x: layerPoint.incoming.x,
									y: -layerPoint.incoming.y,
								},
							}),
					...(layerPoint.outgoing === undefined
						? {}
						: {
								outgoing: {
									x: layerPoint.outgoing.x,
									y: -layerPoint.outgoing.y,
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
	return translateObject(
		object,
		pageWidth / 2 - (bounds.minX + bounds.maxX) / 2,
		pageHeight / 2 - (bounds.minY + bounds.maxY) / 2,
	)
}
