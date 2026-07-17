import { describe, expect, it } from "vitest"

import {
	matchingVerticalMetrics,
	resolveVerticalMetricGuides,
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
})
