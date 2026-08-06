import { useEffect, useState } from "react"

export interface DesignCanvasTheme {
	readonly artboardLabel: string
	readonly guide: string
	readonly handleFill: string
	readonly marquee: string
	readonly selection: string
}

const fallbackTheme: DesignCanvasTheme = Object.freeze({
	artboardLabel: "#aaa79f",
	guide: "#36a8e0",
	handleFill: "#fff",
	marquee: "#737373",
	selection: "#e17352",
})

const COLOR_SCHEME_QUERY = "(prefers-color-scheme: light)"

export function designCanvasThemeFromStyle(
	styles: Pick<CSSStyleDeclaration, "getPropertyValue">,
): DesignCanvasTheme {
	const read = (name: string, fallback: string): string =>
		styles.getPropertyValue(name).trim() || fallback
	return Object.freeze({
		artboardLabel: read(
			"--design-canvas-artboard-label",
			fallbackTheme.artboardLabel,
		),
		guide: read("--design-canvas-guide", fallbackTheme.guide),
		handleFill: read("--design-canvas-handle-fill", fallbackTheme.handleFill),
		marquee: read("--design-canvas-marquee", fallbackTheme.marquee),
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
