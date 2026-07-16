import { mkdir, rm, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"

import type {
	EditorFontSource,
	EditorGlyphSource,
	GlyphId,
	MasterId,
	PointId,
} from "../packages/states/src/index.ts"
import {
	formatSourceUnit,
	sourceUnitKindForPath,
	splitEditorFontSource,
} from "../packages/source/src/index.ts"
import { makeDemoFont } from "../packages/editor/src/demo-font.ts"

type Coordinate = Readonly<{ x: number; y: number }>
type ContourCoordinates = readonly Coordinate[]

const thinMasterId = "master:razor"
const blackMasterId = "master:black"

function pointId(glyphId: GlyphId, contourIndex: number, pointIndex: number) {
	return `point:${glyphId}:${contourIndex}:${pointIndex}` as PointId
}

function polygonGlyph(
	id: GlyphId,
	name: string,
	advanceWidth: number,
	thinContours: readonly ContourCoordinates[],
	blackContours: readonly ContourCoordinates[],
	leftSideBearing = 60,
): EditorGlyphSource {
	if (
		thinContours.length !== blackContours.length ||
		thinContours.some(
			(contour, index) => contour.length !== blackContours[index]?.length,
		)
	) {
		throw new Error(`Glyph ${name} masters must share one topology.`)
	}
	const contours = thinContours.map((coordinates, contourIndex) => ({
		id: `contour:${id}:${contourIndex}`,
		closed: true,
		points: coordinates.map((_, pointIndex) => ({
			id: pointId(id, contourIndex, pointIndex),
			mode: `hard` as const,
		})),
	}))
	const layer = (
		masterId: MasterId,
		layerContours: readonly ContourCoordinates[],
	) => ({
		masterId,
		advanceWidth,
		leftSideBearing,
		points: layerContours.flatMap((coordinates, contourIndex) =>
			coordinates.map((coordinate, pointIndex) => ({
				pointId: pointId(id, contourIndex, pointIndex),
				...coordinate,
			})),
		),
	})
	return {
		id,
		name,
		export: true,
		contours,
		layers: [
			layer(thinMasterId, thinContours),
			layer(blackMasterId, blackContours),
		],
	}
}

function cloneScaledGlyph(
	source: EditorGlyphSource,
	id: GlyphId,
	name: string,
	scaleX: number,
	scaleY: number,
	offsetY: number,
	advanceWidth: number,
	leftSideBearing: number,
): EditorGlyphSource {
	const pointIds = new Map<PointId, PointId>()
	const contours = source.contours.map((contour, contourIndex) => ({
		...contour,
		id: `contour:${id}:${contourIndex}`,
		points: contour.points.map((point, pointIndex) => {
			const nextId = pointId(id, contourIndex, pointIndex)
			pointIds.set(point.id, nextId)
			return { ...point, id: nextId }
		}),
	}))
	return {
		...source,
		id,
		name,
		contours,
		layers: source.layers.map((layer) => ({
			...layer,
			advanceWidth,
			leftSideBearing,
			points: layer.points.map((point) => ({
				...point,
				pointId: pointIds.get(point.pointId) ?? point.pointId,
				x: Math.round(point.x * scaleX),
				y: Math.round(point.y * scaleY + offsetY),
				...(point.incoming === undefined
					? {}
					: {
							incoming: {
								x: Math.round(point.incoming.x * scaleX),
								y: Math.round(point.incoming.y * scaleY),
							},
						}),
				...(point.outgoing === undefined
					? {}
					: {
							outgoing: {
								x: Math.round(point.outgoing.x * scaleX),
								y: Math.round(point.outgoing.y * scaleY),
							},
						}),
			})),
		})),
	}
}

function makeCreateFontSans(): EditorFontSource {
	const demo = makeDemoFont()
	const notdef = demo.glyphs.find((glyph) => glyph.name === `.notdef`)
	const uppercaseO = demo.glyphs.find((glyph) => glyph.name === `O`)
	if (notdef === undefined || uppercaseO === undefined) {
		throw new Error(`The editor fixture must provide .notdef and O.`)
	}
	const space: EditorGlyphSource = {
		id: `glyph:space`,
		name: `space`,
		export: true,
		contours: [],
		layers: [
			{
				masterId: thinMasterId,
				advanceWidth: 320,
				leftSideBearing: 0,
				points: [],
			},
			{
				masterId: blackMasterId,
				advanceWidth: 360,
				leftSideBearing: 0,
				points: [],
			},
		],
	}
	const a = polygonGlyph(
		`glyph:A`,
		`A`,
		800,
		[
			[
				{ x: 40, y: 0 },
				{ x: 330, y: 820 },
				{ x: 470, y: 820 },
				{ x: 760, y: 0 },
				{ x: 650, y: 0 },
				{ x: 570, y: 230 },
				{ x: 230, y: 230 },
				{ x: 150, y: 0 },
			],
			[
				{ x: 285, y: 350 },
				{ x: 400, y: 690 },
				{ x: 515, y: 350 },
			],
		],
		[
			[
				{ x: 20, y: 0 },
				{ x: 260, y: 820 },
				{ x: 540, y: 820 },
				{ x: 780, y: 0 },
				{ x: 590, y: 0 },
				{ x: 535, y: 190 },
				{ x: 265, y: 190 },
				{ x: 210, y: 0 },
			],
			[
				{ x: 330, y: 350 },
				{ x: 400, y: 590 },
				{ x: 470, y: 350 },
			],
		],
		40,
	)
	const h = polygonGlyph(
		`glyph:H`,
		`H`,
		820,
		[
			[
				{ x: 60, y: 0 },
				{ x: 60, y: 820 },
				{ x: 150, y: 820 },
				{ x: 150, y: 0 },
			],
			[
				{ x: 670, y: 0 },
				{ x: 670, y: 820 },
				{ x: 760, y: 820 },
				{ x: 760, y: 0 },
			],
			[
				{ x: 150, y: 365 },
				{ x: 150, y: 455 },
				{ x: 670, y: 455 },
				{ x: 670, y: 365 },
			],
		],
		[
			[
				{ x: 50, y: 0 },
				{ x: 50, y: 820 },
				{ x: 260, y: 820 },
				{ x: 260, y: 0 },
			],
			[
				{ x: 560, y: 0 },
				{ x: 560, y: 820 },
				{ x: 770, y: 820 },
				{ x: 770, y: 0 },
			],
			[
				{ x: 260, y: 300 },
				{ x: 260, y: 520 },
				{ x: 560, y: 520 },
				{ x: 560, y: 300 },
			],
		],
	)
	const n = polygonGlyph(
		`glyph:n`,
		`n`,
		720,
		[
			[
				{ x: 60, y: 0 },
				{ x: 60, y: 560 },
				{ x: 145, y: 560 },
				{ x: 145, y: 485 },
				{ x: 235, y: 560 },
				{ x: 420, y: 560 },
				{ x: 590, y: 390 },
				{ x: 590, y: 0 },
				{ x: 500, y: 0 },
				{ x: 500, y: 360 },
				{ x: 390, y: 470 },
				{ x: 250, y: 470 },
				{ x: 150, y: 370 },
				{ x: 150, y: 0 },
			],
		],
		[
			[
				{ x: 50, y: 0 },
				{ x: 50, y: 560 },
				{ x: 250, y: 560 },
				{ x: 250, y: 505 },
				{ x: 300, y: 560 },
				{ x: 450, y: 560 },
				{ x: 650, y: 360 },
				{ x: 650, y: 0 },
				{ x: 450, y: 0 },
				{ x: 450, y: 300 },
				{ x: 390, y: 360 },
				{ x: 330, y: 360 },
				{ x: 250, y: 280 },
				{ x: 250, y: 0 },
			],
		],
	)
	const lowercaseO = cloneScaledGlyph(
		uppercaseO,
		`glyph:o`,
		`o`,
		0.7,
		0.7,
		0,
		720,
		56,
	)
	return {
		...demo,
		names: {
			family: `Create Font Sans`,
			subfamily: `Razor`,
			uniqueId: `CRFT:Create Font Sans:1.000`,
			fullName: `Create Font Sans Razor`,
			version: `Version 1.000`,
			postScriptName: `CreateFontSans-Razor`,
			typographicFamily: `Create Font Sans`,
			typographicSubfamily: `Razor`,
		},
		glyphs: [
			notdef,
			space,
			a,
			h,
			{ ...uppercaseO, color: `#ce5d3d` },
			n,
			lowercaseO,
		],
		cmap: [
			{ codePoint: 0x20, glyphId: `glyph:space` },
			{ codePoint: 0x41, glyphId: `glyph:A` },
			{ codePoint: 0x48, glyphId: `glyph:H` },
			{ codePoint: 0x4f, glyphId: `glyph:O` },
			{ codePoint: 0x6e, glyphId: `glyph:n` },
			{ codePoint: 0x6f, glyphId: `glyph:o` },
		],
	}
}

const projectRoot = resolve(import.meta.dir, `..`, `fonts`, `create-font-sans`)
const split = splitEditorFontSource(makeCreateFontSans())
if (!split.ok) throw new Error(split.errors[0].message)

await rm(projectRoot, { force: true, recursive: true })
for (const [path, value] of Object.entries(split.value)) {
	const kind = sourceUnitKindForPath(path)
	if (kind === null) throw new Error(`Unknown generated source unit ${path}.`)
	const formatted = formatSourceUnit(kind, value, path)
	if (!formatted.ok) throw new Error(formatted.errors[0].message)
	const destination = resolve(projectRoot, path)
	await mkdir(dirname(destination), { recursive: true })
	await writeFile(destination, formatted.value)
}
await writeFile(
	resolve(projectRoot, `README.md`),
	`# Create Font Sans

Create Font Sans is the repository's live development font. It is a small,
two-master variable sans with uppercase and lowercase source glyphs, a space,
character mappings, and reviewable per-entity JSON units.

The editor and RPC integration use this checked-in source directly; it is not a
generated browser fixture.
`,
)
