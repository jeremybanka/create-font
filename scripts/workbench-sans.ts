import { mkdir, rm, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"

import type {
	EditorFontSource,
	EditorGlyphSource,
	GlyphId,
	MasterId,
} from "../packages/states/src/index.ts"
import {
	formatSourceUnit,
	sourceUnitKindForPath,
	splitEditorFontSource,
} from "../packages/source/src/index.ts"

type Coordinate = Readonly<{ x: number; y: number }>
type Stroke = readonly [Coordinate, Coordinate]

const textMasterId = "master:text" as MasterId
const heavyMasterId = "master:heavy" as MasterId
const weightAxisId = "axis:wght"

const CAP_HEIGHT = 700
const X_HEIGHT = 500
const DESCENDER = -150
const TEXT_STROKE = 64
const HEAVY_STROKE = 150

function stroke(x1: number, y1: number, x2: number, y2: number): Stroke {
	return [
		{ x: x1, y: y1 },
		{ x: x2, y: y2 },
	]
}

const segment = {
	top: stroke(100, CAP_HEIGHT, 600, CAP_HEIGHT),
	middle: stroke(100, 350, 600, 350),
	bottom: stroke(100, 0, 600, 0),
	upperLeft: stroke(100, CAP_HEIGHT, 100, 350),
	lowerLeft: stroke(100, 350, 100, 0),
	upperRight: stroke(600, CAP_HEIGHT, 600, 350),
	lowerRight: stroke(600, 350, 600, 0),
	center: stroke(350, CAP_HEIGHT, 350, 0),
	centerTop: stroke(350, CAP_HEIGHT, 350, 350),
	centerBottom: stroke(350, 350, 350, 0),
	down: stroke(100, CAP_HEIGHT, 600, 0),
	up: stroke(100, 0, 600, CAP_HEIGHT),
} as const

const uppercase: Readonly<Record<string, readonly Stroke[]>> = {
	A: [
		stroke(100, 0, 350, CAP_HEIGHT),
		stroke(350, CAP_HEIGHT, 600, 0),
		stroke(205, 300, 495, 300),
	],
	B: [
		segment.top,
		segment.middle,
		segment.bottom,
		segment.upperLeft,
		segment.lowerLeft,
		segment.upperRight,
		segment.lowerRight,
	],
	C: [segment.top, segment.upperLeft, segment.lowerLeft, segment.bottom],
	D: [
		segment.top,
		segment.bottom,
		segment.upperLeft,
		segment.lowerLeft,
		segment.upperRight,
		segment.lowerRight,
	],
	E: [
		segment.top,
		segment.middle,
		segment.bottom,
		segment.upperLeft,
		segment.lowerLeft,
	],
	F: [segment.top, segment.middle, segment.upperLeft, segment.lowerLeft],
	G: [
		segment.top,
		segment.upperLeft,
		segment.lowerLeft,
		segment.bottom,
		stroke(350, 350, 600, 350),
		segment.lowerRight,
	],
	H: [
		segment.upperLeft,
		segment.lowerLeft,
		segment.upperRight,
		segment.lowerRight,
		segment.middle,
	],
	I: [segment.top, segment.center, segment.bottom],
	J: [
		segment.top,
		segment.upperRight,
		segment.lowerRight,
		segment.bottom,
		segment.lowerLeft,
	],
	K: [
		segment.upperLeft,
		segment.lowerLeft,
		stroke(100, 350, 600, CAP_HEIGHT),
		stroke(100, 350, 600, 0),
	],
	L: [segment.upperLeft, segment.lowerLeft, segment.bottom],
	M: [
		segment.upperLeft,
		segment.lowerLeft,
		segment.upperRight,
		segment.lowerRight,
		stroke(100, CAP_HEIGHT, 350, 350),
		stroke(350, 350, 600, CAP_HEIGHT),
	],
	N: [
		segment.upperLeft,
		segment.lowerLeft,
		segment.upperRight,
		segment.lowerRight,
		segment.down,
	],
	O: [
		segment.top,
		segment.upperLeft,
		segment.lowerLeft,
		segment.bottom,
		segment.upperRight,
		segment.lowerRight,
	],
	P: [
		segment.top,
		segment.middle,
		segment.upperLeft,
		segment.lowerLeft,
		segment.upperRight,
	],
	Q: [
		segment.top,
		segment.upperLeft,
		segment.lowerLeft,
		segment.bottom,
		segment.upperRight,
		segment.lowerRight,
		stroke(370, 220, 650, -80),
	],
	R: [
		segment.top,
		segment.middle,
		segment.upperLeft,
		segment.lowerLeft,
		segment.upperRight,
		stroke(350, 350, 600, 0),
	],
	S: [
		segment.top,
		segment.upperLeft,
		segment.middle,
		segment.lowerRight,
		segment.bottom,
	],
	T: [segment.top, segment.center],
	U: [
		segment.upperLeft,
		segment.lowerLeft,
		segment.bottom,
		segment.upperRight,
		segment.lowerRight,
	],
	V: [stroke(100, CAP_HEIGHT, 350, 0), stroke(350, 0, 600, CAP_HEIGHT)],
	W: [
		segment.upperLeft,
		segment.lowerLeft,
		segment.upperRight,
		segment.lowerRight,
		stroke(100, 0, 350, 260),
		stroke(350, 260, 600, 0),
	],
	X: [segment.down, segment.up],
	Y: [
		stroke(100, CAP_HEIGHT, 350, 350),
		stroke(600, CAP_HEIGHT, 350, 350),
		segment.centerBottom,
	],
	Z: [segment.top, segment.down, segment.bottom],
}

const digitSegments: Readonly<
	Record<string, readonly (keyof typeof segment)[]>
> = {
	"0": ["top", "upperLeft", "lowerLeft", "bottom", "upperRight", "lowerRight"],
	"1": ["upperRight", "lowerRight"],
	"2": ["top", "upperRight", "middle", "lowerLeft", "bottom"],
	"3": ["top", "upperRight", "middle", "lowerRight", "bottom"],
	"4": ["upperLeft", "middle", "upperRight", "lowerRight"],
	"5": ["top", "upperLeft", "middle", "lowerRight", "bottom"],
	"6": ["top", "upperLeft", "middle", "lowerLeft", "lowerRight", "bottom"],
	"7": ["top", "upperRight", "lowerRight"],
	"8": [
		"top",
		"upperLeft",
		"upperRight",
		"middle",
		"lowerLeft",
		"lowerRight",
		"bottom",
	],
	"9": ["top", "upperLeft", "upperRight", "middle", "lowerRight", "bottom"],
}

const dot = stroke(315, 0, 385, 0)
const punctuation: Readonly<Record<string, readonly Stroke[]>> = {
	"!": [stroke(350, 180, 350, CAP_HEIGHT), dot],
	'"': [stroke(260, 520, 260, CAP_HEIGHT), stroke(440, 520, 440, CAP_HEIGHT)],
	"#": [
		stroke(245, 0, 245, CAP_HEIGHT),
		stroke(455, 0, 455, CAP_HEIGHT),
		stroke(100, 240, 600, 240),
		stroke(100, 470, 600, 470),
	],
	$: [...uppercase.S, stroke(350, -80, 350, 780)],
	"%": [
		segment.up,
		stroke(110, 560, 250, CAP_HEIGHT),
		stroke(450, 0, 590, 140),
	],
	"&": [segment.up, segment.down, segment.top, segment.bottom],
	"'": [stroke(350, 520, 350, CAP_HEIGHT)],
	"(": [stroke(420, CAP_HEIGHT, 250, 350), stroke(250, 350, 420, 0)],
	")": [stroke(280, CAP_HEIGHT, 450, 350), stroke(450, 350, 280, 0)],
	"*": [
		stroke(350, 180, 350, 620),
		stroke(170, 250, 530, 550),
		stroke(170, 550, 530, 250),
	],
	"+": [stroke(120, 350, 580, 350), stroke(350, 120, 350, 580)],
	",": [dot, stroke(350, 0, 270, DESCENDER)],
	"-": [stroke(140, 350, 560, 350)],
	".": [dot],
	"/": [segment.up],
	":": [stroke(315, 500, 385, 500), stroke(315, 120, 385, 120)],
	";": [
		stroke(315, 500, 385, 500),
		stroke(315, 120, 385, 120),
		stroke(350, 120, 270, DESCENDER),
	],
	"<": [stroke(560, 620, 160, 350), stroke(160, 350, 560, 80)],
	"=": [stroke(140, 450, 560, 450), stroke(140, 250, 560, 250)],
	">": [stroke(140, 620, 540, 350), stroke(540, 350, 140, 80)],
	"?": [
		segment.top,
		segment.upperRight,
		stroke(600, 350, 350, 230),
		stroke(350, 230, 350, 150),
		dot,
	],
	"@": [
		...uppercase.O,
		stroke(250, 180, 250, 500),
		stroke(250, 500, 500, 500),
		stroke(500, 500, 500, 180),
		stroke(500, 180, 350, 180),
	],
	"[": [segment.top, segment.upperLeft, segment.lowerLeft, segment.bottom],
	"\\": [segment.down],
	"]": [segment.top, segment.upperRight, segment.lowerRight, segment.bottom],
	"^": [stroke(160, 400, 350, CAP_HEIGHT), stroke(350, CAP_HEIGHT, 540, 400)],
	_: [stroke(80, -100, 620, -100)],
	"`": [stroke(280, CAP_HEIGHT, 390, 560)],
	"{": [
		stroke(430, CAP_HEIGHT, 300, 560),
		stroke(300, 560, 350, 350),
		stroke(350, 350, 300, 140),
		stroke(300, 140, 430, 0),
	],
	"|": [segment.center],
	"}": [
		stroke(270, CAP_HEIGHT, 400, 560),
		stroke(400, 560, 350, 350),
		stroke(350, 350, 400, 140),
		stroke(400, 140, 270, 0),
	],
	"~": [
		stroke(120, 300, 260, 420),
		stroke(260, 420, 440, 280),
		stroke(440, 280, 580, 400),
	],
}

function transformStrokes(
	strokes: readonly Stroke[],
	scaleX: number,
	scaleY: number,
	offsetX: number,
	offsetY: number,
): readonly Stroke[] {
	return strokes.map(([from, to]) => [
		{
			x: Math.round(from.x * scaleX + offsetX),
			y: Math.round(from.y * scaleY + offsetY),
		},
		{
			x: Math.round(to.x * scaleX + offsetX),
			y: Math.round(to.y * scaleY + offsetY),
		},
	])
}

function strokesForCharacter(character: string): readonly Stroke[] {
	const upper = uppercase[character]
	if (upper !== undefined) return upper
	const digit = digitSegments[character]
	if (digit !== undefined) return digit.map((name) => segment[name])
	if (character >= "a" && character <= "z") {
		const source = uppercase[character.toUpperCase()] ?? []
		const descends = "gjpqy".includes(character)
		const ascends = "bdfhklt".includes(character)
		return transformStrokes(
			source,
			0.82,
			ascends ? 1 : X_HEIGHT / CAP_HEIGHT,
			62,
			descends ? DESCENDER : 0,
		)
	}
	return punctuation[character] ?? []
}

function rectangleForStroke(
	[from, to]: Stroke,
	thickness: number,
): readonly Coordinate[] {
	const dx = to.x - from.x
	const dy = to.y - from.y
	const length = Math.hypot(dx, dy)
	if (length === 0) throw new Error("A font stroke cannot have zero length.")
	const normalX = (-dy / length) * (thickness / 2)
	const normalY = (dx / length) * (thickness / 2)
	return [
		{ x: Math.round(from.x + normalX), y: Math.round(from.y + normalY) },
		{ x: Math.round(to.x + normalX), y: Math.round(to.y + normalY) },
		{ x: Math.round(to.x - normalX), y: Math.round(to.y - normalY) },
		{ x: Math.round(from.x - normalX), y: Math.round(from.y - normalY) },
	]
}

function glyphName(character: string): string {
	if (/^[A-Za-z]$/.test(character)) return character
	const names: Readonly<Record<string, string>> = {
		" ": "space",
		"!": "exclam",
		'"': "quotedbl",
		"#": "numbersign",
		$: "dollar",
		"%": "percent",
		"&": "ampersand",
		"'": "quotesingle",
		"(": "parenleft",
		")": "parenright",
		"*": "asterisk",
		"+": "plus",
		",": "comma",
		"-": "hyphen",
		".": "period",
		"/": "slash",
		"0": "zero",
		"1": "one",
		"2": "two",
		"3": "three",
		"4": "four",
		"5": "five",
		"6": "six",
		"7": "seven",
		"8": "eight",
		"9": "nine",
		":": "colon",
		";": "semicolon",
		"<": "less",
		"=": "equal",
		">": "greater",
		"?": "question",
		"@": "at",
		"[": "bracketleft",
		"\\": "backslash",
		"]": "bracketright",
		"^": "asciicircum",
		_: "underscore",
		"`": "grave",
		"{": "braceleft",
		"|": "bar",
		"}": "braceright",
		"~": "asciitilde",
	}
	const name = names[character]
	if (name === undefined)
		throw new Error(`No glyph name for ${JSON.stringify(character)}.`)
	return name
}

function advanceForCharacter(character: string): number {
	if (character === " ") return 360
	if ("!\"'(),.:;|`".includes(character)) return 460
	return 700
}

function glyphFromStrokes(
	name: string,
	strokes: readonly Stroke[],
	advanceWidth: number,
): EditorGlyphSource {
	const id = `glyph:${name}` as GlyphId
	const textContours = strokes.map((item) =>
		rectangleForStroke(item, TEXT_STROKE),
	)
	const heavyContours = strokes.map((item) =>
		rectangleForStroke(item, HEAVY_STROKE),
	)
	const layer = (
		masterId: MasterId,
		coordinates: readonly (readonly Coordinate[])[],
	) => {
		const masterPrefix = masterId === textMasterId ? "" : `${masterId}:`
		const points = coordinates.flat()
		return {
			masterId,
			advanceWidth,
			leftSideBearing:
				points.length === 0 ? 0 : Math.min(...points.map((point) => point.x)),
			contours: coordinates.map((contour, contourIndex) => {
				const preservePastedHIds =
					masterId === textMasterId && id === "glyph:H" && contourIndex === 4
				return {
					id: preservePastedHIds
						? "contour:glyph:H:paste:0"
						: `contour:${masterPrefix}${id}:${contourIndex}`,
					closed: true,
					points: contour.map((coordinate, pointIndex) => ({
						id: preservePastedHIds
							? `point:glyph:H:paste:${pointIndex + 1}`
							: `point:${masterPrefix}${id}:${contourIndex}:${pointIndex}`,
						mode: "hard" as const,
						...coordinate,
					})),
				}
			}),
		}
	}
	return {
		id,
		name,
		export: true,
		...(strokes.length > 1 ? { overlap: true } : {}),
		layers: [
			layer(textMasterId, textContours),
			layer(heavyMasterId, heavyContours),
		],
	}
}

function strokeGlyph(character: string): EditorGlyphSource {
	return glyphFromStrokes(
		glyphName(character),
		strokesForCharacter(character),
		advanceForCharacter(character),
	)
}

function fiLigatureGlyph(): EditorGlyphSource {
	return glyphFromStrokes(
		"f_i",
		[
			...strokesForCharacter("f"),
			...transformStrokes(strokesForCharacter("i"), 1, 1, 500, 0),
		],
		1_200,
	)
}

function notdefGlyph(): EditorGlyphSource {
	const strokes = [
		stroke(80, -100, 620, -100),
		stroke(620, -100, 620, 760),
		stroke(620, 760, 80, 760),
		stroke(80, 760, 80, -100),
		stroke(80, -100, 620, 760),
		stroke(80, 760, 620, -100),
	]
	return glyphFromStrokes(".notdef", strokes, 700)
}

export function makeWorkbenchSans(): EditorFontSource {
	const printableAscii = Array.from({ length: 0x7f - 0x20 }, (_, index) =>
		String.fromCodePoint(0x20 + index),
	)
	const glyphs = [
		notdefGlyph(),
		...printableAscii.map(strokeGlyph),
		fiLigatureGlyph(),
	]
	return {
		format: "create-font.editor",
		editorVersion: 5,
		metadata: {
			unitsPerEm: 1_000,
			fontRevision: 1.1,
			vendorId: "CRFT",
			lowestPpem: 8,
		},
		names: {
			family: "Workbench Sans",
			subfamily: "Text",
			uniqueId: "CRFT:Workbench Sans:1.100",
			fullName: "Workbench Sans Text",
			version: "Version 1.100",
			postScriptName: "WorkbenchSans-Text",
			typographicFamily: "Workbench Sans",
			typographicSubfamily: "Text",
		},
		metrics: {
			ascender: 780,
			descender: -220,
			lineGap: 80,
			winAscent: 850,
			winDescent: 300,
			xHeight: X_HEIGHT,
			capHeight: CAP_HEIGHT,
			underlinePosition: -120,
			underlineThickness: 60,
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
			weightClass: 350,
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
				min: 350,
				default: 350,
				max: 800,
			},
		],
		masters: [
			{ id: textMasterId, kind: "default", name: "Text" },
			{
				id: heavyMasterId,
				kind: "source",
				name: "Heavy",
				location: { [weightAxisId]: 800 },
				support: { kind: "non-intermediate" },
			},
		],
		defaultMasterId: textMasterId,
		instances: [
			{
				id: "instance:text",
				name: "Text",
				coordinates: { [weightAxisId]: 350 },
				postScriptName: "WorkbenchSans-Text",
				elidable: true,
			},
			{
				id: "instance:heavy",
				name: "Heavy",
				coordinates: { [weightAxisId]: 800 },
				postScriptName: "WorkbenchSans-Heavy",
			},
		],
		glyphs,
		cmap: printableAscii.map((character, index) => ({
			codePoint: 0x20 + index,
			glyphId: `glyph:${glyphName(character)}` as GlyphId,
		})),
	}
}

