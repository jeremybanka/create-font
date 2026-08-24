import { projectDesignObjectContours, resolvedRgb } from "@create-design/model"

import type {
	DesignArtboard,
	DesignContour,
	DesignDocument,
	DesignObject,
} from "./types.ts"

export const VELLO_HYBRID_SCENE_ABI_VERSION = 1
export const VELLO_MINIMUM_DEVICE_STROKE_WIDTH = 0.75

export type VelloPathCommand =
	| Readonly<{ verb: "move" | "line"; x: number; y: number }>
	| Readonly<{
			verb: "cubic"
			x1: number
			y1: number
			x2: number
			y2: number
			x: number
			y: number
	  }>
	| Readonly<{ verb: "close" }>

export type VelloSceneDraw = Readonly<{
	id: string
	path: readonly VelloPathCommand[]
	fillRule: "nonzero" | "evenodd"
	fill: readonly [number, number, number, number] | null
	stroke: Readonly<{
		color: readonly [number, number, number, number]
		width: number
		cap: "butt" | "round" | "square"
		join: "miter" | "round" | "bevel"
		miterLimit: number
	}> | null
}>

export type VelloHybridScenePacket = Readonly<{
	abiVersion: typeof VELLO_HYBRID_SCENE_ABI_VERSION
	width: number
	height: number
	view: readonly [number, number, number, number, number, number]
	draws: readonly VelloSceneDraw[]
}>

export type VelloHybridDiagnostic = Readonly<{
	code:
		| "canvas-size"
		| "artboard-color"
		| "image"
		| "linked-artboard"
		| "mask"
		| "stroke-dash"
		| "text"
	message: string
	objectId?: string
}>

export type VelloHybridSceneProjection = Readonly<{
	packet: VelloHybridScenePacket | null
	packetJson: string | null
	gpuObjectIds: ReadonlySet<string>
	diagnostics: readonly VelloHybridDiagnostic[]
}>

export const EMPTY_VELLO_HYBRID_SCENE_PROJECTION: VelloHybridSceneProjection =
	Object.freeze({
		packet: null,
		packetJson: null,
		gpuObjectIds: new Set<string>(),
		diagnostics: Object.freeze([]),
	})

export type VelloHybridSceneInput = Readonly<{
	viewport: Readonly<{ width: number; height: number }>
	devicePixelRatio: number
	view: Readonly<{ x: number; y: number; scale: number }>
	artboards: readonly DesignArtboard[]
	objects: readonly DesignObject[]
	swatches: Pick<DesignDocument, "swatches">["swatches"]
	maskedObjectIds?: ReadonlySet<string>
}>

function finite(value: number): number {
	return Number.isFinite(value) ? value : 0
}

function contourCommands(contour: DesignContour): readonly VelloPathCommand[] {
	const first = contour.points[0]
	if (first === undefined) return []
	const commands: VelloPathCommand[] = [
		{ verb: "move", x: finite(first.x), y: finite(first.y) },
	]
	const segment = (
		from: DesignContour["points"][number],
		to: DesignContour["points"][number],
	): void => {
		if (from.outgoing === undefined && to.incoming === undefined) {
			commands.push({ verb: "line", x: finite(to.x), y: finite(to.y) })
			return
		}
		commands.push({
			verb: "cubic",
			x1: finite(from.x + (from.outgoing?.x ?? 0)),
			y1: finite(from.y + (from.outgoing?.y ?? 0)),
			x2: finite(to.x + (to.incoming?.x ?? 0)),
			y2: finite(to.y + (to.incoming?.y ?? 0)),
			x: finite(to.x),
			y: finite(to.y),
		})
	}
	for (let index = 1; index < contour.points.length; index += 1) {
		const from = contour.points[index - 1]
		const to = contour.points[index]
		if (from !== undefined && to !== undefined) segment(from, to)
	}
	if (contour.closed && contour.points.length > 1) {
		const last = contour.points.at(-1)
		if (last !== undefined) segment(last, first)
		commands.push({ verb: "close" })
	}
	return commands
}

function rectangleCommands(
	id: string,
	x: number,
	y: number,
	width: number,
	height: number,
): VelloSceneDraw {
	return {
		id,
		path: [
			{ verb: "move", x, y },
			{ verb: "line", x: x + width, y },
			{ verb: "line", x: x + width, y: y + height },
			{ verb: "line", x, y: y + height },
			{ verb: "close" },
		],
		fillRule: "nonzero",
		fill: null,
		stroke: null,
	}
}

function cssColor(
	value: string,
): readonly [number, number, number, number] | null {
	const hexadecimal = /^#([\da-f]{3}|[\da-f]{6}|[\da-f]{8})$/i.exec(
		value.trim(),
	)
	if (hexadecimal !== null) {
		const source = hexadecimal[1]!
		const expanded =
			source.length === 3
				? [...source].map((part) => `${part}${part}`).join("")
				: source
		return [
			Number.parseInt(expanded.slice(0, 2), 16),
			Number.parseInt(expanded.slice(2, 4), 16),
			Number.parseInt(expanded.slice(4, 6), 16),
			expanded.length === 8 ? Number.parseInt(expanded.slice(6, 8), 16) : 255,
		]
	}
	const rgb = /^rgb\(\s*(\d+)\s*[, ]\s*(\d+)\s*[, ]\s*(\d+)\s*\)$/i.exec(
		value.trim(),
	)
	return rgb === null
		? null
		: [
				Math.min(255, Number(rgb[1])),
				Math.min(255, Number(rgb[2])),
				Math.min(255, Number(rgb[3])),
				255,
			]
}

