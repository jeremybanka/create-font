// @vitest-environment happy-dom

import { act, h, render } from "../../../../scripts/react-test-render.ts"
import { afterEach, describe, expect, it, vi } from "vitest"

import { TextEditingSurface } from "../src/TextEditingSurface.tsx"
import type { DesignTextLayout } from "@create-design/text"
import {
	createDesignTextObject,
	estimateDesignTextLayout,
	updateDesignAreaTextFrame,
	updateDesignText,
} from "../src/design-text.ts"

const hosts: HTMLElement[] = []
afterEach(() => {
	for (const host of hosts) render(null, host)
	hosts.length = 0
})

function object(mode: "point" | "area" = "point") {
	return createDesignTextObject({
		id: "object:text",
		name: "Accessible text",
		mode,
		x: 20,
		y: 40,
		width: 80,
		height: 40,
		appearance: { fill: { swatchId: "swatch:black" } },
	})
}

function layout(target = object()): DesignTextLayout {
	if (target.geometry.kind !== "text") throw new Error("Expected text.")
	const bounds =
		target.geometry.mode === "area" && target.geometry.frame !== undefined
			? {
					x: target.geometry.x,
					y: target.geometry.y,
					width: target.geometry.frame.width,
					height: target.geometry.frame.height,
				}
			: { x: target.geometry.x, y: 16, width: 80, height: 28 }
	return {
		objectId: target.id,
		font: {
			binaryHash: "fixture",
			faceIndex: 0,
			family: "Registered Fixture",
			key: "fixture",
			revision: 1,
			source: "font:fixture",
		},
		glyphs: [],
		lines: [],
		diagnostics: [],
		visibleTextEnd: target.geometry.text.length,
		overset: false,
		logicalBounds: bounds,
		inkBounds: null,
		bounds,
	}
}

describe("editable text surface", () => {
	it("uses a real native editor, isolates vector shortcuts, and reports selections", () => {
		const host = document.createElement("div")
		hosts.push(host)
		const onChange = vi.fn()
		const onExit = vi.fn()
		const onSelectionChange = vi.fn()
		render(
			h(TextEditingSurface, {
				object: updateDesignText(object(), "hello"),
				layout: layout(updateDesignText(object(), "hello")),
				registeredFamily: "Registered Fixture",
				view: { x: 0, y: 0 },
				worldScale: 1,
				onChange,
				onExit,
				onSelectionChange,
			}),
			host,
		)
		const textarea = host.querySelector("textarea")!
		expect(textarea.getAttribute("aria-label")).toContain("Accessible text")
		textarea.setSelectionRange(1, 4)
		act(() =>
			textarea.dispatchEvent(
				new KeyboardEvent("keyup", { key: "ArrowRight", bubbles: true }),
			),
		)
		expect(onSelectionChange).toHaveBeenLastCalledWith({ start: 1, end: 4 })
		const shortcut = new KeyboardEvent("keydown", { key: "v", bubbles: true })
		const parentShortcut = vi.fn()
		document.addEventListener("keydown", parentShortcut)
		act(() => textarea.dispatchEvent(shortcut))
		expect(parentShortcut).not.toHaveBeenCalled()
		document.removeEventListener("keydown", parentShortcut)
		act(() =>
			textarea.dispatchEvent(
				new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
			),
		)
		expect(onExit).toHaveBeenCalledOnce()
	})

	it("opens a transparent initial draft with the entire string selected", () => {
		const host = document.createElement("div")
		hosts.push(host)
		const draft = updateDesignText(object(), "Hello world")
		render(
			h(TextEditingSurface, {
				object: draft,
				layout: layout(draft),
				registeredFamily: "Registered Fixture",
				view: { x: 0, y: 0 },
				worldScale: 1,
				onChange: vi.fn(),
				onExit: vi.fn(),
				initialSelection: { start: 0, end: 11 },
			}),
			host,
		)
		const textarea = host.querySelector("textarea")!
		expect(textarea.value).toBe("Hello world")
		expect(textarea.selectionStart).toBe(0)
		expect(textarea.selectionEnd).toBe(11)
		expect(textarea.style.background).toBe("transparent")
	})

	it("keeps composition active until IME completion", () => {
		const host = document.createElement("div")
		hosts.push(host)
		const onChange = vi.fn()
		const onExit = vi.fn()
		render(
			h(TextEditingSurface, {
				object: object(),
				layout: layout(),
				registeredFamily: "Registered Fixture",
				view: { x: 0, y: 0 },
				worldScale: 1,
				onChange,
				onExit,
			}),
			host,
		)
		const textarea = host.querySelector("textarea")!
		act(() =>
			textarea.dispatchEvent(
				new CompositionEvent("compositionstart", { bubbles: true }),
			),
		)
		act(() =>
			textarea.dispatchEvent(
				new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
			),
		)
		expect(onExit).not.toHaveBeenCalled()
		textarea.value = "漢"
		act(() =>
			textarea.dispatchEvent(
				new CompositionEvent("compositionend", { bubbles: true }),
			),
		)
		expect(onChange).toHaveBeenLastCalledWith("漢")
	})

	it("uses the ready registered family, variation axes, and complete affine origin", () => {
		const host = document.createElement("div")
		hosts.push(host)
		const base = object("area")
		if (base.geometry.kind !== "text") throw new Error("Expected text.")
		const target = {
			...base,
			geometry: {
				...base.geometry,
				typography: {
					...base.geometry.typography,
					variations: { wght: 650, wdth: 90 },
				},
			},
			transform: { a: 0, b: 2, c: -3, d: 0, e: 7, f: 11 },
		}
		render(
			h(TextEditingSurface, {
				object: target,
				layout: layout(target),
				registeredFamily: "Registered Fixture",
				view: { x: 5, y: 9 },
				worldScale: 2,
				onChange: vi.fn(),
				onExit: vi.fn(),
			}),
			host,
		)
		const textarea = host.querySelector("textarea")!
		expect(textarea.style.fontFamily).toBe(`"Registered Fixture"`)
		expect(textarea.style.fontVariationSettings).toBe(`'wdth' 90, 'wght' 650`)
		expect(textarea.style.transform).toBe("matrix(0, 4, -6, 0, -269, 143)")
	})

	it("reflows area text without changing source and persistently reports overset", () => {
		const source = updateDesignText(
			object("area"),
			"one two three four five six",
		)
		if (source.geometry.kind !== "text") throw new Error("Expected text.")
		const small = estimateDesignTextLayout(source.geometry)
		const enlarged = updateDesignAreaTextFrame(source, { height: 400 })
		if (enlarged.geometry.kind !== "text") throw new Error("Expected text.")
		const large = estimateDesignTextLayout(enlarged.geometry)
		expect(source.geometry.text).toBe(enlarged.geometry.text)
		expect(small.overset).toBe(true)
		expect(large.overset).toBe(false)
	})
})
