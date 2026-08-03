// @vitest-environment happy-dom

import { h, render } from "preact"
import { afterEach, describe, expect, it, vi } from "vitest"

import { TileButton } from "../src/TileButton.tsx"
import { TileCheckbox } from "../src/TileCheckbox.tsx"
import { TileNumericField } from "../src/TileNumericField.tsx"
import { TileSelect } from "../src/TileSelect.tsx"
import { TileTextField } from "../src/TileTextField.tsx"

const hosts: HTMLElement[] = []

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

describe("shared tile controls", () => {
	it("exposes consistent button tones and interaction states", () => {
		const element = host()
		render(
			h("div", {}, [
				h(TileButton, { children: "Action", "aria-pressed": true }),
				h(TileButton, { children: "Save", tone: "primary" }),
				h(TileButton, { children: "Delete", tone: "danger", disabled: true }),
			]),
			element,
		)
		const buttons = element.querySelectorAll("button")
		expect(buttons[0]?.getAttribute("aria-pressed")).toBe("true")
		expect(buttons[1]?.dataset.tone).toBe("primary")
		expect(buttons[2]?.dataset.tone).toBe("danger")
		expect(buttons[2]?.disabled).toBe(true)
	})

	it("associates labels, help, errors, and disabled states", () => {
		const element = host()
		render(
			h("div", {}, [
				h(TileTextField, {
					description: "Shown in the layer list.",
					label: "Name",
					value: "Rectangle",
				}),
				h(
					TileSelect,
					{ error: "Choose a target.", label: "Target", value: "selection" },
					h("option", { value: "selection" }, "Selection"),
				),
				h(TileCheckbox, {
					checked: true,
					disabled: true,
					label: "Constrain",
				}),
			]),
			element,
		)
		const name = element.querySelector<HTMLInputElement>(
			'tile-text-field input:not([type="checkbox"])',
		)
		const select = element.querySelector("select")
		const checkbox = element.querySelector<HTMLInputElement>(
			'input[type="checkbox"]',
		)
		expect(name?.closest("label")?.textContent).toContain("Name")
		expect(name?.getAttribute("aria-describedby")).not.toBeNull()
		expect(select?.getAttribute("aria-invalid")).toBe("true")
		expect(checkbox?.disabled).toBe(true)
	})

	it("composes the shared transactional numeric input", () => {
		const element = host()
		const onCommit = vi.fn()
		render(
			h(TileNumericField, {
				label: "Width",
				min: 0,
				onCommit,
				value: 100,
			}),
			element,
		)
		const input = element.querySelector<HTMLInputElement>(
			'input[aria-label="Width"]',
		)
		expect(input?.getAttribute("role")).toBe("spinbutton")
		expect(input?.closest("label")?.textContent).toContain("Width")
	})
})
