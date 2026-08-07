// @vitest-environment happy-dom

import { act, h, render } from "../../../../scripts/react-test-render.ts"
import { afterEach, describe, expect, it } from "vitest"

import { CanvasToolbar } from "../src/CanvasToolbar.tsx"
import { oGlyphId } from "../src/demo-font.ts"
import { createEditorWorkspace } from "../src/editor-workspace.ts"
import { StoreProvider } from "atom.io/react"

const hosts: HTMLElement[] = []

afterEach(() => {
	for (const host of hosts) {
		render(null, host)
		host.remove()
	}
	hosts.length = 0
})

function mountToolbarClones() {
	const host = document.createElement("section")
	document.body.append(host)
	hosts.push(host)
	const workspace = createEditorWorkspace()
	workspace.actions.enterGlyphEdit(2, oGlyphId)
	act(() =>
		render(
			h(StoreProvider, {
				store: workspace.font.silo.store,
				children: h("div", {}, [
					h(CanvasToolbar, { key: "first", workspace }),
					h(CanvasToolbar, { key: "second", workspace }),
				]),
			}),
			host,
		),
	)
	const toolbars = [...host.querySelectorAll("canvas-toolbar")]
	if (toolbars.length !== 2)
		throw new Error("The toolbar clones did not mount.")
	return { first: toolbars[0]!, second: toolbars[1]!, workspace }
}

describe("CanvasToolbar curvature controls", () => {
	it("shares visibility, gain, opacity, and side across toolbar clones", () => {
		const { first, second, workspace } = mountToolbarClones()
		const toggle = first.querySelector(
			'button[aria-label="Toggle curvature comb"]',
		)
		if (!(toggle instanceof HTMLButtonElement))
			throw new Error("The curvature toggle was not rendered.")

		expect(toggle.getAttribute("aria-pressed")).toBe("false")
		expect(first.querySelector('input[aria-label="Curvature gain"]')).toBeNull()
		act(() => toggle.click())

		const gain = first.querySelector('input[aria-label="Curvature gain"]')
		const opacity = first.querySelector('input[aria-label="Curvature opacity"]')
		const side = first.querySelector(
			'button[aria-label="Toggle curvature side"]',
		)
		if (
			!(gain instanceof HTMLInputElement) ||
			!(opacity instanceof HTMLInputElement) ||
			!(side instanceof HTMLButtonElement)
		)
			throw new Error("The curvature settings were not rendered.")

		act(() => {
			gain.value = "2.4"
			gain.dispatchEvent(new InputEvent("input", { bubbles: true }))
			opacity.value = "0.45"
			opacity.dispatchEvent(new InputEvent("input", { bubbles: true }))
			side.click()
		})

		expect(workspace.font.silo.getState(workspace.ui.showCurvature)).toBe(true)
		expect(workspace.font.silo.getState(workspace.ui.curvatureGain)).toBe(2.4)
		expect(workspace.font.silo.getState(workspace.ui.curvatureOpacity)).toBe(
			0.45,
		)
		expect(workspace.font.silo.getState(workspace.ui.curvatureSide)).toBe(
			"signed",
		)
		expect(
			second
				.querySelector('button[aria-label="Toggle curvature comb"]')
				?.getAttribute("aria-pressed"),
		).toBe("true")
		expect(
			(
				second.querySelector(
					'input[aria-label="Curvature gain"]',
				) as HTMLInputElement
			).value,
		).toBe("2.4")
		expect(
			second
				.querySelector('button[aria-label="Toggle curvature side"]')
				?.getAttribute("aria-pressed"),
		).toBe("true")
	})
})
