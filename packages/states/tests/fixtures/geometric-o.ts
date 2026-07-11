import type {
	ContourId,
	EditorFontSource,
	EditorGlyphSource,
	GlyphId,
	PointId,
} from "../../src/types.ts"

export const weightAxisId = "axis:wght"
export const razorMasterId = "master:razor"
export const blackMasterId = "master:black"
export const razorInstanceId = "instance:razor"
export const blackInstanceId = "instance:black"
export const notdefGlyphId = "glyph:.notdef"
export const oGlyphId = "glyph:O"

const outerCoordinates = [
	{ x: 500, y: 800 },
	{ x: 900, y: 800 },
	{ x: 900, y: 400 },
	{ x: 900, y: 0 },
	{ x: 500, y: 0 },
	{ x: 100, y: 0 },
	{ x: 100, y: 400 },
	{ x: 100, y: 800 },
] as const

const razorCounterCoordinates = [
	{ x: 500, y: 760 },
	{ x: 140, y: 760 },
	{ x: 140, y: 400 },
	{ x: 140, y: 40 },
	{ x: 500, y: 40 },
	{ x: 860, y: 40 },
	{ x: 860, y: 400 },
	{ x: 860, y: 760 },
] as const

const blackCounterCoordinates = [
	{ x: 500, y: 440 },
	{ x: 460, y: 440 },
	{ x: 460, y: 400 },
	{ x: 460, y: 360 },
	{ x: 500, y: 360 },
	{ x: 540, y: 360 },
	{ x: 540, y: 400 },
	{ x: 540, y: 440 },
] as const

const razorCoordinates = [...outerCoordinates, ...razorCounterCoordinates]
const blackCoordinates = [...outerCoordinates, ...blackCounterCoordinates]

const pointId = (glyphId: GlyphId, index: number): PointId =>
	`point:${glyphId}:${index.toString().padStart(2, "0")}`

const contourId = (glyphId: GlyphId, name: string): ContourId =>
	`contour:${glyphId}:${name}`

const topologyPoint = (glyphId: GlyphId, index: number) => ({
	id: pointId(glyphId, index),
	onCurve: index % 2 === 0,
})

const layerPoint = (
	glyphId: GlyphId,
	index: number,
	coordinate: { readonly x: number; readonly y: number },
) => ({
	pointId: pointId(glyphId, index),
	x: coordinate.x,
	y: coordinate.y,
})

const makeO = (id: GlyphId, name: string): EditorGlyphSource => ({
	id,
	name,
	export: true,
	contours: [
		{
			id: contourId(id, "outer"),
			points: Array.from({ length: 8 }, (_, index) => topologyPoint(id, index)),
		},
		{
			id: contourId(id, "counter"),
			points: Array.from({ length: 8 }, (_, index) =>
				topologyPoint(id, index + 8),
			),
		},
	],
	layers: [
		{
			masterId: razorMasterId,
			advanceWidth: 1_000,
			leftSideBearing: 100,
			points: razorCoordinates.map((coordinate, index) =>
				layerPoint(id, index, coordinate),
			),
		},
		{
			masterId: blackMasterId,
			advanceWidth: 1_000,
			leftSideBearing: 100,
			points: blackCoordinates.map((coordinate, index) =>
				layerPoint(id, index, coordinate),
			),
		},
	],
})

export function makeGeometricOEditorFont(): EditorFontSource {
	return {
		format: "trigraph.editor",
		editorVersion: 1,
		metadata: {
			unitsPerEm: 1_000,
			fontRevision: 1,
			vendorId: "TRIG",
			lowestPpem: 8,
		},
		names: {
			family: "Trigraph O Razor",
			subfamily: "Regular",
			uniqueId: "TRIG:Trigraph O Razor:1.000",
			fullName: "Trigraph O Razor",
			version: "Version 1.000",
			postScriptName: "TrigraphO-Razor",
			typographicFamily: "Trigraph O",
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
				id: weightAxisId,
				tag: "wght",
				name: "Weight",
				min: 100,
				default: 100,
				max: 900,
			},
		],
		masters: [
			{
				kind: "default",
				id: razorMasterId,
				name: "Razor",
			},
			{
				kind: "source",
				id: blackMasterId,
				name: "Black",
				location: { [weightAxisId]: 900 },
				support: { kind: "non-intermediate" },
			},
		],
		defaultMasterId: razorMasterId,
		instances: [
			{
				id: razorInstanceId,
				name: "Razor",
				coordinates: { [weightAxisId]: 100 },
				postScriptName: "TrigraphO-Razor",
				elidable: true,
			},
			{
				id: blackInstanceId,
				name: "Black",
				coordinates: { [weightAxisId]: 900 },
				postScriptName: "TrigraphO-Black",
			},
		],
		glyphs: [makeO(notdefGlyphId, ".notdef"), makeO(oGlyphId, "O")],
		cmap: [{ codePoint: 0x4f, glyphId: oGlyphId }],
	}
}
