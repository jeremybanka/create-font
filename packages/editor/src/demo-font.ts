import type {
	ContourId,
	EditorFontSource,
	EditorGlyphSource,
	GlyphId,
	PointId,
} from "@trigraph/states"

export const weightAxisId = "axis:wght" as const
export const razorMasterId = "master:razor" as const
export const blackMasterId = "master:black" as const
export const razorInstanceId = "instance:razor" as const
export const blackInstanceId = "instance:black" as const
export const notdefGlyphId = "glyph:.notdef" as const
export const oGlyphId = "glyph:O" as const

const outerCoordinates = [
	{ x: 500, y: 820 },
	{ x: 920, y: 820 },
	{ x: 920, y: 400 },
	{ x: 920, y: -20 },
	{ x: 500, y: -20 },
	{ x: 80, y: -20 },
	{ x: 80, y: 400 },
	{ x: 80, y: 820 },
] as const

const razorCounterCoordinates = [
	{ x: 500, y: 752 },
	{ x: 148, y: 752 },
	{ x: 148, y: 400 },
	{ x: 148, y: 48 },
	{ x: 500, y: 48 },
	{ x: 852, y: 48 },
	{ x: 852, y: 400 },
	{ x: 852, y: 752 },
] as const

const blackCounterCoordinates = [
	{ x: 500, y: 448 },
	{ x: 452, y: 448 },
	{ x: 452, y: 400 },
	{ x: 452, y: 352 },
	{ x: 500, y: 352 },
	{ x: 548, y: 352 },
	{ x: 548, y: 400 },
	{ x: 548, y: 448 },
] as const

const pointId = (glyphId: GlyphId, index: number): PointId =>
	`point:${glyphId}:${index.toString().padStart(2, "0")}`

const contourId = (glyphId: GlyphId, name: string): ContourId =>
	`contour:${glyphId}:${name}`

function makeGeometricO(id: GlyphId, name: string): EditorGlyphSource {
	const razorCoordinates = [...outerCoordinates, ...razorCounterCoordinates]
	const blackCoordinates = [...outerCoordinates, ...blackCounterCoordinates]
	return {
		id,
		name,
		export: true,
		color: name === "O" ? "#ce5d3d" : "#807c73",
		contours: [
			{
				id: contourId(id, "outer"),
				points: Array.from({ length: 8 }, (_, index) => ({
					id: pointId(id, index),
					onCurve: index % 2 === 0,
					smooth: true,
				})),
			},
			{
				id: contourId(id, "counter"),
				points: Array.from({ length: 8 }, (_, index) => ({
					id: pointId(id, index + 8),
					onCurve: index % 2 === 0,
					smooth: true,
				})),
			},
		],
		layers: [
			{
				masterId: razorMasterId,
				advanceWidth: 1_000,
				leftSideBearing: 80,
				points: razorCoordinates.map((coordinate, index) => ({
					pointId: pointId(id, index),
					...coordinate,
				})),
			},
			{
				masterId: blackMasterId,
				advanceWidth: 1_000,
				leftSideBearing: 80,
				points: blackCoordinates.map((coordinate, index) => ({
					pointId: pointId(id, index),
					...coordinate,
				})),
			},
		],
	}
}

export function makeDemoFont(): EditorFontSource {
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
			family: "Trigraph Geometric O",
			subfamily: "Razor",
			uniqueId: "TRIG:Trigraph Geometric O:1.000",
			fullName: "Trigraph Geometric O Razor",
			version: "Version 1.000",
			postScriptName: "TrigraphGeometricO-Razor",
			typographicFamily: "Trigraph Geometric O",
			typographicSubfamily: "Razor",
		},
		metrics: {
			ascender: 820,
			descender: -200,
			lineGap: 0,
			winAscent: 820,
			winDescent: 200,
			xHeight: 500,
			capHeight: 820,
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
			{ id: razorMasterId, kind: "default", name: "Razor" },
			{
				id: blackMasterId,
				kind: "source",
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
				postScriptName: "TrigraphGeometricO-Razor",
				elidable: true,
			},
			{
				id: blackInstanceId,
				name: "Black",
				coordinates: { [weightAxisId]: 900 },
				postScriptName: "TrigraphGeometricO-Black",
			},
		],
		glyphs: [
			makeGeometricO(notdefGlyphId, ".notdef"),
			makeGeometricO(oGlyphId, "O"),
		],
		cmap: [{ codePoint: 0x4f, glyphId: oGlyphId }],
	}
}
