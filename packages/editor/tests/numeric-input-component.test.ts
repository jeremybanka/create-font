// @vitest-environment happy-dom

import { h, render } from "preact"
import { act } from "preact/test-utils"
import { afterEach, describe, expect, it, vi } from "vitest"

import { NumericInput, type NumericInputProps } from "../src/NumericInput.tsx"

const hosts: HTMLElement[] = []

afterEach(() => {
	for (const host of hosts) {
		render(null, host)
		host.remove()
	}
	hosts.length = 0
})

function mount(overrides: Partial<NumericInputProps> = {}): {
	input: HTMLInputElement
	output: HTMLOutputElement
	onCommit: ReturnType<typeof vi.fn>
} {
	const host = document.createElement("section")
	document.body.append(host)
	hosts.push(host)
	const onCommit = vi.fn()
	render(
		h(NumericInput, {
			"aria-label": "Test value",
			value: 10,
			min: 0,
			max: 100,
			onCommit,
			...overrides,
		}),
		host,
	)
	const input = host.querySelector("input")
	const output = host.querySelector("output")
	if (
		!(input instanceof HTMLInputElement) ||
		!(output instanceof HTMLOutputElement)
	)
		throw new Error("NumericInput did not render its controls")
	return { input, output, onCommit }
}

function focus(input: HTMLInputElement): void {
	act(() => input.focus())
}

function type(input: HTMLInputElement, value: string): void {
	act(() => {
		input.value = value
		input.dispatchEvent(new InputEvent("input", { bubbles: true }))
	})
}

function key(
	input: HTMLInputElement,
	keyValue: string,
	modifiers: KeyboardEventInit = {},
): void {
	act(() => {
		input.dispatchEvent(
			new KeyboardEvent("keydown", {
				bubbles: true,
				cancelable: true,
				key: keyValue,
				...modifiers,
			}),
		)
	})
}

describe("NumericInput", () => {
	it("commits and normalizes a valid expression once on Enter", () => {
		const { input, onCommit } = mount()
		focus(input)
		type(input, "(20 + 5) * 2")
		key(input, "Enter")
		expect(onCommit).toHaveBeenCalledOnce()
		expect(onCommit).toHaveBeenCalledWith(50)
		expect(input.value).toBe("50")
		expect(document.activeElement).not.toBe(input)
		expect(input.getAttribute("aria-invalid")).toBeNull()
	})

	it("does not commit an unchanged expression", () => {
		const { input, onCommit } = mount()
		focus(input)
		type(input, "5 * 2")
		key(input, "Enter")
		expect(onCommit).not.toHaveBeenCalled()
		expect(input.value).toBe("10")
	})

	it("commits a valid expression once on blur", () => {
		const { input, onCommit } = mount()
		focus(input)
		type(input, "25 * 2")
		act(() => input.blur())
		expect(onCommit).toHaveBeenCalledOnce()
		expect(onCommit).toHaveBeenCalledWith(50)
		expect(input.value).toBe("50")
	})

	it("retains an invalid Enter draft, focus, and accessible error", () => {
		const { input, output, onCommit } = mount()
		focus(input)
		type(input, "10 / 0")
		key(input, "Enter")
		expect(onCommit).not.toHaveBeenCalled()
		expect(input.value).toBe("10 / 0")
		expect(document.activeElement).toBe(input)
		expect(input.getAttribute("aria-invalid")).toBe("true")
		expect(input.getAttribute("aria-errormessage")).toBe(output.id)
		expect(output.textContent).toBe("Cannot divide by zero.")

		type(input, "10 + 1")
		expect(input.getAttribute("aria-invalid")).toBeNull()
		expect(output.textContent).toBe("")
	})

	it("rejects invalid blur, restores the value, and announces it", () => {
		const { input, output, onCommit } = mount()
		focus(input)
		type(input, "101")
		act(() => input.blur())
		expect(onCommit).not.toHaveBeenCalled()
		expect(input.value).toBe("10")
		expect(input.getAttribute("aria-invalid")).toBeNull()
		expect(output.textContent).toBe(
			"Edit rejected. Result must be between 0 and 100.",
		)
		expect(input.getAttribute("aria-describedby")).toBe(output.id)
	})

	it("cancels with Escape without committing", () => {
		const { input, output, onCommit } = mount()
		focus(input)
		type(input, "30 + 4")
		key(input, "Escape")
		expect(onCommit).not.toHaveBeenCalled()
		expect(input.value).toBe("10")
		expect(output.textContent).toBe("")
		expect(document.activeElement).not.toBe(input)
	})

	it("steps valid expressions and falls back from invalid drafts", () => {
		const { input, onCommit } = mount({ max: 1_000 })
		focus(input)
		type(input, "5 + 5")
		key(input, "ArrowUp", { shiftKey: true })
		expect(input.value).toBe("20")
		expect(onCommit).toHaveBeenLastCalledWith(20)
		key(input, "ArrowUp", { repeat: true, shiftKey: true })
		expect(input.value).toBe("30")
		expect(onCommit).toHaveBeenLastCalledWith(30)

		type(input, "1 +")
		key(input, "ArrowUp", { ctrlKey: true })
		expect(input.value).toBe("110")
		expect(onCommit).toHaveBeenLastCalledWith(110)
	})

	it("keeps 0.001 base stepping with absolute modified jumps", () => {
		const { input, onCommit } = mount({
			value: 1.125,
			max: 1_000,
			step: 0.001,
			modifiedArrowStep: 1,
		})
		focus(input)
		key(input, "ArrowUp")
		expect(input.value).toBe("1.126")
		expect(onCommit).toHaveBeenLastCalledWith(1.126)
		key(input, "ArrowUp", { shiftKey: true })
		expect(input.value).toBe("11.126")
		expect(onCommit).toHaveBeenLastCalledWith(11.126)
		key(input, "ArrowUp", { ctrlKey: true })
		expect(input.value).toBe("111.126")
		expect(onCommit).toHaveBeenLastCalledWith(111.126)
	})

	it("keeps 0.1 base stepping with absolute modified jumps", () => {
		const { input, onCommit } = mount({
			value: 1.1,
			min: -1_000,
			max: 1_000,
			step: 0.1,
			modifiedArrowStep: 1,
		})
		focus(input)
		key(input, "ArrowDown")
		expect(input.value).toBe("1")
		expect(onCommit).toHaveBeenLastCalledWith(1)
		key(input, "ArrowDown", { shiftKey: true })
		expect(input.value).toBe("-9")
		expect(onCommit).toHaveBeenLastCalledWith(-9)
		key(input, "ArrowDown", { ctrlKey: true })
		expect(input.value).toBe("-109")
		expect(onCommit).toHaveBeenLastCalledWith(-109)
	})

	it("exposes text editing with deliberate spinbutton semantics", () => {
		const { input } = mount({ min: -20, max: 20, step: 0.1 })
		expect(input.type).toBe("text")
		expect(input.getAttribute("role")).toBe("spinbutton")
		expect(input.getAttribute("inputmode")).toBe("decimal")
		expect(input.getAttribute("aria-valuemin")).toBe("-20")
		expect(input.getAttribute("aria-valuemax")).toBe("20")
		expect(input.getAttribute("aria-valuenow")).toBe("10")
		expect(input.getAttribute("aria-valuetext")).toBe("10")
	})
})
