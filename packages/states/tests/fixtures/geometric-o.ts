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
	mode: "soft" as const,
})

const handleVector = (
	node: { readonly x: number; readonly y: number },
	quadraticControl: { readonly x: number; readonly y: number },
) => ({
	x: (2 * (quadraticControl.x - node.x)) / 3,
	y: (2 * (quadraticControl.y - node.y)) / 3,
})

const layerContour = (
	glyphId: GlyphId,
	offset: number,
	coordinates: readonly { readonly x: number; readonly y: number }[],
) =>
	[0, 2, 4, 6].map((index) => {
		const coordinate = coordinates[offset + index]
		const incomingControl = coordinates[offset + ((index + 7) % 8)]
		const outgoingControl = coordinates[offset + ((index + 1) % 8)]
		if (
			coordinate === undefined ||
			incomingControl === undefined ||
			outgoingControl === undefined
		) {
			throw new Error("Geometric O fixture coordinates are incomplete.")
		}
		return {
			...topologyPoint(glyphId, offset + index),
			x: coordinate.x,
			y: coordinate.y,
			incoming: handleVector(coordinate, incomingControl),
			outgoing: handleVector(coordinate, outgoingControl),
		}
	})

const layerContours = (
	id: GlyphId,
	coordinates: readonly { readonly x: number; readonly y: number }[],
) => [
	{
		id: contourId(id, "outer"),
		closed: true,
		points: layerContour(id, 0, coordinates),
	},
	{
		id: contourId(id, "counter"),
		closed: true,
		points: layerContour(id, 8, coordinates),
	},
]

const makeO = (id: GlyphId, name: string): EditorGlyphSource => ({
	id,
	name,
	export: true,
	layers: [
		{
			masterId: razorMasterId,
			advanceWidth: 1_000,
			leftSideBearing: 100,
			contours: layerContours(id, razorCoordinates),
		},
		{
			masterId: blackMasterId,
			advanceWidth: 1_000,
			leftSideBearing: 100,
			contours: layerContours(id, blackCoordinates),
		},
	],
})

export function makeGeometricOEditorFont(): EditorFontSource {
	return {
		format: "create-font.editor",
		editorVersion: 5,
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
			overshoots: {
				baseline: 12,
				ascender: 0,
				descender: 0,
				winAscent: 0,
				winDescent: 0,
				xHeight: 12,
				capHeight: 12,
				underlinePosition: 0,
			},
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
				postScriptName: "CreateFontO-Razor",
				elidable: true,
			},
			{
				id: blackInstanceId,
				name: "Black",
				coordinates: { [weightAxisId]: 900 },
				postScriptName: "CreateFontO-Black",
			},
		],
		glyphs: [makeO(notdefGlyphId, ".notdef"), makeO(oGlyphId, "O")],
		cmap: [{ codePoint: 0x4f, glyphId: oGlyphId }],
	}
}
