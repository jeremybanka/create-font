// @vitest-environment happy-dom

import { act, h, render } from "../../../../scripts/react-test-render.ts"
import { afterEach, describe, expect, it, vi } from "vitest"

import { ActionHotbar } from "../src/ActionHotbar.tsx"
import type { HotbarSlots } from "../src/command-assignment.ts"
import type { PaletteCommand } from "../src/command-palette.ts"

const hosts: HTMLElement[] = []
const emptySlots: HotbarSlots = Array.from({ length: 12 }, () => null)

afterEach(() => {
	for (const host of hosts) {
		render(null, host)
		host.remove()
	}
	hosts.length = 0
})

function host(): HTMLElement {
	const element = document.createElement("section")
	document.body.append(element)
	hosts.push(element)
	return element
}

describe("alternate action hotbar", () => {
	it("stays mounted and inert until Alt routes number keys to it", () => {
		const primary = vi.fn()
		const alternate = vi.fn()
		const commands: readonly PaletteCommand[] = [
			{
				id: "primary",
				displayName: "Primary action",
				category: "Test",
				icon: "CursorArrowIcon",
				do: primary,
			},
			{
				id: "alternate",
				displayName: "Alternate action",
				category: "Test",
				icon: "PlusIcon",
				do: alternate,
			},
		]
		const primarySlots = ["primary", ...emptySlots.slice(1)]
		const alternateSlots = ["alternate", ...emptySlots.slice(1)]
		const element = host()
		act(() => {
			render(
				h(ActionHotbar, {
					alternateSlots,
					commands,
					enabled: true,
					paletteOpen: false,
					slots: primarySlots,
					onAlternateAssignCommand: vi.fn(),
					onAlternateSlotsChange: vi.fn(),
					onAssignCommand: vi.fn(),
					onOpenCommands: vi.fn(),
					onSlotsChange: vi.fn(),
				}),
				element,
			)
		})

		const alternateBar = element.querySelector<HTMLElement>(
			'action-hotbar[data-hotbar-kind="alternate"]',
		)
		expect(alternateBar?.getAttribute("aria-hidden")).toBe("true")
		expect(alternateBar?.hasAttribute("inert")).toBe(true)

		act(() => {
			window.dispatchEvent(
				new KeyboardEvent("keydown", {
					altKey: true,
					bubbles: true,
					code: "AltLeft",
					key: "Alt",
				}),
			)
		})
		expect(alternateBar?.getAttribute("data-visible")).toBe("true")
		expect(alternateBar?.hasAttribute("aria-hidden")).toBe(false)
		expect(alternateBar?.hasAttribute("inert")).toBe(false)

		act(() => {
			window.dispatchEvent(
				new KeyboardEvent("keydown", {
					altKey: true,
					bubbles: true,
					code: "Digit1",
					key: "1",
				}),
			)
		})
		expect(alternate).toHaveBeenCalledOnce()
		expect(primary).not.toHaveBeenCalled()

		act(() => {
			window.dispatchEvent(
				new KeyboardEvent("keyup", {
					bubbles: true,
					code: "AltLeft",
					key: "Alt",
				}),
			)
			window.dispatchEvent(
				new KeyboardEvent("keydown", {
					bubbles: true,
					code: "Digit1",
					key: "1",
				}),
			)
		})
		expect(alternateBar?.getAttribute("aria-hidden")).toBe("true")
		expect(primary).toHaveBeenCalledOnce()
	})

	it("recovers hidden modifier state on blur", () => {
		const element = host()
		act(() => {
			render(
				h(ActionHotbar, {
					alternateSlots: emptySlots,
					commands: [],
					enabled: true,
					paletteOpen: false,
					slots: emptySlots,
					onAlternateAssignCommand: vi.fn(),
					onAlternateSlotsChange: vi.fn(),
					onAssignCommand: vi.fn(),
					onOpenCommands: vi.fn(),
					onSlotsChange: vi.fn(),
				}),
				element,
			)
		})
		act(() => {
			window.dispatchEvent(
				new KeyboardEvent("keydown", {
					altKey: true,
					code: "AltRight",
					key: "Alt",
				}),
			)
		})
		const alternateBar = element.querySelector<HTMLElement>(
			'action-hotbar[data-hotbar-kind="alternate"]',
		)
		expect(alternateBar?.getAttribute("data-visible")).toBe("true")
		act(() => window.dispatchEvent(new Event("blur")))
		expect(alternateBar?.getAttribute("aria-hidden")).toBe("true")
	})
})
