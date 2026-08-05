import type { DesignDocument, DesignTransform } from "./types.ts"

export const IDENTITY_DESIGN_TRANSFORM: DesignTransform = Object.freeze({
	a: 1,
	b: 0,
	c: 0,
	d: 1,
	e: 0,
	f: 0,
})

export function createInitialDocument(): DesignDocument {
	return {
		format: "create-design.document",
		version: 6,
		title: "Untitled design",
		artboards: [
			{
				id: "artboard:page",
				name: "Artboard 1",
				x: 0,
				y: 0,
				width: 612,
				height: 792,
			},
		],
		swatches: [
			{
				id: "swatch:paper",
				name: "Paper",
				source: { space: "rgb", r: 246, g: 242, b: 232 },
			},
			{
				id: "swatch:coral",
				name: "Studio coral",
				source: { space: "rgb", r: 218, g: 94, b: 67 },
				alternate: { space: "cmyk", c: 0, m: 72, y: 68, k: 4 },
			},
			{
				id: "swatch:cyan",
				name: "Process cyan",
				source: { space: "cmyk", c: 100, m: 0, y: 0, k: 0 },
			},
			{
				id: "swatch:ink",
				name: "Rich black",
				source: { space: "cmyk", c: 60, m: 40, y: 40, k: 100 },
			},
		],
		objects: [
			{
				id: "object:coral",
				name: "Coral rectangle",
				geometry: {
					kind: "rectangle",
					x: 82,
					y: 102,
					width: 280,
					height: 240,
				},
				transform: IDENTITY_DESIGN_TRANSFORM,
				appearance: { fill: { swatchId: "swatch:coral" } },
			},
			{
				id: "object:cyan",
				name: "Cyan ellipse",
				geometry: {
					kind: "ellipse",
					centerX: 389,
					centerY: 419,
					radiusX: 141,
					radiusY: 141,
				},
				transform: IDENTITY_DESIGN_TRANSFORM,
				appearance: { fill: { swatchId: "swatch:cyan" } },
			},
		],
		layers: [
			{
				id: "layer:artwork",
				name: "Artwork",
				children: [
					{ kind: "object", id: "object:coral" },
					{ kind: "object", id: "object:cyan" },
				],
			},
		],
		groups: [],
		guides: [],
	}
}