export function velloPreservedStrokeWidth(
	authoredWidth: number,
	worldScale: number,
	devicePixelRatio: number,
	minimumDeviceWidth = VELLO_MINIMUM_DEVICE_STROKE_WIDTH,
): number {
	const deviceScale = worldScale * devicePixelRatio
	if (!(authoredWidth > 0) || !(deviceScale > 0))
		return Math.max(0, authoredWidth)
	return Math.max(authoredWidth, minimumDeviceWidth / deviceScale)
}

export function projectVelloHybridScene(
	input: VelloHybridSceneInput,
): VelloHybridSceneProjection {
	const ratio = Number.isFinite(input.devicePixelRatio)
		? Math.max(1, input.devicePixelRatio)
		: 1
	const width = Math.round(input.viewport.width * ratio)
	const height = Math.round(input.viewport.height * ratio)
	const diagnostics: VelloHybridDiagnostic[] = []
	if (width <= 0 || height <= 0 || width > 65_535 || height > 65_535) {
		diagnostics.push({
			code: "canvas-size",
			message: `Vello requires a non-empty drawing buffer no larger than 65535px; received ${width}x${height}.`,
		})
		return {
			packet: null,
			packetJson: null,
			gpuObjectIds: new Set(),
			diagnostics,
		}
	}

	const draws: VelloSceneDraw[] = []
	let artboardsSupported = true
	for (const artboard of input.artboards) {
		if (artboard.backgroundColor === undefined) continue
		const fill = cssColor(artboard.backgroundColor)
		if (fill === null) {
			artboardsSupported = false
			diagnostics.push({
				code: "artboard-color",
				message: `Artboard ${artboard.name} uses a CSS color outside the initial Vello color subset.`,
			})
			continue
		}
		draws.push({
			...rectangleCommands(
				`artboard:${artboard.id}`,
				artboard.x,
				artboard.y,
				artboard.width,
				artboard.height,
			),
			fill,
		})
	}
	if (!artboardsSupported)
		return {
			packet: null,
			packetJson: null,
			gpuObjectIds: new Set(),
			diagnostics,
		}

	const swatches = new Map(input.swatches.map((swatch) => [swatch.id, swatch]))
	const gpuObjectIds = new Set<string>()
	for (const object of input.objects) {
		if (object.hidden) continue
		if (input.maskedObjectIds?.has(object.id)) {
			diagnostics.push({
				code: "mask",
				objectId: object.id,
				message: `${object.name} stays on Konva because the first Vello slice does not submit masks.`,
			})
			continue
		}
		if (object.geometry.kind === "text") {
			diagnostics.push({
				code: "text",
				objectId: object.id,
				message: `${object.name} stays on Konva until shaped glyph paths cross the Vello scene boundary.`,
			})
			continue
		}
		if (object.geometry.kind === "image") {
			diagnostics.push({
				code: "image",
				objectId: object.id,
				message: `${object.name} stays on Konva until its texture is registered in the Vello atlas.`,
			})
			continue
		}
		if (object.geometry.kind === "artboard-link") {
			diagnostics.push({
				code: "linked-artboard",
				objectId: object.id,
				message: `${object.name} stays on Konva until linked-artboard textures are registered.`,
			})
			continue
		}
		const authoredStroke = object.appearance.stroke
		if (authoredStroke !== undefined && authoredStroke.dashArray.length > 0) {
			diagnostics.push({
				code: "stroke-dash",
				objectId: object.id,
				message: `${object.name} stays on Konva because dashed strokes are not in the first Vello packet ABI.`,
			})
			continue
		}
		const fillSwatch = swatches.get(object.appearance.fill?.swatchId ?? "")
		const strokeSwatch = swatches.get(authoredStroke?.swatchId ?? "")
		const fillRgb = fillSwatch === undefined ? null : resolvedRgb(fillSwatch)
		const strokeRgb =
			strokeSwatch === undefined ? null : resolvedRgb(strokeSwatch)
		const fill =
			fillRgb === null
				? null
				: ([fillRgb.r, fillRgb.g, fillRgb.b, 255] as const)
		const stroke =
			authoredStroke === undefined ||
			strokeRgb === null ||
			authoredStroke.width <= 0
				? null
				: {
						color: [strokeRgb.r, strokeRgb.g, strokeRgb.b, 255],
						width: velloPreservedStrokeWidth(
							authoredStroke.width,
							input.view.scale,
							ratio,
						),
						cap: authoredStroke.cap,
						join: authoredStroke.join,
						miterLimit: authoredStroke.miterLimit,
					}
		if (fill === null && stroke === null) continue
		const path = projectDesignObjectContours(object).flatMap(contourCommands)
		if (path.length === 0) continue
		draws.push({
			id: object.id,
			path,
			fillRule:
				object.geometry.kind === "path"
					? (object.geometry.fillRule ?? "evenodd")
					: "nonzero",
			fill,
			stroke,
		})
		gpuObjectIds.add(object.id)
	}
	// A DOM canvas cannot interleave GPU draws with unsupported Konva draws.
	// Preserve paint order by keeping the complete scene on Konva until every
	// visible object can cross this first packet ABI.
	if (diagnostics.length > 0)
		return {
			packet: null,
			packetJson: null,
			gpuObjectIds: new Set(),
			diagnostics,
		}
	const packet: VelloHybridScenePacket = {
		abiVersion: VELLO_HYBRID_SCENE_ABI_VERSION,
		width,
		height,
		view: [
			input.view.scale * ratio,
			0,
			0,
			input.view.scale * ratio,
			input.view.x * ratio,
			input.view.y * ratio,
		],
		draws,
	}
	return {
		packet,
		packetJson: JSON.stringify(packet),
		gpuObjectIds,
		diagnostics,
	}
}
