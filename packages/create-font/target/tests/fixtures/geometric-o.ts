import type {
	PointDeltaSource,
	PointSource,
	VariableFontSource,
} from "../../src/model.ts"

export const outerContour = [
	{ x: 500, y: 800, onCurve: true },
	{ x: 900, y: 800, onCurve: false },
	{ x: 900, y: 400, onCurve: true },
	{ x: 900, y: 0, onCurve: false },
	{ x: 500, y: 0, onCurve: true },
	{ x: 100, y: 0, onCurve: false },
	{ x: 100, y: 400, onCurve: true },
	{ x: 100, y: 800, onCurve: false },
] as const satisfies readonly PointSource[]

export const razorCounter = [
	{ x: 500, y: 760, onCurve: true },
	{ x: 140, y: 760, onCurve: false },
	{ x: 140, y: 400, onCurve: true },
	{ x: 140, y: 40, onCurve: false },
	{ x: 500, y: 40, onCurve: true },
	{ x: 860, y: 40, onCurve: false },
	{ x: 860, y: 400, onCurve: true },
	{ x: 860, y: 760, onCurve: false },
] as const satisfies readonly PointSource[]

export const blackCounter = [
	{ x: 500, y: 440, onCurve: true },
	{ x: 460, y: 440, onCurve: false },
	{ x: 460, y: 400, onCurve: true },
	{ x: 460, y: 360, onCurve: false },
	{ x: 500, y: 360, onCurve: true },
	{ x: 540, y: 360, onCurve: false },
	{ x: 540, y: 400, onCurve: true },
	{ x: 540, y: 440, onCurve: false },
] as const satisfies readonly PointSource[]

const zeroOuterDeltas = outerContour.map(() => ({ x: 0, y: 0 }))

export const razorToBlackDeltas = [
	...zeroOuterDeltas,
	{ x: 0, y: -320 },
	{ x: 320, y: -320 },
	{ x: 320, y: 0 },
	{ x: 320, y: 320 },
	{ x: 0, y: 320 },
	{ x: -320, y: 320 },
	{ x: -320, y: 0 },
	{ x: -320, y: -320 },
] as const satisfies readonly PointDeltaSource[]

const makeO = (name: string) => ({
	kind: "simple" as const,
	name,
	advanceWidth: 1_000,
	leftSideBearing: 100,
	contours: [outerContour, razorCounter],
	variations: [
		{
			region: { peak: { wght: 1 } },
			deltas: {
				points: razorToBlackDeltas,
				phantom: { left: 0, right: 0, top: 0, bottom: 0 },
			},
		},
	],
})

export function makeGeometricOFont(): VariableFontSource {
	return {
		format: "create-font.variable-truetype",
		irVersion: 1,
		metadata: {
			unitsPerEm: 1_000,
			fontRevision: 1,
			vendorId: "CRFT",
			lowestPpem: 8,
		},
		names: {
			family: "Create Font O Razor",
			subfamily: "Regular",
			uniqueId: "CRFT:Create Font O Razor:1.000",
			fullName: "Create Font O Razor",
			version: "Version 1.000",
			postScriptName: "CreateFontO-Razor",
			typographicFamily: "Create Font O",
			typographicSubfamily: "Razor",
		},
		metrics: {
			ascender: 800,
			descender: -200,
			lineGap: 0,
			winAscent: 800,
			winDescent: 200,
			xHeight: 500,
			capHeight: 800,
			underlinePosition: -100,
			underlineThickness: 50,
		},
		style: {
			weightClass: 100,
			widthClass: 5,
			italic: false,
			bold: false,
			oblique: false,
			italicAngle: 0,
		},
		axes: [
			{
				tag: "wght",
				name: "Weight",
				min: 100,
				default: 100,
				max: 900,
			},
		],
		instances: [
			{
				name: "Razor",
				coordinates: { wght: 100 },
				postScriptName: "CreateFontO-Razor",
				elidable: true,
			},
			{
				name: "Black",
				coordinates: { wght: 900 },
				postScriptName: "CreateFontO-Black",
			},
		],
		glyphs: [makeO(".notdef"), makeO("O")],
		cmap: [{ codePoint: 0x4f, glyph: 1 }],
	}
}
