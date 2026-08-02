// @vitest-environment happy-dom

import { h, render } from "preact"
import { act } from "preact/test-utils"
import { afterEach, describe, expect, it, vi } from "vitest"

import { DesignTileContent } from "../src/DesignTileContent.tsx"
import type { DesignTileContext } from "../src/design-tile-registry.ts"

const hosts: HTMLElement[] = []

afterEach(() => {
	for (const host of hosts) {
		render(null, host)
		host.remove()
	}
	hosts.length = 0
})

function mountTransform(overrides: Partial<DesignTileContext> = {}) {
	const host = document.createElement("section")
	document.body.append(host)
	hosts.push(host)
	const transformSelection = vi.fn()
	const alignSelection = vi.fn()
	const distributeSelection = vi.fn()
	const context = {
		alignSelection,
		directSelectionSummary: "No nodes selected",
		distributeSelection,
		selectedObject: null,
		selectedObjectCount: 3,
		selectedObjectIds: ["one", "two", "three"],
		selectionBounds: { minX: 10, minY: 20, maxX: 110, maxY: 220 },
		selectionTransformDisabledReason: null,
		tool: "select",
		transformSelection,
		...overrides,
	} as unknown as DesignTileContext
	render(h(DesignTileContent, { context, kind: "object" }), host)
	return { alignSelection, distributeSelection, host, transformSelection }
}

function input(host: HTMLElement, label: string): HTMLInputElement {
	const element = host.querySelector<HTMLInputElement>(
		`input[aria-label="${label}"]`,
	)
	if (element === null) throw new Error(`${label} input was not found.`)
	return element
}

function type(element: HTMLInputElement, value: string): void {
	act(() => {
		element.focus()
		element.value = value
		element.dispatchEvent(new InputEvent("input", { bubbles: true }))
	})
}

function key(element: HTMLElement, keyValue: string): void {
	act(() => {
		element.dispatchEvent(
			new KeyboardEvent("keydown", {
				bubbles: true,
				cancelable: true,
				key: keyValue,
			}),
		)
	})
}

describe("Selection Transform editor", () => {
	it("commits valid numeric drafts once and rejects or cancels invalid drafts", () => {
		const { host, transformSelection } = mountTransform()
		const x = input(host, "Selection X")
		type(x, "25 * 2")
		key(x, "Enter")
		expect(transformSelection).toHaveBeenCalledOnce()
		expect(transformSelection).toHaveBeenCalledWith({ origin: "center", x: 50 })

		const width = input(host, "Selection width")
		type(width, "-1")
		key(width, "Enter")
		expect(width.getAttribute("aria-invalid")).toBe("true")
		expect(transformSelection).toHaveBeenCalledOnce()
		key(width, "Escape")
		expect(width.value).toBe("100")

		const rotation = input(host, "Rotate by degrees")
		type(rotation, "45")
		key(rotation, "Enter")
		expect(transformSelection).toHaveBeenLastCalledWith({
			origin: "center",
			rotation: 45,
		})
		expect(rotation.value).toBe("0")
	})

	it("supports pointer and roving-keyboard origin selection", () => {
		const { host, transformSelection } = mountTransform()
		const topRight = host.querySelector<HTMLButtonElement>(
			'button[aria-label="Top right"]',
		)
		if (topRight === null) throw new Error("Top-right origin was not found.")
		act(() => topRight.click())
		expect(topRight.getAttribute("aria-checked")).toBe("true")
		key(topRight, "ArrowDown")
		const right = host.querySelector<HTMLButtonElement>(
			'button[aria-label="Center right"]',
		)
		expect(document.activeElement).toBe(right)
		expect(right?.getAttribute("aria-checked")).toBe("true")

		const y = input(host, "Selection Y")
		key(y, "ArrowUp")
		expect(transformSelection).toHaveBeenLastCalledWith({
			origin: "right",
			y: 121,
		})
	})

	it("presents floating-point transform artifacts as concise decimals", () => {
		const { host } = mountTransform({
			selectionBounds: {
				minX: -5.684341886080802e-14,
				minY: 20.123_456,
				maxX: 100.987_654,
				maxY: 220.765_432,
			},
		})
		act(() =>
			host.querySelector<HTMLButtonElement>('button[aria-label="Top left"]')?.click(),
		)
		expect(input(host, "Selection X").value).toBe("0")
		expect(input(host, "Selection Y").value).toBe("20.123")
		expect(input(host, "Selection width").value).toBe("100.988")
		expect(input(host, "Selection height").value).toBe("200.642")
	})

	it("labels and invokes align and distribute actions", () => {
		const { alignSelection, distributeSelection, host } = mountTransform()
		const alignLeft = host.querySelector<HTMLButtonElement>(
			'button[aria-label="Align left"]',
		)
		const distribute = host.querySelector<HTMLButtonElement>(
			'button[aria-label="Distribute horizontally"]',
		)
		act(() => {
			alignLeft?.click()
			distribute?.click()
		})
		expect(alignSelection).toHaveBeenCalledWith("left", "selection", "three")
		expect(distributeSelection).toHaveBeenCalledWith("x")
	})

	it("communicates unavailable locked and undersized selection states", () => {
		const { host } = mountTransform({
			selectedObjectCount: 1,
			selectedObjectIds: ["locked"],
			selectionTransformDisabledReason:
				"Unlock Locked rectangle before transforming the selection.",
		})
		expect(input(host, "Selection X").disabled).toBe(true)
		expect(
			host.querySelector<HTMLButtonElement>('button[aria-label="Center"]')
				?.disabled,
		).toBe(true)
		expect(
			host.querySelector<HTMLButtonElement>('button[aria-label="Align left"]')
				?.disabled,
		).toBe(true)
		expect(host.textContent).toContain(
			"Unlock Locked rectangle before transforming the selection.",
		)
		expect(
			host.querySelectorAll("transform-disabled-reason"),
		).toHaveLength(1)
	})

	it("treats a selected group as one arrangement unit", () => {
		const { host } = mountTransform({ selectionArrangementUnitCount: 1 })
		expect(
			host.querySelector<HTMLButtonElement>('button[aria-label="Align left"]')
				?.disabled,
		).toBe(true)
		expect(
			host.querySelector<HTMLButtonElement>(
				'button[aria-label="Distribute horizontally"]',
			)?.disabled,
		).toBe(true)
	})
})
