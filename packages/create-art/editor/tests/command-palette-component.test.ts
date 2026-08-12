// @vitest-environment happy-dom

import { act, h, render } from "../../../../scripts/react-test-render.ts"
import { afterEach, describe, expect, it, vi } from "vitest"

import { CommandPalette } from "../src/CommandPalette.tsx"
import type { PaletteCommand } from "../src/command-palette.ts"

const hosts: HTMLElement[] = []
const commands: readonly PaletteCommand[] = ["Alpha", "Beta", "Gamma"].map(
	(name) => ({
		id: name.toLowerCase(),
		displayName: name,
		category: "Test",
		icon: "PlusIcon",
		do: vi.fn(),
	}),
)

afterEach(() => {
	for (const host of hosts) {
		render(null, host)
		host.remove()
	}
	hosts.length = 0
})

function bounds(top: number, bottom: number): DOMRect {
	return {
		bottom,
		height: bottom - top,
		left: 0,
		right: 300,
		top,
		width: 300,
		x: 0,
		y: top,
		toJSON: () => ({}),
	}
}

describe("CommandPalette active descendant", () => {
	it("keeps keyboard navigation visible without reacting to pointer selection", () => {
		const host = document.createElement("section")
		document.body.append(host)
		hosts.push(host)
		act(() => {
			render(
				h(CommandPalette, {
					commands,
					onAssign: vi.fn(),
					onCancel: vi.fn(),
					onExecute: vi.fn(),
				}),
				host,
			)
		})
		const input = host.querySelector<HTMLInputElement>(
			'input[aria-label="Search commands"]',
		)
		const results = host.querySelector<HTMLElement>("command-results")
		const beta = document.getElementById("command-beta")
		const gamma = document.getElementById("command-gamma")
		if (input === null || results === null || beta === null || gamma === null)
			throw new Error("Command Palette did not render its options.")
		results.getBoundingClientRect = () => bounds(100, 300)
		beta.getBoundingClientRect = () => bounds(280, 340)
		gamma.getBoundingClientRect = () => bounds(320, 380)

		act(() => {
			input.dispatchEvent(
				new KeyboardEvent("keydown", {
					bubbles: true,
					key: "ArrowDown",
				}),
			)
		})
		expect(input.getAttribute("aria-activedescendant")).toBe("command-beta")
		expect(results.scrollTop).toBe(40)

		act(() =>
			gamma.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })),
		)
		expect(input.getAttribute("aria-activedescendant")).toBe("command-gamma")
		expect(results.scrollTop).toBe(40)

		results.scrollTop = 200
		act(() => {
			input.value = "Alpha"
			input.dispatchEvent(new InputEvent("input", { bubbles: true }))
		})
		expect(results.scrollTop).toBe(0)
		expect(input.getAttribute("aria-activedescendant")).toBe("command-alpha")
	})
})
