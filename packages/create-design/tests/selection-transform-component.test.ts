// @vitest-environment happy-dom

import { h, render } from "preact"
import { act } from "preact/test-utils"
import { afterEach, describe, expect, it, vi } from "vitest"

import { DesignTileContent } from "../src/DesignTileContent.tsx"
import type { DesignTileContext } from "../src/design-tile-registry.ts"
import { createInitialDocument } from "../src/document.ts"
import type { DesignTileKind } from "../src/design-tile-registry.ts"

const hosts: HTMLElement[] = []

afterEach(() => {
	for (const host of hosts) {
		render(null, host)
		host.remove()
	}
	hosts.length = 0
})

function mountTile(
	kind: DesignTileKind,
	overrides: Partial<DesignTileContext> = {},
) {
	const host = document.createElement("section")
	document.body.append(host)
	hosts.push(host)
	const transformSelection = vi.fn()
	const alignSelection = vi.fn()
	const distributeSelection = vi.fn()
	const context: DesignTileContext = {
		alignSelection,
		deleteSelection: vi.fn(),
		directSelectionSummary: "No nodes selected",
		distributeSelection,
		expandSelection: vi.fn(),
		expansionDisabledReason: "Select one live shape to expand it.",
		expandStrokeSelection: vi.fn(),
		selectedObject: null,
		selectedObjectCount: 3,
		selectedObjectIds: ["one", "two", "three"],
		selectionBounds: { minX: 10, minY: 20, maxX: 110, maxY: 220 },
		selectionTransformDisabledReason: null,
		setObjectGeometry: vi.fn(),
		setObjectProperty: vi.fn(),
		strokeExpansionDisabledReason: "Select one stroked object to expand it.",
		tool: "select",
		transformSelection,
		...overrides,
	} as unknown as DesignTileContext
	const rerender = (next: Partial<DesignTileContext>): void =>
		render(
			h(DesignTileContent, { context: { ...context, ...next }, kind }),
			host,
		)
	render(h(DesignTileContent, { context, kind }), host)
	return {
		alignSelection,
		distributeSelection,
		host,
		rerender,
		transformSelection,
	}
}

const mountTransform = (overrides: Partial<DesignTileContext> = {}) =>
	mountTile("transform", overrides)

const mountArrange = (overrides: Partial<DesignTileContext> = {}) =>
	mountTile("arrange", overrides)

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
			host
				.querySelector<HTMLButtonElement>('button[aria-label="Top left"]')
				?.click(),
		)
		expect(input(host, "Selection X").value).toBe("0")
		expect(input(host, "Selection Y").value).toBe("20.123")
		expect(input(host, "Selection width").value).toBe("100.988")
		expect(input(host, "Selection height").value).toBe("200.642")
	})

	it("labels and invokes align and distribute actions", () => {
		const { alignSelection, distributeSelection, host } = mountArrange()
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
		const locked = {
			selectedObjectCount: 1,
			selectedObjectIds: ["locked"],
			selectionTransformDisabledReason:
				"Unlock Locked rectangle before transforming the selection.",
		} satisfies Partial<DesignTileContext>
		const transform = mountTransform(locked)
		expect(input(transform.host, "Selection X").disabled).toBe(true)
		expect(
			transform.host.querySelector<HTMLButtonElement>(
				'button[aria-label="Center"]',
			)?.disabled,
		).toBe(true)
		const arrange = mountArrange(locked)
		expect(
			arrange.host.querySelector<HTMLButtonElement>(
				'button[aria-label="Align left"]',
			)?.disabled,
		).toBe(true)
		expect(transform.host.textContent).toContain(
			"Unlock Locked rectangle before transforming the selection.",
		)
		expect(
			transform.host.querySelectorAll("transform-disabled-reason"),
		).toHaveLength(1)
	})

	it("treats a selected group as one arrangement unit", () => {
		const { host } = mountArrange({ selectionArrangementUnitCount: 1 })
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

	it("uses one coherent pressed button for constrained proportions", () => {
		const { host } = mountTransform()
		const constrain = host.querySelector<HTMLButtonElement>(
			'button[aria-label="Constrain proportions"]',
		)
		if (constrain === null)
			throw new Error("Constrain proportions button was not found.")
		expect(host.querySelector('input[type="checkbox"]')).toBeNull()
		expect(constrain.getAttribute("aria-pressed")).toBe("false")
		act(() => constrain.click())
		expect(constrain.getAttribute("aria-pressed")).toBe("true")
	})

	it("keeps Transform and Arrange controls mounted without a selection", () => {
		const noSelection = {
			selectedObjectCount: 0,
			selectedObjectIds: [],
			selectionBounds: null,
		} satisfies Partial<DesignTileContext>
		const transform = mountTransform(noSelection)
		expect(transform.host.querySelectorAll("input")).toHaveLength(5)
		expect(
			Array.from(transform.host.querySelectorAll("input, button")).every(
				(control) => (control as HTMLInputElement | HTMLButtonElement).disabled,
			),
		).toBe(true)

		const arrange = mountArrange(noSelection)
		expect(arrange.host.querySelector("select")?.disabled).toBe(true)
		expect(arrange.host.querySelectorAll("button")).toHaveLength(8)
		expect(
			Array.from(arrange.host.querySelectorAll("button")).every(
				(button) => button.disabled,
			),
		).toBe(true)
	})

	it("preserves the Object control skeleton across selection states", () => {
		const { objects } = createInitialDocument()
		const object = objects[0]
		if (object === undefined) throw new Error("Fixture object was not found.")
		const { host, rerender } = mountTile("object", {
			selectedObject: null,
			selectedObjectCount: 0,
			selectedObjectIds: [],
		})
		const controls = Array.from(host.querySelectorAll("input, button"))
		expect(controls.length).toBeGreaterThan(10)
		expect(controls.every((control) => control.hasAttribute("disabled"))).toBe(
			true,
		)

		rerender({
			expansionDisabledReason: null,
			selectedObject: object,
			selectedObjectCount: 1,
			selectedObjectIds: [object.id],
			strokeExpansionDisabledReason: "Assign a stroke before expanding it.",
		})
		const selectedControls = Array.from(host.querySelectorAll("input, button"))
		expect(selectedControls).toHaveLength(controls.length)
		expect(
			selectedControls.every((control, index) => control === controls[index]),
		).toBe(true)
		expect(
			host.querySelector<HTMLInputElement>("tile-text-field input")?.disabled,
		).toBe(false)
	})
})
