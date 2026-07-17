import { describe, expect, it } from "vitest"

import {
	matchingVerticalMetrics,
	resolveVerticalMetricAlignment,
	resolveVerticalMetricGuides,
	resolveVerticalOvershootBandSegments,
} from "../src/vertical-metrics.ts"
import { makeGeometricOEditorFont } from "./fixtures/geometric-o.ts"

describe("vertical metric guides", () => {
	it("resolves lines, signed Windows descent, and semantic bands", () => {
		const guides = resolveVerticalMetricGuides(
			makeGeometricOEditorFont().metrics,
		)
		expect(guides.find((guide) => guide.id === "winDescent")).toMatchObject({
			kind: "line",
			y: -200,
		})
		expect(guides.find((guide) => guide.id === "lineGap")).toMatchObject({
			kind: "band",
			minY: 800,
			maxY: 800,
		})
		expect(
			guides.find((guide) => guide.id === "underlineThickness"),
		).toMatchObject({ kind: "band", minY: -150, maxY: -100 })
	})

	it("matches inclusive top and bottom overshoot boundaries", () => {
		const guides = resolveVerticalMetricGuides(
			makeGeometricOEditorFont().metrics,
		)
		expect(
			matchingVerticalMetrics(512, guides).map((guide) => guide.id),
		).toContain("xHeight")
		expect(
			matchingVerticalMetrics(513, guides).map((guide) => guide.id),
		).not.toContain("xHeight")
		expect(
			matchingVerticalMetrics(-12, guides).map((guide) => guide.id),
		).toContain("baseline")
		expect(
			matchingVerticalMetrics(-13, guides).map((guide) => guide.id),
		).not.toContain("baseline")
	})

	it("distinguishes exact lines from overshoot-only coordinates", () => {
		const guides = resolveVerticalMetricGuides(
			makeGeometricOEditorFont().metrics,
		)
		expect(resolveVerticalMetricAlignment(500, guides)).toMatchObject({
			kind: "line",
			lines: [{ id: "xHeight" }],
		})
		expect(resolveVerticalMetricAlignment(512, guides)).toMatchObject({
			kind: "overshoot",
			lines: [{ id: "xHeight" }],
		})
		expect(resolveVerticalMetricAlignment(-12, guides)).toMatchObject({
			kind: "overshoot",
			lines: [{ id: "baseline" }],
		})
		expect(resolveVerticalMetricAlignment(513, guides)).toBeNull()
	})

	it("gives an exact line priority while retaining overlapping matches", () => {
		const source = makeGeometricOEditorFont()
		const guides = resolveVerticalMetricGuides({
			...source.metrics,
			capHeight: 512,
		})
		const alignment = resolveVerticalMetricAlignment(512, guides)
		expect(alignment?.kind).toBe("line")
		expect(alignment?.lines.map((line) => line.id)).toEqual([
			"xHeight",
			"capHeight",
		])
	})

	it("keeps zero-depth zones exact-line-only", () => {
		const source = makeGeometricOEditorFont()
		const guides = resolveVerticalMetricGuides({
			...source.metrics,
			overshoots: {
				...source.metrics.overshoots,
				xHeight: 0,
			},
		})
		expect(resolveVerticalMetricAlignment(500, guides)?.kind).toBe("line")
		expect(resolveVerticalMetricAlignment(501, guides)).toBeNull()
	})

	it("resolves non-overlapping paint spans for overlapping zones", () => {
		const source = makeGeometricOEditorFont()
		const guides = resolveVerticalMetricGuides({
			...source.metrics,
			capHeight: 510,
			overshoots: {
				...source.metrics.overshoots,
				xHeight: 20,
				capHeight: 20,
			},
		})
		const spans = resolveVerticalOvershootBandSegments(guides).filter(
			(span) => span.minY >= 500,
		)
		expect(
			spans.map(({ minY, maxY, lines }) => ({
				minY,
				maxY,
				ids: lines.map((line) => line.id),
			})),
		).toEqual([
			{ minY: 500, maxY: 510, ids: ["xHeight"] },
			{ minY: 510, maxY: 520, ids: ["xHeight", "capHeight"] },
			{ minY: 520, maxY: 530, ids: ["capHeight"] },
		])
	})

	it("coalesces coincident zones into one paint span and omits zero depth", () => {
		const source = makeGeometricOEditorFont()
		const guides = resolveVerticalMetricGuides({
			...source.metrics,
			overshoots: {
				...source.metrics.overshoots,
				ascender: 12,
				winAscent: 12,
			},
		})
		const spans = resolveVerticalOvershootBandSegments(guides)
		const top = spans.find((span) => span.minY === 800)
		expect(top).toMatchObject({ minY: 800, maxY: 812 })
		expect(top?.lines.map((line) => line.id)).toEqual([
			"ascender",
			"winAscent",
			"capHeight",
		])
		expect(
			spans.some((span) => span.lines.some((line) => line.id === "descender")),
		).toBe(false)
	})
})
