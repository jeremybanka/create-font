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
export const aGlyphId = "glyph:A" as const
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

const razorAOuterCoordinates = [
	{ x: 80, y: 0 },
	{ x: 400, y: 820 },
	{ x: 600, y: 820 },
	{ x: 920, y: 0 },
	{ x: 700, y: 0 },
	{ x: 630, y: 190 },
	{ x: 370, y: 190 },
	{ x: 300, y: 0 },
] as const

const blackAOuterCoordinates = [
	{ x: 40, y: 0 },
	{ x: 350, y: 820 },
	{ x: 650, y: 820 },
	{ x: 960, y: 0 },
	{ x: 650, y: 0 },
	{ x: 570, y: 190 },
	{ x: 430, y: 190 },
	{ x: 350, y: 0 },
] as const

const razorACounterCoordinates = [
	{ x: 400, y: 330 },
	{ x: 600, y: 330 },
	{ x: 500, y: 620 },
] as const

const blackACounterCoordinates = [
	{ x: 440, y: 330 },
	{ x: 560, y: 330 },
	{ x: 500, y: 560 },
] as const

const pointId = (glyphId: GlyphId, index: number): PointId =>
	`point:${glyphId}:${index.toString().padStart(2, "0")}`

const contourId = (glyphId: GlyphId, name: string): ContourId =>
	`contour:${glyphId}:${name}`

interface Coordinate {
	readonly x: number
	readonly y: number
}

/** Degree-elevates the fixture's quadratic controls into node-owned cubics. */
function cubicNodes(
	glyphId: GlyphId,
	coordinates: readonly Coordinate[],
	pointOffset: number,
) {
	return coordinates.flatMap((coordinate, index) => {
		if (index % 2 !== 0) return []
		const incomingControl =
			coordinates[(index - 1 + coordinates.length) % coordinates.length]
		const outgoingControl = coordinates[(index + 1) % coordinates.length]
		if (incomingControl === undefined || outgoingControl === undefined)
			return []
		return [
			{
				pointId: pointId(glyphId, pointOffset + index),
				x: coordinate.x,
				y: coordinate.y,
				incoming: {
					x: (2 * (incomingControl.x - coordinate.x)) / 3,
					y: (2 * (incomingControl.y - coordinate.y)) / 3,
				},
				outgoing: {
					x: (2 * (outgoingControl.x - coordinate.x)) / 3,
					y: (2 * (outgoingControl.y - coordinate.y)) / 3,
				},
			},
		]
	})
}

function makeGeometricO(id: GlyphId, name: string): EditorGlyphSource {
	return {
		id,
		name,
		export: true,
		color: name === "O" ? "#ce5d3d" : "#807c73",
		contours: [
			{
				id: contourId(id, "outer"),
				closed: true,
				points: Array.from({ length: 4 }, (_, index) => ({
					id: pointId(id, index * 2),
					mode: "soft" as const,
				})),
			},
			{
				id: contourId(id, "counter"),
				closed: true,
				points: Array.from({ length: 4 }, (_, index) => ({
					id: pointId(id, index * 2 + 8),
					mode: "soft" as const,
				})),
			},
		],
		layers: [
			{
				masterId: razorMasterId,
				advanceWidth: 1_000,
				leftSideBearing: 80,
				points: [
					...cubicNodes(id, outerCoordinates, 0),
					...cubicNodes(id, razorCounterCoordinates, 8),
				],
			},
			{
				masterId: blackMasterId,
				advanceWidth: 1_000,
				leftSideBearing: 80,
				points: [
					...cubicNodes(id, outerCoordinates, 0),
					...cubicNodes(id, blackCounterCoordinates, 8),
				],
			},
		],
	}
}

function hardNodes(
	glyphId: GlyphId,
	coordinates: readonly Coordinate[],
	pointOffset: number,
) {
	return coordinates.map((coordinate, index) => ({
		pointId: pointId(glyphId, pointOffset + index),
		x: coordinate.x,
		y: coordinate.y,
	}))
}

function makeGeometricA(): EditorGlyphSource {
	return {
		id: aGlyphId,
		name: "A",
		export: true,
		color: "#d5963f",
		contours: [
			{
				id: contourId(aGlyphId, "outer"),
				closed: true,
				points: razorAOuterCoordinates.map((_, index) => ({
					id: pointId(aGlyphId, index),
					mode: "hard" as const,
				})),
			},
			{
				id: contourId(aGlyphId, "counter"),
				closed: true,
				points: razorACounterCoordinates.map((_, index) => ({
					id: pointId(aGlyphId, index + razorAOuterCoordinates.length),
					mode: "hard" as const,
				})),
			},
		],
		layers: [
			{
				masterId: razorMasterId,
				advanceWidth: 1_000,
				leftSideBearing: 80,
				points: [
					...hardNodes(aGlyphId, razorAOuterCoordinates, 0),
					...hardNodes(
						aGlyphId,
						razorACounterCoordinates,
						razorAOuterCoordinates.length,
					),
				],
			},
			{
				masterId: blackMasterId,
				advanceWidth: 1_000,
				leftSideBearing: 80,
				points: [
					...hardNodes(aGlyphId, blackAOuterCoordinates, 0),
					...hardNodes(
						aGlyphId,
						blackACounterCoordinates,
						blackAOuterCoordinates.length,
					),
				],
			},
		],
	}
}

export function makeDemoFont(): EditorFontSource {
	return {
		format: "trigraph.editor",
		editorVersion: 3,
		metadata: {
			unitsPerEm: 1_000,
			fontRevision: 1,
			vendorId: "TRIG",
			lowestPpem: 8,
		},
		names: {
			family: "Trigraph Geometric",
			subfamily: "Razor",
			uniqueId: "TRIG:Trigraph Geometric:1.000",
			fullName: "Trigraph Geometric Razor",
			version: "Version 1.000",
			postScriptName: "TrigraphGeometric-Razor",
			typographicFamily: "Trigraph Geometric",
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
				postScriptName: "TrigraphGeometric-Razor",
				elidable: true,
			},
			{
				id: blackInstanceId,
				name: "Black",
				coordinates: { [weightAxisId]: 900 },
				postScriptName: "TrigraphGeometric-Black",
			},
		],
		glyphs: [
			makeGeometricO(notdefGlyphId, ".notdef"),
			makeGeometricA(),
			makeGeometricO(oGlyphId, "O"),
		],
		cmap: [
			{ codePoint: 0x41, glyphId: aGlyphId },
			{ codePoint: 0x4f, glyphId: oGlyphId },
		],
	}
}
