/** Ordered, symbolic editor-only colors available to authored layers. */
export const DESIGN_LAYER_UI_COLORS = [
	"red",
	"blue",
	"yellow",
	"purple",
	"green",
	"pink",
	"cyan",
	"orange",
	"indigo",
	"lime",
	"magenta",
	"teal",
] as const

export type DesignLayerUiColor = (typeof DESIGN_LAYER_UI_COLORS)[number]

export function designLayerUiColorAt(index: number): DesignLayerUiColor {
	const normalized = Number.isFinite(index) ? Math.max(0, Math.floor(index)) : 0
	return DESIGN_LAYER_UI_COLORS[normalized % DESIGN_LAYER_UI_COLORS.length]!
}

export function nextDesignLayerUiColor(
	colors: readonly (DesignLayerUiColor | undefined)[],
): DesignLayerUiColor {
	const used = new Set(colors)
	return (
		DESIGN_LAYER_UI_COLORS.find((color) => !used.has(color)) ??
		designLayerUiColorAt(colors.length)
	)
}
