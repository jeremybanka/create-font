// @vitest-environment happy-dom

import { createDesignBlend } from "@create-design/model"
import { act, h, render } from "../../../../scripts/react-test-render.ts"
import { afterEach, describe, expect, it, vi } from "vitest"

import { DesignTileContent } from "../src/DesignTileContent.tsx"
import type { DesignTileContext } from "../src/design-tile-registry.ts"
import { createInitialDocument } from "../src/document.ts"

const hosts: HTMLElement[] = []

afterEach(() => {
	for (const host of hosts) {
		render(null, host)
		host.remove()
	}
	hosts.length = 0
})

function mount(overrides: Partial<DesignTileContext>) {
	const host = document.createElement("section")
	document.body.append(host)
	hosts.push(host)
	const context = {
		blendCreationDisabledReason: null,
		blendDiagnosticMessages: [],
		expandBlend: vi.fn(),
		makeBlend: vi.fn(),
		reverseBlendEndpoint: vi.fn(),
		selectedBlend: null,
		setBlendFirstPoint: vi.fn(),
		setBlendProperty: vi.fn(),
		...overrides,
	} as unknown as DesignTileContext
	act(() => render(h(DesignTileContent, { context, kind: "blend" }), host))
	return { context, host }
}

describe("Blend tile", () => {
	it("labels Make Blend and exposes the exact eligibility diagnostic", () => {
		const reason = "Select exactly two ordinary objects to make a blend."
		const { host } = mount({
			blendCreationDisabledReason: reason,
			document: createInitialDocument(),
		})
		const make = [...host.querySelectorAll("button")].find(
			(button) => button.textContent === "Make Blend",
		)
		expect(make?.disabled).toBe(true)
		expect(host.textContent).toContain(reason)
		expect(
			host.querySelector("design-blend-tile")?.getAttribute("aria-label"),
		).toBe("Live blend editor")
	})

	it("commits step, direction, correspondence, and expansion actions", () => {
		const document = createInitialDocument()
		const [start, end] = document.objects
		const blend = createDesignBlend(
			"blend:component",
			"Component",
			start!,
			end!,
			3,
		)
		const setBlendProperty = vi.fn()
		const reverseBlendEndpoint = vi.fn()
		const expandBlend = vi.fn()
		const { host } = mount({
			document: { ...document, blends: [blend] },
			expandBlend,
			reverseBlendEndpoint,
			selectedBlend: blend,
			setBlendProperty,
		})
		const steps = host.querySelector<HTMLInputElement>(
			'input[aria-label="Specified steps"]',
		)!
		act(() => {
			steps.focus()
			steps.value = "8"
			steps.dispatchEvent(new InputEvent("input", { bubbles: true }))
		})
		act(() => {
			steps.dispatchEvent(
				new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }),
			)
		})
		expect(setBlendProperty).toHaveBeenCalledWith(blend, { steps: 8 })
		const reverse = [...host.querySelectorAll("button")].find((button) =>
			button.textContent?.includes("Reverse start direction"),
		)
		expect(reverse?.disabled).toBe(true)
		const expand = host.querySelector<HTMLButtonElement>("[data-expand-blend]")!
		act(() => expand.click())
		expect(expandBlend).toHaveBeenCalledOnce()
		expect(host.textContent).toContain("Retains both endpoint objects")
	})
})
