import { resolve } from "node:path"

import { describe, expect, it } from "vitest"
import { createFontEditorState } from "@create-font/states"

import { loadEditorFontSourceDirectory } from "../src/source-service.ts"

describe("Workbench Sans Heavy H master-local editing", () => {
	it("moves the four selected Heavy points exactly once and leaves Text unchanged", async () => {
		const source = await loadEditorFontSourceDirectory(
			resolve(import.meta.dirname, "../../../fonts/workbench-sans"),
		)
		expect(source.editorVersion).toBe(5)
		const h = source.glyphs.find((glyph) => glyph.id === "glyph:H")
		const heavy = h?.layers.find((layer) => layer.masterId === "master:heavy")
		const text = h?.layers.find((layer) => layer.masterId === "master:text")
		const selected = heavy?.contours[4]?.points
		if (h === undefined || heavy === undefined || text === undefined) {
			throw new Error("Workbench Sans H master layers are missing.")
		}
		if (selected === undefined || selected.length !== 4) {
			throw new Error("Workbench Sans Heavy H crossbar is not four points.")
		}

		const editor = createFontEditorState({ key: "regression/heavy-h" })
		editor.actions.load(source)
		editor.actions.transformControls({
			masterId: "master:heavy",
			glyphId: "glyph:H",
			points: selected.map((point) => ({
				pointId: point.id,
				x: point.x + 25,
				y: point.y - 10,
			})),
			handles: [],
		})

		const after = editor.read.editorGlyphSource("glyph:H")
		const afterHeavy = after?.layers.find(
			(layer) => layer.masterId === "master:heavy",
		)
		const afterText = after?.layers.find(
			(layer) => layer.masterId === "master:text",
		)
		const moved = afterHeavy?.contours[4]?.points
		expect(moved).toHaveLength(4)
		expect(new Set(moved?.map((point) => point.id)).size).toBe(4)
		expect(moved?.map(({ x, y }) => ({ x, y }))).toEqual(
			selected.map((point) => ({ x: point.x + 25, y: point.y - 10 })),
		)
		expect(afterText).toEqual(text)
	})
})
