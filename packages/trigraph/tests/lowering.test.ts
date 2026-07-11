import { describe, expect, it } from "vitest"

import {
	createLoweringPlan,
	getTableTags,
	ingestVariableFont,
	REQUIRED_TABLE_TAGS,
	type VariableFont,
} from "../src/index.ts"
import { makeGeometricOFont } from "./fixtures/geometric-o.ts"

describe("lowering facts", () => {
	it("derives every duplicated table-level value for the geometric O", () => {
		const result = ingestVariableFont(makeGeometricOFont())
		if (!result.ok) throw new Error("fixture must ingest")

		const plan = createLoweringPlan(result.value)
		expect(plan.sfntVersion).toBe(0x0001_0000)
		expect(plan.tableTags).toEqual(REQUIRED_TABLE_TAGS)
		expect(plan.glyphCount).toBe(2)
		expect(plan.head).toEqual({
			xMin: 100,
			yMin: 0,
			xMax: 900,
			yMax: 800,
		})
		expect(plan.glyphs).toEqual([
			expect.objectContaining({
				glyphId: 0,
				contourCount: 2,
				pointCount: 16,
				gvarTargetPointCount: 20,
			}),
			expect.objectContaining({
				glyphId: 1,
				contourCount: 2,
				pointCount: 16,
				gvarTargetPointCount: 20,
			}),
		])
		expect(plan.encoding).toMatchObject({
			cmap: {
				format: 4,
				platformId: 3,
				encodingId: 1,
				segmentCount: 2,
				glyphIdArrayLength: 0,
				subtableLength: 32,
				tableLength: 44,
			},
			indexToLocFormat: 1,
			os2Version: 4,
			postFormat: 3,
			statAxisValueFormat: 1,
			numberOfHMetrics: 1,
			fvarHasPostScriptNameIds: true,
			glyfCoordinates: "uncompressed",
			gvarOffsets: "long",
			gvarPointNumbers: "all",
			gvarSharedTupleCount: 0,
		})
		expect(plan.encoding.tableLengths.map(({ tag }) => tag)).toEqual(
			plan.tableTags,
		)
		expect(plan.encoding.sfntSize).toBeGreaterThan(0)
		expect(plan.hhea).toEqual({
			advanceWidthMax: 1_000,
			minLeftSideBearing: 100,
			minRightSideBearing: 100,
			xMaxExtent: 900,
			numberOfHMetrics: 1,
		})
		expect(plan.maxp).toEqual({
			version: 0x0001_0000,
			numGlyphs: 2,
			maxPoints: 16,
			maxContours: 2,
			maxCompositePoints: 0,
			maxCompositeContours: 0,
			maxZones: 1,
			maxTwilightPoints: 0,
			maxStorage: 0,
			maxFunctionDefs: 0,
			maxInstructionDefs: 0,
			maxStackElements: 0,
			maxSizeOfInstructions: 0,
			maxComponentElements: 0,
			maxComponentDepth: 0,
		})
		expect(Object.isFrozen(plan)).toBe(true)
		expect(Object.isFrozen(plan.glyphs[0]?.bounds)).toBe(true)
	})

	it("requires the runtime ingestion proof even after a type assertion", () => {
		const result = ingestVariableFont(makeGeometricOFont())
		if (!result.ok) throw new Error("fixture must ingest")
		const spread = { ...result.value } as unknown as VariableFont

		expect(() => createLoweringPlan(spread)).toThrow(
			"Expected a VariableFont returned by ingestVariableFont()",
		)
	})

	it("adds avar in bytewise SFNT tag order only when a map is present", () => {
		const source = makeGeometricOFont()
		const result = ingestVariableFont({
			...source,
			axes: [
				{
					...source.axes[0],
					map: [
						{ from: -1, to: -1 },
						{ from: 0, to: 0 },
						{ from: 0.5, to: 0.75 },
						{ from: 1, to: 1 },
					],
				},
			],
		})
		if (!result.ok) throw new Error("mapped fixture must ingest")

		expect(getTableTags(result.value)).toEqual([
			"OS/2",
			"STAT",
			"avar",
			"cmap",
			"fvar",
			"glyf",
			"gvar",
			"head",
			"hhea",
			"hmtx",
			"loca",
			"maxp",
			"name",
			"post",
		])
	})

	it("ignores empty glyphs for hhea bearing extrema", () => {
		const source = makeGeometricOFont()
		const emptyGlyph = (name: string) => ({
			kind: "simple" as const,
			name,
			advanceWidth: 1_000,
			leftSideBearing: 0,
			contours: [],
			variations: [],
		})
		const result = ingestVariableFont({
			...source,
			glyphs: [emptyGlyph(".notdef"), emptyGlyph("O")],
		})
		if (!result.ok) throw new Error("empty fixture must ingest")

		expect(createLoweringPlan(result.value).hhea).toEqual({
			advanceWidthMax: 1_000,
			minLeftSideBearing: 0,
			minRightSideBearing: 0,
			xMaxExtent: 0,
			numberOfHMetrics: 1,
		})
	})

	it("does not let a mixed-in empty glyph change outlined hhea extrema", () => {
		const source = makeGeometricOFont()
		const result = ingestVariableFont({
			...source,
			glyphs: [
				...source.glyphs,
				{
					kind: "simple",
					name: "empty",
					advanceWidth: 1_000,
					leftSideBearing: 0,
					contours: [],
					variations: [],
				},
			],
		})
		if (!result.ok) throw new Error("mixed empty fixture must ingest")

		expect(createLoweringPlan(result.value).hhea).toEqual({
			advanceWidthMax: 1_000,
			minLeftSideBearing: 100,
			minRightSideBearing: 100,
			xMaxExtent: 900,
			numberOfHMetrics: 1,
		})
	})

	it("keeps the final distinct advance in the long hmtx prefix", () => {
		const source = makeGeometricOFont()
		const template = source.glyphs[1]
		if (template === undefined) return
		const result = ingestVariableFont({
			...source,
			glyphs: [
				...source.glyphs,
				{ ...template, name: "O.alt-1", advanceWidth: 800 },
				{ ...template, name: "O.alt-2", advanceWidth: 800 },
			],
		})
		if (!result.ok) throw new Error("hmtx fixture must ingest")

		expect(createLoweringPlan(result.value).hhea.numberOfHMetrics).toBe(3)
	})
})
