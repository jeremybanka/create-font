import {
	designLayerUiColorAt,
	type DesignLayerUiColor,
} from "@create-design/source"

export const DESIGN_LAYER_UI_COLOR_CSS = Object.freeze({
	red: "#e5484d",
	blue: "#0091ff",
	yellow: "#f5d90a",
	purple: "#8e4ec6",
	green: "#30a46c",
	pink: "#d6409f",
	cyan: "#00a2c7",
	orange: "#f76808",
	indigo: "#3e63dd",
	lime: "#99d52a",
	magenta: "#ab4aba",
	teal: "#0e9888",
}) satisfies Readonly<Record<DesignLayerUiColor, string>>

export function designLayerUiColorCss(
	uiColor: DesignLayerUiColor | undefined,
	index = 0,
): string {
	return DESIGN_LAYER_UI_COLOR_CSS[uiColor ?? designLayerUiColorAt(index)]
}
