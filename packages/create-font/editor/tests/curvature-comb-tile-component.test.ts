// @vitest-environment happy-dom

import { act, h, render } from "../../../../scripts/react-test-render.ts"
import { afterEach, describe, expect, it } from "vitest"

import { CurvatureCombTile } from "../src/CurvatureCombTile.tsx"
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

function mountTileClones() {
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
					h(CurvatureCombTile, { key: "first", workspace }),
					h(CurvatureCombTile, { key: "second", workspace }),
				]),
			}),
			host,
		),
	)
	const tiles = [...host.querySelectorAll("curvature-comb-controls")]
	if (tiles.length !== 2) throw new Error("The curvature tiles did not mount.")
	return { first: tiles[0]!, second: tiles[1]!, workspace }
}

function commit(input: HTMLInputElement, value: string): void {
	act(() => {
		input.focus()
		input.value = value
		input.dispatchEvent(new InputEvent("input", { bubbles: true }))
	})
	act(() => {
		input.dispatchEvent(
			new KeyboardEvent("keydown", {
				bubbles: true,
				cancelable: true,
				key: "Enter",
			}),
		)
	})
}

describe("CurvatureCombTile", () => {
	it("shares accessible toggle, size, intensity, and direction controls", () => {
		const { first, second, workspace } = mountTileClones()
		const toggle = first.querySelector('input[type="checkbox"]')
		if (!(toggle instanceof HTMLInputElement))
			throw new Error("The curvature toggle was not rendered.")
		expect(toggle.checked).toBe(false)
		expect(
			(first.querySelector('input[aria-label="Size"]') as HTMLInputElement)
				.disabled,
		).toBe(true)
		act(() => toggle.click())

		const size = first.querySelector('input[aria-label="Size"]')
		const intensity = first.querySelector('input[aria-label="Intensity"]')
		const direction = first.querySelector("select")
		if (
			!(size instanceof HTMLInputElement) ||
			!(intensity instanceof HTMLInputElement) ||
			!(direction instanceof HTMLSelectElement)
		)
			throw new Error("The curvature settings were not rendered.")
		commit(size, "2.4")
		commit(intensity, "45")
		act(() => {
			direction.value = "signed"
			direction.dispatchEvent(new Event("change", { bubbles: true }))
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
			(second.querySelector('input[type="checkbox"]') as HTMLInputElement)
				.checked,
		).toBe(true)
		expect(
			(second.querySelector('input[aria-label="Size"]') as HTMLInputElement)
				.value,
		).toBe("2.4")
	})
})
