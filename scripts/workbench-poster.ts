import { mkdir, rm, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"

import {
	formatSourceUnit,
	sourceUnitKindForPath,
	splitDesignDocument,
	type DesignContour,
	type DesignDocument,
	type DesignObject,
} from "../packages/design-source/src/index.ts"

type Bounds = Readonly<{
	minX: number
	minY: number
	maxX: number
	maxY: number
}>

const ELLIPSE_KAPPA = (4 / 3) * Math.tan(Math.PI / 8)

function rectangle(bounds: Bounds): DesignContour {
	return {
		closed: true,
		points: [
			{ x: bounds.minX, y: bounds.minY },
			{ x: bounds.maxX, y: bounds.minY },
			{ x: bounds.maxX, y: bounds.maxY },
			{ x: bounds.minX, y: bounds.maxY },
		],
	}
}

function ellipse(bounds: Bounds): DesignContour {
	const centerX = (bounds.minX + bounds.maxX) / 2
	const centerY = (bounds.minY + bounds.maxY) / 2
	const handleX = ((bounds.maxX - bounds.minX) / 2) * ELLIPSE_KAPPA
	const handleY = ((bounds.maxY - bounds.minY) / 2) * ELLIPSE_KAPPA
	return {
		closed: true,
		points: [
			{
				x: centerX,
				y: bounds.minY,
				incoming: { x: -handleX, y: 0 },
				outgoing: { x: handleX, y: 0 },
			},
			{
				x: bounds.maxX,
				y: centerY,
				incoming: { x: 0, y: -handleY },
				outgoing: { x: 0, y: handleY },
			},
			{
				x: centerX,
				y: bounds.maxY,
				incoming: { x: handleX, y: 0 },
				outgoing: { x: -handleX, y: 0 },
			},
			{
				x: bounds.minX,
				y: centerY,
				incoming: { x: 0, y: handleY },
				outgoing: { x: 0, y: -handleY },
			},
		],
	}
}

function polygon(
	points: readonly (readonly [number, number])[],
): DesignContour {
	return {
		closed: true,
		points: points.map(([x, y]) => ({ x, y })),
	}
}

function object(
	id: string,
	name: string,
	fillId: string,
	contours: readonly DesignContour[],
	options: Readonly<{ locked?: boolean }> = {},
): DesignObject {
	return {
		id,
		name,
		fillId,
		contours,
		...(options.locked === true ? { locked: true } : {}),
	}
}

const document: DesignDocument = {
	format: "create-design.document",
	version: 1,
	title: "Counterform No. 1",
	page: { width: 612, height: 792 },
	swatches: [
		{
			id: "swatch:paper",
			name: "Warm paper",
			source: { space: "rgb", r: 242, g: 237, b: 223 },
			alternate: { space: "cmyk", c: 3, m: 4, y: 11, k: 0 },
		},
		{
			id: "swatch:ink",
			name: "Midnight ink",
			source: { space: "cmyk", c: 74, m: 64, y: 52, k: 68 },
			alternate: { space: "rgb", r: 20, g: 24, b: 32 },
		},
		{
			id: "swatch:cobalt",
			name: "Workbench cobalt",
			source: { space: "rgb", r: 21, g: 85, b: 216 },
			alternate: { space: "cmyk", c: 90, m: 61, y: 0, k: 0 },
		},
		{
			id: "swatch:coral",
			name: "Signal vermilion",
			source: { space: "rgb", r: 239, g: 61, b: 35 },
			alternate: { space: "cmyk", c: 0, m: 84, y: 91, k: 0 },
		},
		{
			id: "swatch:sun",
			name: "Workshop yellow",
			source: { space: "cmyk", c: 2, m: 19, y: 92, k: 0 },
			alternate: { space: "rgb", r: 244, g: 196, b: 48 },
		},
		{
			id: "swatch:aqua",
			name: "Patina aqua",
			source: { space: "rgb", r: 51, g: 195, b: 179 },
			alternate: { space: "cmyk", c: 66, m: 0, y: 36, k: 0 },
		},
	],
	objects: [
		object(
			"object:background-paper",
			"Paper",
			"swatch:paper",
			[rectangle({ minX: 0, minY: 0, maxX: 612, maxY: 792 })],
			{ locked: true },
		),
		object("object:cobalt-column", "Cobalt column", "swatch:cobalt", [
			rectangle({ minX: 48, minY: 52, maxX: 184, maxY: 548 }),
		]),
		object("object:coral-sun", "Coral sun", "swatch:coral", [
			ellipse({ minX: 296, minY: -80, maxX: 628, maxY: 252 }),
		]),
		object("object:yellow-beam", "Yellow beam", "swatch:sun", [
			rectangle({ minX: 144, minY: 206, maxX: 558, maxY: 344 }),
		]),
		object("object:ink-diagonal", "Ink diagonal", "swatch:ink", [
			polygon([
				[92, 552],
				[390, 52],
				[438, 82],
				[140, 582],
			]),
		]),
		object("object:paper-counter", "Paper counter", "swatch:paper", [
			ellipse({ minX: 128, minY: 132, maxX: 444, maxY: 448 }),
		]),
		object("object:aqua-counter", "Aqua counter", "swatch:aqua", [
			ellipse({ minX: 181, minY: 185, maxX: 391, maxY: 395 }),
		]),
		object("object:ink-pivot", "Ink pivot", "swatch:ink", [
			ellipse({ minX: 248, minY: 252, maxX: 324, maxY: 328 }),
		]),
		object("object:coral-block", "Coral block", "swatch:coral", [
			rectangle({ minX: 432, minY: 388, maxX: 558, maxY: 514 }),
		]),
		object("object:sun-dot", "Sun dot", "swatch:sun", [
			ellipse({ minX: 72, minY: 434, maxX: 164, maxY: 526 }),
		]),
		object("object:letter-f", "F", "swatch:ink", [
			polygon([
				[48, 744],
				[48, 632],
				[148, 632],
				[148, 652],
				[72, 652],
				[72, 676],
				[136, 676],
				[136, 696],
				[72, 696],
				[72, 744],
			]),
		]),
		object("object:letter-o", "O", "swatch:coral", [
			ellipse({ minX: 172, minY: 632, maxX: 274, maxY: 744 }),
			ellipse({ minX: 196, minY: 654, maxX: 250, maxY: 722 }),
		]),
		object("object:letter-r", "R", "swatch:ink", [
			polygon([
				[298, 744],
				[298, 632],
				[358, 632],
				[382, 644],
				[382, 677],
				[368, 688],
				[394, 744],
				[368, 744],
				[344, 692],
				[322, 692],
				[322, 744],
			]),
			polygon([
				[322, 652],
				[354, 652],
				[360, 656],
				[360, 672],
				[354, 676],
				[322, 676],
			]),
		]),
		object("object:letter-m", "M", "swatch:cobalt", [
			polygon([
				[420, 744],
				[420, 632],
				[444, 632],
				[472, 680],
				[500, 632],
				[524, 632],
				[524, 744],
				[500, 744],
				[500, 674],
				[480, 708],
				[464, 708],
				[444, 674],
				[444, 744],
			]),
		]),
	],
	guides: [
		{ id: "guide:left", axis: "x", value: 48 },
		{ id: "guide:center", axis: "x", value: 306 },
		{ id: "guide:right", axis: "x", value: 564 },
		{ id: "guide:top", axis: "y", value: 52 },
		{ id: "guide:composition-bottom", axis: "y", value: 582 },
		{ id: "guide:type-top", axis: "y", value: 632 },
		{ id: "guide:baseline", axis: "y", value: 744 },
	],
}

const objectPaths: Readonly<Record<string, string>> = {
	"object:background-paper": "scene/objects/background/paper.json",
	"object:cobalt-column": "scene/objects/composition/cobalt-column.json",
	"object:coral-sun": "scene/objects/composition/coral-sun.json",
	"object:yellow-beam": "scene/objects/composition/yellow-beam.json",
	"object:ink-diagonal": "scene/objects/composition/ink-diagonal.json",
	"object:paper-counter": "scene/objects/composition/paper-counter.json",
	"object:aqua-counter": "scene/objects/composition/aqua-counter.json",
	"object:ink-pivot": "scene/objects/composition/ink-pivot.json",
	"object:coral-block": "scene/objects/composition/coral-block.json",
	"object:sun-dot": "scene/objects/composition/sun-dot.json",
	"object:letter-f": "scene/objects/lettering/f.json",
	"object:letter-o": "scene/objects/lettering/o.json",
	"object:letter-r": "scene/objects/lettering/r.json",
	"object:letter-m": "scene/objects/lettering/m.json",
}

const split = splitDesignDocument(document, {
	objectPath: ({ id }) => objectPaths[id] ?? `scene/objects/${id}.json`,
})
if (!split.ok) {
	throw new Error(split.errors.map(({ message }) => message).join("\n"))
}

const root = resolve(import.meta.dirname, "../designs/workbench-poster")
await rm(root, { force: true, recursive: true })
for (const [path, value] of Object.entries(split.value)) {
	const kind = sourceUnitKindForPath(path)
	if (kind === null) throw new Error(`Unsupported design source path: ${path}`)
	const formatted = formatSourceUnit(kind, value)
	if (!formatted.ok) {
		throw new Error(formatted.errors.map(({ message }) => message).join("\n"))
	}
	const target = resolve(root, path)
	await mkdir(dirname(target), { recursive: true })
	await writeFile(target, formatted.value)
}
