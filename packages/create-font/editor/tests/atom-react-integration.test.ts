// @vitest-environment happy-dom

import type { GlyphId } from "@create-font/states"
import { StoreProvider, useO, useTL } from "atom.io/react"
import { act, h, render } from "../../../../scripts/react-test-render.ts"
import { afterEach, describe, expect, it } from "vitest"

import { AppShell } from "../src/AppShell.tsx"
import { oGlyphId } from "../src/demo-font.ts"
import { createEditorWorkspace } from "../src/editor-workspace.ts"

const hosts: HTMLElement[] = []

afterEach(() => {
	for (const host of hosts) {
		act(() => render(null, host))
		host.remove()
	}
	hosts.length = 0
})

describe("atom.io React integration", () => {
	it("renders coordinated workspace transactions as settled state", () => {
		const workspace = createEditorWorkspace()
		workspace.font.silo.setState(workspace.ui.activeTool, "pen")
		const snapshots: Array<readonly [string | null, string]> = []
		function Harness() {
			const glyphId = useO(workspace.ui.selectedGlyphId)
			const tool = useO(workspace.ui.activeTool)
			snapshots.push([glyphId, tool])
			return null
		}
		const host = document.createElement("div")
		document.body.append(host)
		hosts.push(host)
		act(() =>
			render(
				h(StoreProvider, {
					store: workspace.font.silo.store,
					children: h(Harness, {}),
				}),
				host,
			),
		)

		act(() => workspace.actions.selectGlyph(oGlyphId))

		expect(snapshots.at(-1)).toEqual([oGlyphId, "select"])
		expect(snapshots).not.toContainEqual([oGlyphId, "pen"])
	})

	it("unmounts glyph history without recreating a disposed family member", () => {
		const workspace = createEditorWorkspace()
		const removedTimeline = workspace.font.silo.findTimeline(
			workspace.font.glyphHistoryTimelines,
			oGlyphId,
		)
		function GlyphHistory({ glyphId }: { readonly glyphId: GlyphId }) {
			useTL(workspace.font.glyphHistoryTimelines, glyphId)
			return null
		}
		function Harness() {
			const activeGlyphId = useO(workspace.ui.activeGlyphId)
			return activeGlyphId === null
				? null
				: h(GlyphHistory, { glyphId: activeGlyphId })
		}
		const host = document.createElement("div")
		document.body.append(host)
		hosts.push(host)
		act(() =>
			render(
				h(StoreProvider, {
					store: workspace.font.silo.store,
					children: h(Harness, {}),
				}),
				host,
			),
		)

		const source = workspace.font.read.editorSource()
		if (source === null) throw new Error("Fixture source is missing.")
		act(() =>
			workspace.actions.replaceSource({
				...source,
				glyphs: source.glyphs.filter((glyph) => glyph.id !== oGlyphId),
				cmap: source.cmap.filter((entry) => entry.glyphId !== oGlyphId),
				kerning: (source.kerning ?? []).filter(
					(pair) => pair.left !== oGlyphId && pair.right !== oGlyphId,
				),
			}),
		)
		expect(workspace.font.silo.store.timelines.has(removedTimeline.key)).toBe(
			false,
		)
	})

	it("preserves shell-local state when active glyph history disappears", () => {
		const workspace = createEditorWorkspace()
		workspace.actions.navigate("/glyphs")
		const host = document.createElement("div")
		document.body.append(host)
		hosts.push(host)
		act(() =>
			render(
				h(StoreProvider, {
					store: workspace.font.silo.store,
					children: h(AppShell, { workspace }),
				}),
				host,
			),
		)
		const openCommands = host.querySelector<HTMLButtonElement>(
			'button[aria-label="Open Command Palette"]',
		)
		if (openCommands === null) throw new Error("Command button is missing.")
		act(() => openCommands.click())
		expect(host.querySelector("command-palette")).not.toBeNull()

		const source = workspace.font.read.editorSource()
		if (source === null) throw new Error("Fixture source is missing.")
		act(() =>
			workspace.actions.replaceSource({
				...source,
				glyphs: source.glyphs.filter((glyph) => glyph.id !== oGlyphId),
				cmap: source.cmap.filter((entry) => entry.glyphId !== oGlyphId),
				kerning: (source.kerning ?? []).filter(
					(pair) => pair.left !== oGlyphId && pair.right !== oGlyphId,
				),
			}),
		)

		expect(workspace.font.silo.getState(workspace.ui.activeGlyphId)).toBeNull()
		expect(host.querySelector("command-palette")).not.toBeNull()
	})
})
