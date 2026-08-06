// @vitest-environment happy-dom

import { act, h, render } from "../../../../scripts/react-test-render.ts"
import { afterEach, describe, expect, it, vi } from "vitest"

import { TooltipButton } from "../src/TooltipButton.tsx"

const hosts: HTMLElement[] = []

afterEach(() => {
	vi.useRealTimers()
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

describe("shared tooltip button", () => {
	it("exposes its name and shortcut while keeping rich help dismissible", async () => {
		vi.useFakeTimers()
		const element = host()
		render(
			h(TooltipButton, {
				children: h("svg", { "aria-hidden": "true" }),
				description: "Draw and edit artboards on the canvas.",
				label: "Artboard",
				shortcut: { ariaKeyShortcuts: "B", keycaps: ["B"] },
			}),
			element,
		)
		const button = element.querySelector("button")
		if (button === null) throw new Error("Tooltip trigger was not rendered.")
		expect(button.getAttribute("aria-label")).toBe("Artboard")
		expect(button.getAttribute("aria-keyshortcuts")).toBe("B")
		expect(button.hasAttribute("title")).toBe(false)

		await act(async () => {
			button.focus()
			await vi.advanceTimersByTimeAsync(500)
		})
		const tooltip = element.querySelector('[role="tooltip"]')
		expect(tooltip?.textContent).toContain("Artboard")
		expect(tooltip?.textContent).toContain(
			"Draw and edit artboards on the canvas.",
		)
		expect(tooltip?.querySelector("kbd")?.textContent).toBe("B")
		expect(button.getAttribute("aria-describedby")).toBe(tooltip?.id)

		await act(async () => {
			window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))
		})
		expect(element.querySelector('[role="tooltip"]')).toBeNull()
	})

	it("makes an explained disabled control focusable as an unavailable group", () => {
		const element = host()
		render(
			h(TooltipButton, {
				children: "T",
				description: "Place point text.",
				disabled: true,
				disabledReason: "Load a text service before using text tools.",
				label: "Type",
			}),
			element,
		)
		const wrapper = element.querySelector<HTMLElement>("tooltip-button")
		const button = element.querySelector("button")
		expect(wrapper?.getAttribute("role")).toBe("group")
		expect(wrapper?.getAttribute("aria-label")).toBe("Type unavailable")
		expect(wrapper?.getAttribute("aria-disabled")).toBe("true")
		expect(wrapper?.tabIndex).toBe(0)
		expect(button?.disabled).toBe(true)
		expect(button?.getAttribute("aria-hidden")).toBe("true")
	})
})