const projectRoot = resolve(import.meta.dir, "..", "fonts", "workbench-sans")
const split = splitEditorFontSource(makeWorkbenchSans())
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
await mkdir(resolve(projectRoot, "features"), { recursive: true })
const featureIndexPath = "features/index.json"
const featureIndex = formatSourceUnit(
	"feature-index",
	[{ path: "features/layout.fea" }],
	featureIndexPath,
)
if (!featureIndex.ok) throw new Error(featureIndex.errors[0].message)
await writeFile(resolve(projectRoot, featureIndexPath), featureIndex.value)
await writeFile(
	resolve(projectRoot, "features", "layout.fea"),
	"feature liga { sub f i by f_i; } liga;\n",
)
await writeFile(
	resolve(projectRoot, "README.md"),
	`# Workbench Sans\n\nWorkbench Sans is create-font's live development family: a geometric, monoline\ndisplay sans with Text and Heavy masters. It includes .notdef, every printable\nASCII character from U+0020 through U+007E, and an unencoded f_i ligature, with\ncompatible topology across weights and reviewable per-entity JSON source units.\nThe Adobe feature source enables the f_i glyph through the standard liga feature.\n\nRegenerate the checked-in source with \`bun scripts/workbench-sans.ts\`.\n\nFrom the repository root, build the installable variable TrueType artifact with\n\`bun font build workbench-sans\`. The deterministic output is written to\n\`artifacts/workbench-sans/WorkbenchSans-Text.ttf\`.\n`,
)
