import type { DesignArtboard } from "./types.ts"

export const DEFAULT_DESIGN_ARTBOARD_BORDER_COLOR = "#767676"

export function designArtboardBorderColor(artboard: DesignArtboard): string {
	return artboard.borderColor ?? DEFAULT_DESIGN_ARTBOARD_BORDER_COLOR
}

export function designHexColorChannels(color: string): Readonly<{
	r: number
	g: number
	b: number
}> {
	return Object.freeze({
		r: Number.parseInt(color.slice(1, 3), 16),
		g: Number.parseInt(color.slice(3, 5), 16),
		b: Number.parseInt(color.slice(5, 7), 16),
	})
}
