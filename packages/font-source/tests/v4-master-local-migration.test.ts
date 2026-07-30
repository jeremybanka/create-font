import { describe, expect, it } from "vitest"

import { makeGeometricOEditorFont } from "../../states/tests/fixtures/geometric-o.ts"
import { decodeEditorFontSource, encodeEditorFontSource } from "../src/index.ts"

function legacyV4File() {
	const source = makeGeometricOEditorFont()
	return {
		...source,
		editorVersion: 4,
		glyphs: source.glyphs.map((glyph) => {
			const topology = glyph.layers.find(
				(layer) => layer.masterId === source.defaultMasterId,
			)
			if (topology === undefined) throw new Error("Default layer is missing.")
			return {
				...glyph,
				contours: topology.contours.map((contour) => ({
					id: contour.id,
					closed: contour.closed,
					points: contour.points.map((point) => ({
						id: point.id,
						mode: point.mode,
					})),
				})),
				layers: glyph.layers.map((layer) => ({
					masterId: layer.masterId,
					advanceWidth: layer.advanceWidth,
					leftSideBearing: layer.leftSideBearing,
					points: layer.contours.flatMap((contour) =>
						contour.points.map((point) => ({
							pointId: point.id,
							x: point.x,
							y: point.y,
							...(point.incoming === undefined
								? {}
								: { incoming: point.incoming }),
							...(point.outgoing === undefined
								? {}
								: { outgoing: point.outgoing }),
						})),
					),
				})),
			}
		}),
	}
}

describe("v4 shared-topology migration", () => {
	it("deterministically joins geometry and emits canonical v5", () => {
		const legacy = legacyV4File()
		const first = decodeEditorFontSource(JSON.stringify(legacy))
		const second = decodeEditorFontSource(JSON.stringify(legacy))
		expect(first).toEqual(second)
		expect(first.ok).toBe(true)
		if (!first.ok) return

		expect(first.value.editorVersion).toBe(5)
		const glyph = first.value.glyphs[1]
		const defaultLayer = glyph?.layers.find(
			(layer) => layer.masterId === first.value.defaultMasterId,
		)
		const sourceLayer = glyph?.layers.find(
			(layer) => layer.masterId === "master:black",
		)
		expect(defaultLayer?.contours[0]?.id).toBe("contour:glyph:O:outer")
		expect(defaultLayer?.contours[0]?.points[0]?.id).toBe("point:glyph:O:00")
		expect(sourceLayer?.contours[0]?.id).toBe(
			"contour:master:black:glyph:O:outer",
		)
		expect(sourceLayer?.contours[0]?.points[0]?.id).toBe(
			"point:master:black:glyph:O:00",
		)

		const encoded = encodeEditorFontSource(first.value)
		expect(encoded.ok).toBe(true)
		if (encoded.ok) {
			expect(encoded.value).toContain('"editorVersion": 5')
			expect(encoded.value).not.toContain('"pointId"')
		}
	})

	it("rejects missing, duplicate, and unknown legacy point joins", () => {
		const cases = [
			{
				mutate(file: ReturnType<typeof legacyV4File>) {
					file.glyphs[1]?.layers[0]?.points.pop()
				},
				code: "source.reference",
				message: "missing point",
			},
			{
				mutate(file: ReturnType<typeof legacyV4File>) {
					const point = file.glyphs[1]?.layers[0]?.points[0]
					if (point !== undefined) file.glyphs[1]?.layers[0]?.points.push(point)
				},
				code: "source.duplicate",
				message: "makes migration ambiguous",
			},
			{
				mutate(file: ReturnType<typeof legacyV4File>) {
					const point = file.glyphs[1]?.layers[0]?.points[0]
					if (point !== undefined) point.pointId = "point:glyph:unknown"
				},
				code: "source.reference",
				message: "not present in shared topology",
			},
		] as const

		for (const testCase of cases) {
			const legacy = legacyV4File()
			testCase.mutate(legacy)
			const decoded = decodeEditorFontSource(JSON.stringify(legacy))
			expect(decoded.ok).toBe(false)
			if (decoded.ok) continue
			expect(
				decoded.errors.some(
					(error) =>
						error.code === testCase.code &&
						error.message.includes(testCase.message),
				),
			).toBe(true)
		}
	})
})
