import {
	designArtboardBorderColor,
	type DesignArtboard,
} from "@create-design/source"

export interface DesignArtboardCanvasChrome {
	readonly background?: string
	readonly border: Readonly<{
		x: number
		y: number
		width: number
		height: number
		stroke: string
		strokeWidth: number
	}>
	readonly label: Readonly<{
		x: number
		y: number
		width: number
		fontSize: number
		text: string
	}>
	readonly selection?: Readonly<{
		x: number
		y: number
		width: number
		height: number
		strokeWidth: number
	}>
}

function outsideStroke(
	artboard: DesignArtboard,
	strokeWidth: number,
	outsideInset = 0,
) {
	return Object.freeze({
		x: artboard.x - outsideInset - strokeWidth / 2,
		y: artboard.y - outsideInset - strokeWidth / 2,
		width: artboard.width + outsideInset * 2 + strokeWidth,
		height: artboard.height + outsideInset * 2 + strokeWidth,
		strokeWidth,
	})
}

/** Screen-constant, non-exported geometry around one paintable artboard. */
export function designArtboardCanvasChrome(
	artboard: DesignArtboard,
	worldScale: number,
	active: boolean,
): DesignArtboardCanvasChrome {
	const pixel = 1 / worldScale
	const border = outsideStroke(artboard, pixel)
	return Object.freeze({
		...(artboard.backgroundColor === undefined
			? {}
			: { background: artboard.backgroundColor }),
		border: Object.freeze({
			...border,
			stroke: designArtboardBorderColor(artboard),
		}),
		label: Object.freeze({
			x: artboard.x,
			y: artboard.y - 19 * pixel,
			width: artboard.width,
			fontSize: 12 * pixel,
			text: artboard.name,
		}),
		...(active ? { selection: outsideStroke(artboard, 2 * pixel, pixel) } : {}),
	})
}
