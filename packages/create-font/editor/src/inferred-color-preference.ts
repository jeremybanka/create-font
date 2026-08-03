import { useEffect, useState } from "react"

export type InferredColorPreference = "dark" | "light"

export const COLOR_PREFERENCE_QUERY = "(prefers-color-scheme: light)"
export const FALLBACK_COLOR_PREFERENCE: InferredColorPreference = "dark"

export function readInferredColorPreference(): InferredColorPreference {
	if (
		typeof window === "undefined" ||
		typeof window.matchMedia !== "function"
	) {
		return FALLBACK_COLOR_PREFERENCE
	}
	return window.matchMedia(COLOR_PREFERENCE_QUERY).matches ? "light" : "dark"
}

export function subscribeToInferredColorPreference(
	listener: (preference: InferredColorPreference) => void,
): () => void {
	if (
		typeof window === "undefined" ||
		typeof window.matchMedia !== "function"
	) {
		return () => undefined
	}
	const query = window.matchMedia(COLOR_PREFERENCE_QUERY)
	const update = (): void => listener(query.matches ? "light" : "dark")
	query.addEventListener("change", update)
	update()
	return () => query.removeEventListener("change", update)
}

/** One live source for every UI surface that follows the system color preference. */
export function useInferredColorPreference(): InferredColorPreference {
	const [preference, setPreference] = useState(readInferredColorPreference)
	useEffect(() => subscribeToInferredColorPreference(setPreference), [])
	return preference
}
