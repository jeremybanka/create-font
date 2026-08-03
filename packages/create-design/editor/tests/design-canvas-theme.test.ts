// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from "vitest"

import {
	designCanvasThemeFromStyle,
	readDesignCanvasTheme,
	subscribeToDesignCanvasTheme,
} from "../src/design-canvas-theme.ts"

const originalMatchMedia = window.matchMedia

afterEach(() => {
	window.matchMedia = originalMatchMedia
	document.documentElement.removeAttribute("style")
})

describe("design canvas theme", () => {
	it("reads every imperative canvas overlay from CSS tokens", () => {
		const tokens = new Map([
			["--design-canvas-artboard-outline", "#706d65"],
			["--design-canvas-artboard-shadow", "#3d3b36"],
			["--design-canvas-artboard-shadow-opacity", "0.2"],
			["--design-canvas-guide", "#0577aa"],
			["--design-canvas-handle-fill", "#fff"],
			["--design-canvas-selection", "#ce5d3d"],
		])
		expect(
			designCanvasThemeFromStyle({
				getPropertyValue: (name) => tokens.get(name) ?? "",
			}),
		).toEqual({
			artboardOutline: "#706d65",
			artboardShadow: "#3d3b36",
			artboardShadowOpacity: 0.2,
			guide: "#0577aa",
			handleFill: "#fff",
			selection: "#ce5d3d",
		})
	})

	it("publishes fresh CSS token values when system appearance changes", () => {
		let change: (() => void) | undefined
		window.matchMedia = () =>
			({
				matches: false,
				media: "(prefers-color-scheme: light)",
				onchange: null,
				addEventListener: (
					_type: string,
					listener: EventListenerOrEventListenerObject,
				) => {
					change =
						typeof listener === "function"
							? () => listener(new Event("change"))
							: () => listener.handleEvent(new Event("change"))
				},
				removeEventListener: () => undefined,
				addListener: () => undefined,
				removeListener: () => undefined,
				dispatchEvent: () => true,
			}) satisfies MediaQueryList

		document.documentElement.style.setProperty(
			"--design-canvas-selection",
			"#e17352",
		)
		const themes: string[] = []
		const unsubscribe = subscribeToDesignCanvasTheme((theme) =>
			themes.push(theme.selection),
		)
		expect(readDesignCanvasTheme().selection).toBe("#e17352")
		document.documentElement.style.setProperty(
			"--design-canvas-selection",
			"#ce5d3d",
		)
		change?.()
		unsubscribe()

		expect(themes).toEqual(["#e17352", "#ce5d3d"])
	})
})
