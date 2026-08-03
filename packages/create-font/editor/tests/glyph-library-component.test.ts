// @vitest-environment happy-dom

import type { ContourId, EditorFontSource, PointId } from "@create-font/states"
import { act, h, render } from "../../../../scripts/react-test-render.ts"
import { afterEach, describe, expect, it } from "vitest"

import { blackMasterId, makeDemoFont, oGlyphId } from "../src/demo-font.ts"
import { createEditorWorkspace } from "../src/editor-workspace.ts"
import { GlyphLibrary } from "../src/GlyphLibrary.tsx"
import { StoreProvider } from "atom.io/react"

const hosts: HTMLElement[] = []

afterEach(() => {
	for (const host of hosts) {
		render(null, host)
		host.remove()
	}
	hosts.length = 0
})

function sourceWithCoincidentAdditiveContours(): EditorFontSource {
	const source = makeDemoFont()
	return {
		...source,
		glyphs: source.glyphs.map((glyph) =>
			glyph.id !== oGlyphId
				? glyph
				: {
						...glyph,
						layers: glyph.layers.map((layer) => ({
							...layer,
							contours: [
								...layer.contours,
								...layer.contours.map((contour, contourIndex) => ({
									...contour,
									id: `${contour.id}:coincident` as ContourId,
									points: contour.points.map((point, pointIndex) => ({
										...point,
										id: `${point.id}:coincident:${contourIndex}:${pointIndex}` as PointId,
									})),
								})),
							],
						})),
					},
		),
	}
}

function mountLibrary() {
	const host = document.createElement("section")
	document.body.append(host)
	hosts.push(host)
	const source = sourceWithCoincidentAdditiveContours()
	const workspace = createEditorWorkspace(source)
	act(() =>
		render(
			h(StoreProvider, {
				store: workspace.font.silo.store,
				children: h(GlyphLibrary, {
					addingGlyphs: false,
					onAddingGlyphsChange: () => {},
					workspace,
				}),
			}),
			host,
		),
	)
	return { host, source, workspace }
}

function glyphFill(host: HTMLElement): SVGPathElement {
	const fill = host.querySelector(
		'button[aria-label="Open O in the canvas"] path:not([data-open-contour])',
	)
	if (!(fill instanceof SVGPathElement))
		throw new Error("The O glyph-library fill was not rendered.")
	return fill
}

describe("GlyphLibrary", () => {
	it("uses nonzero winding for additive closed contours and their counters", () => {
		const { host, source, workspace } = mountLibrary()
		const sourceO = source.glyphs.find((glyph) => glyph.id === oGlyphId)
		expect(sourceO?.layers.every((layer) => layer.contours.length === 4)).toBe(
			true,
		)

		const razorFill = glyphFill(host)
		expect(razorFill.getAttribute("d")?.match(/M /g)).toHaveLength(4)
		expect(razorFill.getAttribute("fill-rule")).toBe("nonzero")
		expect(razorFill.getAttribute("clip-rule")).toBe("nonzero")

		act(() => workspace.actions.selectMaster(blackMasterId))
		const blackFill = glyphFill(host)
		expect(blackFill.getAttribute("d")?.match(/M /g)).toHaveLength(4)
		expect(blackFill.getAttribute("fill-rule")).toBe("nonzero")
		expect(blackFill.getAttribute("clip-rule")).toBe("nonzero")

		expect(sourceO?.layers.every((layer) => layer.contours.length === 4)).toBe(
			true,
		)
	})
})
