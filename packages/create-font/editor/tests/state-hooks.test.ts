// @vitest-environment happy-dom

import { StoreProvider, useO } from "atom.io/react"
import { h, render } from "preact"
import { act } from "preact/test-utils"
import { afterEach, describe, expect, it } from "vitest"

import { oGlyphId } from "../src/demo-font.ts"
import { createEditorWorkspace } from "../src/editor-workspace.ts"
import { useOptionalTL } from "../src/state-hooks.ts"

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

	it("does not recreate a disposed timeline for a null family key", () => {
		const workspace = createEditorWorkspace()
		const removedTimeline = workspace.font.silo.findTimeline(
			workspace.font.glyphHistoryTimelines,
			oGlyphId,
		)
		const source = workspace.font.read.editorSource()
		if (source === null) throw new Error("Fixture source is missing.")
		workspace.actions.replaceSource({
			...source,
			glyphs: source.glyphs.filter((glyph) => glyph.id !== oGlyphId),
			cmap: source.cmap.filter((entry) => entry.glyphId !== oGlyphId),
			kerning: (source.kerning ?? []).filter(
				(pair) => pair.left !== oGlyphId && pair.right !== oGlyphId,
			),
		})
		expect(workspace.font.silo.store.timelines.has(removedTimeline.key)).toBe(
			false,
		)
		const memberCount = workspace.font.silo.store.timelines.size

		function Harness() {
			useOptionalTL(
				workspace.font.silo,
				workspace.font.glyphHistoryTimelines,
				null,
				workspace.inactiveGlyphTimeline,
			)
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

		expect(workspace.font.silo.store.timelines.size).toBe(memberCount)
		expect(workspace.font.silo.store.timelines.has(removedTimeline.key)).toBe(
			false,
		)
	})
})
