// @vitest-environment happy-dom

import { h, render } from "preact"
import { act } from "preact/test-utils"
import { afterEach, describe, expect, it } from "vitest"

import { CompatibilityTile } from "../src/CompatibilityTile.tsx"
import { oGlyphId } from "../src/demo-font.ts"
import { createEditorWorkspace } from "../src/editor-workspace.ts"
import { EditorStateContext } from "../src/state-hooks.ts"

const hosts: HTMLElement[] = []

afterEach(() => {
	for (const host of hosts) {
		render(null, host)
		host.remove()
	}
	hosts.length = 0
})

function mountCompatibilityTile() {
	const host = document.createElement("section")
	document.body.append(host)
	hosts.push(host)
	const workspace = createEditorWorkspace()
	act(() => workspace.actions.enterGlyphEdit(2, oGlyphId))
	act(() =>
		render(
			h(EditorStateContext.Provider, {
				value: workspace.font.silo,
				children: h(CompatibilityTile, { workspace }),
			}),
			host,
		),
	)
	const tile = host.querySelector("compatibility-tile")
	if (!(tile instanceof HTMLElement)) {
		throw new Error("The compatibility tile did not mount.")
	}
	return { tile, workspace }
}

describe("CompatibilityTile", () => {
	it("controls the shared overlay visibility and offsets", () => {
		const { tile, workspace } = mountCompatibilityTile()
		const overlay = tile.querySelector('input[type="checkbox"]')
		const horizontal = tile.querySelector(
			'input[aria-label="Compatibility horizontal offset"]',
		)
		const vertical = tile.querySelector(
			'input[aria-label="Compatibility vertical offset"]',
		)
		if (
			!(overlay instanceof HTMLInputElement) ||
			!(horizontal instanceof HTMLInputElement) ||
			!(vertical instanceof HTMLInputElement)
		) {
			throw new Error("The compatibility controls were not rendered.")
		}

		act(() => {
			overlay.checked = true
			overlay.dispatchEvent(new Event("change", { bubbles: true }))
			horizontal.value = "36"
			horizontal.dispatchEvent(new InputEvent("input", { bubbles: true }))
			vertical.value = "-20"
			vertical.dispatchEvent(new InputEvent("input", { bubbles: true }))
		})

		expect(
			workspace.font.silo.getState(workspace.ui.visualDebug).compatibility,
		).toBe(true)
		expect(
			workspace.font.silo.getState(workspace.ui.compatibilityGhostOffset),
		).toEqual({ x: 36, y: -20 })
		expect(horizontal.min).toBe("-96")
		expect(horizontal.max).toBe("96")
	})

	it("keeps path ordering editable from the tile", () => {
		const { tile, workspace } = mountCompatibilityTile()
		const before = workspace.font.silo
			.getState(workspace.ui.activeLayer)
			?.contours.map((contour) => contour.id)
		const moveDown = tile.querySelector('button[aria-label="Move path 1 down"]')
		if (!(moveDown instanceof HTMLButtonElement) || before === undefined) {
			throw new Error("The path order controls were not rendered.")
		}

		act(() => moveDown.click())

		expect(
			workspace.font.silo
				.getState(workspace.ui.activeLayer)
				?.contours.map((contour) => contour.id),
		).toEqual([before[1], before[0]])
	})

	it("plots path thumbnails with the font-space vertical direction", () => {
		const { tile } = mountCompatibilityTile()
		const thumbnail = tile.querySelector("ol svg")
		const drawing = thumbnail?.querySelector("g")
		if (
			!(thumbnail instanceof SVGElement) ||
			!(drawing instanceof SVGElement)
		) {
			throw new Error("The path thumbnail was not rendered.")
		}

		expect(drawing.getAttribute("transform")).toMatch(
			/^translate\(0 -?[\d.]+\) scale\(1 -1\)$/,
		)
		expect(thumbnail.getAttribute("viewBox")).not.toBeNull()
	})
})
