import { vectorObjectPath } from "@create-art/editor"
import { designObjectFillRule, swatchCss } from "@create-design/model"

import { projectDesignVectorRenderObject } from "./design-vector-adapter.ts"
import type { DesignArtboard, DesignDocument, DesignObject } from "./types.ts"

export type DesignPreviewDiagnostic = Readonly<{
	code: "clipping-mask" | "image" | "text-layout" | "unknown-geometry"
	objectId: string
	message: string
}>

export type DesignPreviewPaint = Readonly<{
	color: string
}>

export type DesignPreviewStroke = Readonly<{
	color: string
	width: number
	cap: "butt" | "round" | "square"
	join: "miter" | "round" | "bevel"
	miterLimit: number
	dashArray: readonly number[]
	dashOffset: number
}>

export type DesignPreviewPath = Readonly<{
	id: string
	pathData: string
	fillRule: "evenodd" | "nonzero"
	fill?: DesignPreviewPaint
	stroke?: DesignPreviewStroke
}>

export type DesignPreviewArtboard = Readonly<{
	id: string
	x: number
	y: number
	width: number
	height: number
	background?: string
}>

export type DesignPreviewScene = Readonly<{
	revision: string
	artboards: readonly DesignPreviewArtboard[]
	paths: readonly DesignPreviewPath[]
	diagnostics: readonly DesignPreviewDiagnostic[]
	supported: boolean
}>

export type DesignPreviewSceneInput = Readonly<{
	document: Pick<DesignDocument, "swatches">
	artboards: readonly (DesignArtboard & Readonly<{ background?: string }>)[]
	objects: readonly DesignObject[]
	maskedObjectIds?: ReadonlySet<string>
}>

function unsupportedGeometry(
	object: DesignObject,
): DesignPreviewDiagnostic | null {
	switch (object.geometry.kind) {
		case "image":
			return {
				code: "image",
				objectId: object.id,
				message: `${object.name} is a placed image. CanvasKit image decoding is not enabled in this preview yet.`,
			}
		case "text":
			return {
				code: "text-layout",
				objectId: object.id,
				message: `${object.name} does not have canonical glyph outlines available.`,
			}
		case "artboard-link":
			return {
				code: "unknown-geometry",
				objectId: object.id,
				message: `${object.name} contains an unresolved linked artboard.`,
			}
		default:
			return null
	}
}

export function projectDesignPreviewScene(
	input: DesignPreviewSceneInput,
): DesignPreviewScene {
	const diagnostics: DesignPreviewDiagnostic[] = []
	const paths: DesignPreviewPath[] = []
	for (const object of input.objects) {
		if (object.hidden) continue
		if (input.maskedObjectIds?.has(object.id) === true) {
			diagnostics.push({
				code: "clipping-mask",
				objectId: object.id,
				message: `${object.name} uses a clipping mask, which remains on the Konva renderer.`,
			})
			continue
		}
		const unsupported = unsupportedGeometry(object)
		if (unsupported !== null) {
			diagnostics.push(unsupported)
			continue
		}
		const fillSwatch = input.document.swatches.find(
			(swatch) => swatch.id === object.appearance.fill?.swatchId,
		)
		const strokeStyle = object.appearance.stroke
		const strokeSwatch = input.document.swatches.find(
			(swatch) => swatch.id === strokeStyle?.swatchId,
		)
		const fill =
			fillSwatch === undefined || object.appearance.fill === undefined
				? undefined
				: { color: swatchCss(fillSwatch) }
		const stroke =
			strokeSwatch === undefined ||
			strokeStyle === undefined ||
			strokeStyle.width === 0
				? undefined
				: {
						color: swatchCss(strokeSwatch),
						width: strokeStyle.width,
						cap: strokeStyle.cap,
						join: strokeStyle.join,
						miterLimit: strokeStyle.miterLimit,
						dashArray: [...strokeStyle.dashArray],
						dashOffset: strokeStyle.dashOffset,
					}
		if (fill === undefined && stroke === undefined) continue
		paths.push({
			id: object.id,
			pathData: vectorObjectPath(
				projectDesignVectorRenderObject(input.document, object),
			),
			fillRule: designObjectFillRule(object),
			...(fill === undefined ? {} : { fill }),
			...(stroke === undefined ? {} : { stroke }),
		})
	}
	const artboards = input.artboards.map(
		({ id, x, y, width, height, background }) => ({
			id,
			x,
			y,
			width,
			height,
			...(background === undefined ? {} : { background }),
		}),
	)
	return {
		revision: JSON.stringify({ artboards, paths }),
		artboards,
		paths,
		diagnostics,
		supported: diagnostics.length === 0,
	}
}
