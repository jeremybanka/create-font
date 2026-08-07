export const DESIGN_CANVAS_DIMMER_STORAGE_KEY = "create-design:canvas-dimmer:v1"

export const DARK_DESIGN_CANVAS_DIMMER = 17
export const LIGHT_DESIGN_CANVAS_DIMMER = 217

export type CanvasDimmerPreference =
	| Readonly<{ kind: "system" }>
	| Readonly<{ kind: "explicit"; value: number }>

const COLOR_SCHEME_QUERY = "(prefers-color-scheme: light)"

function parseCanvasDimmer(value: unknown): number | null {
	const number =
		typeof value === "number"
			? value
			: typeof value === "string" && value.trim() !== ""
				? Number(value)
				: Number.NaN
	if (!Number.isFinite(number) || number < 0 || number > 255) return null
	return Math.round(number)
}

export function normalizeCanvasDimmer(value: unknown): number {
	return parseCanvasDimmer(value) ?? DARK_DESIGN_CANVAS_DIMMER
}

export function canvasDimmerHex(value: number): string {
	const channel = normalizeCanvasDimmer(value).toString(16).padStart(2, "0")
	return `#${channel}${channel}${channel}`
}

export function canvasDimmerPercent(value: number): number {
	return Math.round((normalizeCanvasDimmer(value) / 255) * 100)
}

export function readCanvasDimmerPreference(
	storage: Pick<Storage, "getItem"> | null,
): CanvasDimmerPreference {
	if (storage === null) return { kind: "system" }
	try {
		const stored = storage.getItem(DESIGN_CANVAS_DIMMER_STORAGE_KEY)
		const value = stored === null ? null : parseCanvasDimmer(stored)
		return value === null ? { kind: "system" } : { kind: "explicit", value }
	} catch {
		return { kind: "system" }
	}
}

export function resolveCanvasDimmer(
	preference: CanvasDimmerPreference,
	prefersLight: boolean,
): number {
	return preference.kind === "explicit"
		? preference.value
		: prefersLight
			? LIGHT_DESIGN_CANVAS_DIMMER
			: DARK_DESIGN_CANVAS_DIMMER
}

export function writeCanvasDimmerPreference(
	storage: Pick<Storage, "setItem"> | null,
	preference: CanvasDimmerPreference,
): boolean {
	if (storage === null || preference.kind !== "explicit") return false
	try {
		storage.setItem(DESIGN_CANVAS_DIMMER_STORAGE_KEY, String(preference.value))
		return true
	} catch {
		return false
	}
}

export function browserPrefersLightColorScheme(): boolean {
	if (typeof window === "undefined" || typeof window.matchMedia !== "function")
		return true
	try {
		return window.matchMedia(COLOR_SCHEME_QUERY).matches
	} catch {
		return true
	}
}

export function subscribeToPreferredColorScheme(
	listener: (prefersLight: boolean) => void,
): () => void {
	if (typeof window === "undefined" || typeof window.matchMedia !== "function")
		return () => undefined
	try {
		const query = window.matchMedia(COLOR_SCHEME_QUERY)
		const publish = (): void => listener(query.matches)
		query.addEventListener("change", publish)
		publish()
		return () => query.removeEventListener("change", publish)
	} catch {
		return () => undefined
	}
}

export type DesignCanvasDimmerTokens = Readonly<{
	surface: string
	gridLine: string
	rulerSurface: string
	rulerLine: string
	rulerInk: string
	hudSurface: string
	hudLine: string
	hudInk: string
	artboardLabel: string
	guide: string
	marquee: string
	selection: string
	handleFill: string
}>

/** Keeps editor chrome legible without adapting authored artboard or object paint. */
export function canvasDimmerTokens(value: number): DesignCanvasDimmerTokens {
	const normalized = normalizeCanvasDimmer(value)
	const darkChrome = normalized >= 128
	return Object.freeze({
		surface: canvasDimmerHex(normalized),
		gridLine: darkChrome ? "rgb(0 0 0 / 10%)" : "rgb(255 255 255 / 8%)",
		rulerSurface: darkChrome ? "rgb(255 255 255 / 88%)" : "rgb(0 0 0 / 82%)",
		rulerLine: darkChrome ? "#5b5b5b" : "#a8a8a8",
		rulerInk: darkChrome ? "#242424" : "#eeeeee",
		hudSurface: darkChrome ? "#f5f5f5" : "#151515",
		hudLine: darkChrome ? "#6a6a6a" : "#b5b5b5",
		hudInk: darkChrome ? "#171717" : "#f2f2f2",
		artboardLabel: darkChrome ? "#171717" : "#f2f2f2",
		guide: darkChrome ? "#005f8f" : "#62c8f5",
		marquee: darkChrome ? "#171717" : "#f2f2f2",
		selection: darkChrome ? "#a63316" : "#ff9879",
		handleFill: darkChrome ? "#ffffff" : "#111111",
	})
}
