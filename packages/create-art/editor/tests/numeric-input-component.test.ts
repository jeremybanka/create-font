// @vitest-environment happy-dom

import { act, h, render } from "../../../../scripts/react-test-render.ts"
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

	it("restores a controlled delta value after each commit", () => {
		const { input, onCommit } = mount({ value: 0, resetAfterCommit: true })
		focus(input)
		type(input, "45")
		key(input, "Enter")
		expect(onCommit).toHaveBeenCalledWith(45)
		expect(input.value).toBe("0")

		focus(input)
		key(input, "ArrowUp")
		expect(onCommit).toHaveBeenLastCalledWith(1)
		expect(input.value).toBe("0")
	})

	it("supports a non-editable, focusable read-only state", () => {
		const { input, onCommit } = mount({ readOnly: true })
		focus(input)
		type(input, "22")
		key(input, "ArrowUp")
		expect(input.readOnly).toBe(true)
		expect(input.getAttribute("aria-readonly")).toBe("true")
		expect(onCommit).not.toHaveBeenCalled()
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

	it("quantizes repeated 1/10/100 stepping for a 0.001 field", () => {
		const { input, onCommit } = mount({
			value: 1.125,
			max: 1_000,
			step: 0.001,
			arrowStep: 1,
		})
		focus(input)
		key(input, "ArrowUp")
		expect(input.value).toBe("2")
		expect(onCommit).toHaveBeenLastCalledWith(2)
		key(input, "ArrowUp", { shiftKey: true })
		expect(input.value).toBe("12")
		expect(onCommit).toHaveBeenLastCalledWith(12)
		key(input, "ArrowUp", { ctrlKey: true })
		expect(input.value).toBe("112")
		expect(onCommit).toHaveBeenLastCalledWith(112)
	})

	it("quantizes descending 1/10/100 stepping for a 0.1 field", () => {
		const { input, onCommit } = mount({
			value: 1.1,
			min: -1_000,
			max: 1_000,
			step: 0.1,
			arrowStep: 1,
		})
		focus(input)
		key(input, "ArrowDown")
		expect(input.value).toBe("0")
		expect(onCommit).toHaveBeenLastCalledWith(0)
		key(input, "ArrowDown", { shiftKey: true })
		expect(input.value).toBe("-10")
		expect(onCommit).toHaveBeenLastCalledWith(-10)
		key(input, "ArrowDown", { ctrlKey: true })
		expect(input.value).toBe("-110")
		expect(onCommit).toHaveBeenLastCalledWith(-110)
	})

	it("does not emit a commit when a quantized step stays at its bound", () => {
		const { input, onCommit } = mount({
			value: 12.5,
			min: -100,
			max: 12.5,
			step: 0.1,
			arrowStep: 1,
		})
		focus(input)
		key(input, "ArrowUp", { shiftKey: true })
		expect(input.value).toBe("12.5")
		expect(onCommit).not.toHaveBeenCalled()
	})

	it("restores a fractional delta value after a quantized Shift commit", () => {
		const { input, onCommit } = mount({
			value: -1.125,
			min: -100,
			max: 100,
			step: 0.001,
			arrowStep: 1,
			resetAfterCommit: true,
		})
		focus(input)
		key(input, "ArrowDown", { repeat: true, shiftKey: true })
		expect(onCommit).toHaveBeenLastCalledWith(-11)
		expect(input.value).toBe("-1.125")
	})

	it("commits a correctly rounded repeating result at its bound", () => {
		const { input, onCommit } = mount({
			value: 0.5,
			min: 0.3333333333333333,
			max: 1,
			step: "any",
		})
		focus(input)
		type(input, "1 / 3")
		key(input, "Enter")
		expect(input.value).toBe("0.3333333333333333")
		expect(onCommit).toHaveBeenCalledWith(0.3333333333333333)
	})

	it("retains focus and rejects a nonzero underflow", () => {
		const { input, output, onCommit } = mount({ step: "any" })
		focus(input)
		type(input, `1 / ${"9".repeat(400)}`)
		key(input, "Enter")
		expect(onCommit).not.toHaveBeenCalled()
		expect(document.activeElement).toBe(input)
		expect(input.getAttribute("aria-invalid")).toBe("true")
		expect(output.textContent).toBe("Result is too small to represent.")
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
