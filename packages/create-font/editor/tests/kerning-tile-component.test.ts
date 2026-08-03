// @vitest-environment happy-dom

import { act, h, render } from "../../../../scripts/react-test-render.ts"
import { afterEach, describe, expect, it, vi } from "vitest"

import { createEditorWorkspace } from "../src/editor-workspace.ts"
import { KerningTile } from "../src/KerningTile.tsx"
import { EditorStateContext } from "../src/state-hooks.ts"

const hosts: HTMLElement[] = []

afterEach(() => {
	for (const host of hosts) {
		render(null, host)
		host.remove()
	}
	hosts.length = 0
})

describe("KerningTile", () => {
	it("reports pair state and hands focus back after numeric commits", async () => {
		const workspace = createEditorWorkspace()
		workspace.font.silo.setState(workspace.ui.previewText, "AO")
		workspace.font.silo.setState(workspace.ui.caretIndex, 1)
		const restoreFocus = vi.fn()
		workspace.actions.registerTextCanvasFocusRestorer(restoreFocus)
		const host = document.createElement("section")
		document.body.append(host)
		hosts.push(host)
		act(() =>
			render(
				h(EditorStateContext.Provider, {
					value: workspace.font.silo,
					children: h(KerningTile, { workspace }),
				}),
				host,
			),
		)

		expect(host.querySelector("kerning-tile")?.getAttribute("data-state")).toBe(
			"absent",
		)
		expect(host.querySelector("kerning-heading")?.textContent).toContain(
			"Pair inspector",
		)
		expect(host.querySelectorAll("kerning-section")).toHaveLength(3)
		expect(
			host.querySelector("kerning-section[data-accent='false']"),
		).not.toBeNull()
		expect(host.querySelector('[role="status"]')?.textContent).toContain(
			"Kerning: Absent",
		)
		const input = host.querySelector('[aria-label="Kerning amount"]')
		if (!(input instanceof HTMLInputElement))
			throw new Error("Kerning amount input did not mount.")
		act(() => input.focus())
		act(() => {
			input.value = "-20"
			input.dispatchEvent(new InputEvent("input", { bubbles: true }))
		})
		act(() => {
			input.dispatchEvent(
				new KeyboardEvent("keydown", {
					key: "Enter",
					bubbles: true,
					cancelable: true,
				}),
			)
		})
		await act(async () => Promise.resolve())

		expect(restoreFocus).toHaveBeenCalledOnce()
		expect(workspace.font.read.editorSource()?.kerning?.[0]?.value).toBe(-20)
		expect(host.querySelector("kerning-tile")?.getAttribute("data-state")).toBe(
			"explicit",
		)
		expect(
			host.querySelector("kerning-section[data-accent='true']"),
		).not.toBeNull()
		expect(host.querySelector('[role="status"]')?.textContent).toContain(
			"Kerning: Explicit",
		)
	})
})
