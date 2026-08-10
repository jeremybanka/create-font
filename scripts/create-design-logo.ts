import { mkdir, rm, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"

import {
	formatSourceUnit,
	sourceUnitKindForPath,
	splitDesignDocument,
	type DesignDocument,
	type DesignObject,
} from "../packages/create-design/source/src/index.ts"
import { exportSvg } from "../packages/create-design/svg/src/index.ts"

const identity = Object.freeze({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 })
const stroke = (swatchId: string, width: number) => ({
	swatchId,
	width,
	cap: "round" as const,
	join: "round" as const,
	miterLimit: 4,
	dashArray: [],
	dashOffset: 0,
})

const objects: readonly DesignObject[] = [
	{
		id: "object:artboard-frame",
		name: "Artboard frame",
		geometry: {
			kind: "rectangle",
			x: 22,
			y: 28,
			width: 72,
			height: 76,
		},
		transform: identity,
		appearance: { stroke: stroke("swatch:ink", 12) },
	},
	{
		id: "object:shape-orbit",
		name: "Shape orbit",
		geometry: {
			kind: "ellipse",
			centerX: 88,
			centerY: 40,
			radiusX: 26,
			radiusY: 26,
		},
		transform: identity,
		appearance: { stroke: stroke("swatch:coral", 12) },
	},
	{
		id: "object:anchor-node",
		name: "Anchor node",
		geometry: {
			kind: "ellipse",
			centerX: 88,
			centerY: 40,
			radiusX: 6,
			radiusY: 6,
		},
		transform: identity,
		appearance: { fill: { swatchId: "swatch:ink" } },
	},
]

const document: DesignDocument = {
	format: "create-design.document",
	version: 7,
	title: "create-design logo",
	artboards: [
		{
			id: "artboard:logo",
			name: "Create Design",
			x: 0,
			y: 0,
			width: 128,
			height: 128,
		},
	],
	swatches: [
		{
			id: "swatch:ink",
			name: "Create Design ink",
			source: { space: "rgb", r: 20, g: 24, b: 32 },
			alternate: { space: "cmyk", c: 74, m: 64, y: 52, k: 68 },
		},
		{
			id: "swatch:coral",
			name: "Create Design coral",
			source: { space: "rgb", r: 239, g: 61, b: 35 },
			alternate: { space: "cmyk", c: 0, m: 84, y: 91, k: 0 },
		},
	],
	objects,
	layers: [
		{
			id: "layer:logo",
			name: "Logo",
			children: objects.map(({ id }) => ({ kind: "object", id })),
			uiColor: "orange",
		},
	],
	groups: [],
	guides: [
		{ id: "guide:center-x", axis: "x", value: 64 },
		{ id: "guide:center-y", axis: "y", value: 64 },
	],
}

const split = splitDesignDocument(document, {
	objectPath: ({ id }) =>
		`scene/objects/logo/${id.slice("object:".length)}.json`,
})
if (!split.ok)
	throw new Error(split.errors.map(({ message }) => message).join("\n"))

const root = resolve(import.meta.dirname, "../designs/create-design-logo")
await rm(root, { force: true, recursive: true })
for (const [path, value] of Object.entries(split.value)) {
	const kind = sourceUnitKindForPath(path)
	if (kind === null) throw new Error(`Unsupported design source path: ${path}`)
	const formatted = formatSourceUnit(kind, value)
	if (!formatted.ok)
		throw new Error(formatted.errors.map(({ message }) => message).join("\n"))
	const target = resolve(root, path)
	await mkdir(dirname(target), { recursive: true })
	await writeFile(target, formatted.value)
}

await writeFile(
	resolve(
		import.meta.dirname,
		"../apps/create-design/public/create-design-logo.svg",
	),
	exportSvg(document, { artboardId: "artboard:logo" }),
)
