import { useEffect, useState } from "preact/hooks"

export interface DesignCanvasTheme {
	readonly artboardOutline: string
	readonly artboardShadow: string
	readonly artboardShadowOpacity: number
	readonly guide: string
	readonly handleFill: string
	readonly selection: string
}

const fallbackTheme: DesignCanvasTheme = Object.freeze({
	artboardOutline: "#8e8c85",
	artboardShadow: "#000",
	artboardShadowOpacity: 0.36,
	guide: "#36a8e0",
	handleFill: "#fff",
	selection: "#e17352",
})

const COLOR_SCHEME_QUERY = "(prefers-color-scheme: light)"

export function designCanvasThemeFromStyle(
	styles: Pick<CSSStyleDeclaration, "getPropertyValue">,
): DesignCanvasTheme {
	const read = (name: string, fallback: string): string =>
		styles.getPropertyValue(name).trim() || fallback
	const opacity = Number(
		read(
			"--design-canvas-artboard-shadow-opacity",
			String(fallbackTheme.artboardShadowOpacity),
		),
	)
	return Object.freeze({
		artboardOutline: read(
			"--design-canvas-artboard-outline",
			fallbackTheme.artboardOutline,
		),
		artboardShadow: read(
			"--design-canvas-artboard-shadow",
			fallbackTheme.artboardShadow,
		),
		artboardShadowOpacity: Number.isFinite(opacity)
			? opacity
			: fallbackTheme.artboardShadowOpacity,
		guide: read("--design-canvas-guide", fallbackTheme.guide),
		handleFill: read("--design-canvas-handle-fill", fallbackTheme.handleFill),
		selection: read("--design-canvas-selection", fallbackTheme.selection),
	})
}

export function readDesignCanvasTheme(): DesignCanvasTheme {
	if (
		typeof document === "undefined" ||
		typeof getComputedStyle === "undefined"
	)
		return fallbackTheme
	return designCanvasThemeFromStyle(getComputedStyle(document.documentElement))
}

export function subscribeToDesignCanvasTheme(
	listener: (theme: DesignCanvasTheme) => void,
): () => void {
	const publish = (): void => listener(readDesignCanvasTheme())
	if (
		typeof window === "undefined" ||
		typeof window.matchMedia !== "function"
	) {
		publish()
		return () => undefined
	}
	const query = window.matchMedia(COLOR_SCHEME_QUERY)
	query.addEventListener("change", publish)
	publish()
	return () => query.removeEventListener("change", publish)
}

/** Keeps Konva's imperative colors synchronized with live CSS media queries. */
export function useDesignCanvasTheme(): DesignCanvasTheme {
	const [theme, setTheme] = useState(readDesignCanvasTheme)
	useEffect(() => subscribeToDesignCanvasTheme(setTheme), [])
	return theme
}
