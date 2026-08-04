// @vitest-environment happy-dom

import { act, h, render } from "../../../../scripts/react-test-render.ts"
import { afterEach, describe, expect, it, vi } from "vitest"

import { DesignFontCombobox } from "../src/DesignFontCombobox.tsx"

const host = document.createElement("div")

afterEach(() => render(null, host))

const fonts = [
	{ id: "font:inter", family: "Inter", revision: 1 },
	{ id: "font:source-serif", family: "Source Serif", revision: 2 },
]

describe("workspace font combobox", () => {
	it("filters indexed fonts and supports keyboard selection", () => {
		const onSelect = vi.fn()
		act(() =>
			render(
				h(DesignFontCombobox, {
					fonts,
					label: "Font family",
					onSelect,
					selectedFontId: fonts[0]!.id,
				}),
				host,
			),
		)
		const input = host.querySelector<HTMLInputElement>('[role="combobox"]')!
		act(() => input.focus())
		act(() => {
			Object.getOwnPropertyDescriptor(
				HTMLInputElement.prototype,
				"value",
			)?.set?.call(input, "serif")
			input.dispatchEvent(new InputEvent("input", { bubbles: true }))
		})
		const options = [...host.querySelectorAll('[role="option"]')]
		expect(options.map(({ textContent }) => textContent)).toEqual([
			"Source Seriffont:source-serif",
		])
		act(() =>
			input.dispatchEvent(
				new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
			),
		)
		act(() =>
			input.dispatchEvent(
				new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
			),
		)
		expect(onSelect).toHaveBeenCalledWith("font:source-serif")
	})

	it("remains visible and disabled when the workspace has no fonts", () => {
		act(() =>
			render(
				h(DesignFontCombobox, {
					disabled: true,
					fonts: [],
					label: "Font family",
					onSelect: vi.fn(),
					selectedFontId: null,
				}),
				host,
			),
		)
		const input = host.querySelector<HTMLInputElement>('[role="combobox"]')!
		expect(input.disabled).toBe(true)
		expect(input.placeholder).toBe("No workspace fonts available")
	})
})
