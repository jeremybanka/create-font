import { useMemo } from "preact/hooks"

import { useInferredColorPreference } from "./inferred-color-preference.ts"

export interface CanvasTheme {
	readonly surface: string
	readonly outline: string
	readonly guideStrong: string
	readonly guideMid: string
	readonly guideSoft: string
	readonly handleLine: string
	readonly nodeFill: string
	readonly nodeStroke: string
	readonly accent: string
	readonly previewInk: string
}

const fallbackTheme: CanvasTheme = Object.freeze({
	surface: "#171713",
	outline: "#f4f3ef",
	guideStrong: "#6f6b63",
	guideMid: "#48453f",
	guideSoft: "#34322e",
	handleLine: "#777269",
	nodeFill: "#171713",
	nodeStroke: "#f4f3ef",
	accent: "#df7655",
	previewInk: "#f4f3ef",
})

function readCanvasTheme(): CanvasTheme {
	if (
		typeof document === "undefined" ||
		typeof getComputedStyle === "undefined"
	) {
		return fallbackTheme
	}
	const styles = getComputedStyle(document.documentElement)
	const read = (name: string, fallback: string): string =>
		styles.getPropertyValue(name).trim() || fallback
	return Object.freeze({
		surface: read("--canvas-surface", fallbackTheme.surface),
		outline: read("--canvas-outline", fallbackTheme.outline),
		guideStrong: read("--canvas-guide-strong", fallbackTheme.guideStrong),
		guideMid: read("--canvas-guide-mid", fallbackTheme.guideMid),
		guideSoft: read("--canvas-guide-soft", fallbackTheme.guideSoft),
		handleLine: read("--canvas-handle-line", fallbackTheme.handleLine),
		nodeFill: read("--canvas-node-fill", fallbackTheme.nodeFill),
		nodeStroke: read("--canvas-node-stroke", fallbackTheme.nodeStroke),
		accent: read("--canvas-accent", fallbackTheme.accent),
		previewInk: read("--preview-ink", fallbackTheme.previewInk),
	})
}

/** Keeps Konva's imperative color props in sync with CSS media-query tokens. */
export function useCanvasTheme(): CanvasTheme {
	const preference = useInferredColorPreference()
	return useMemo(readCanvasTheme, [preference])
}
