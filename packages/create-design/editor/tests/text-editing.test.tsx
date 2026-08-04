// @vitest-environment happy-dom

import { act, h, render } from "../../../../scripts/react-test-render.ts"
import { afterEach, describe, expect, it, vi } from "vitest"

import { TextEditingSurface } from "../src/TextEditingSurface.tsx"
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

	it("keeps composition active until IME completion", () => {
		const host = document.createElement("div")
		hosts.push(host)
		const onChange = vi.fn()
		const onExit = vi.fn()
		render(
			h(TextEditingSurface, {
				object: object(),
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
