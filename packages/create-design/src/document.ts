import { ellipseContour, rectangleContour } from "./geometry.ts"
import type { DesignDocument } from "./types.ts"

export const DESIGN_STORAGE_KEY = "create-design:document:v1"

export function createInitialDocument(): DesignDocument {
	return {
		format: "create-design.document",
		version: 1,
		title: "Untitled design",
		page: { width: 612, height: 792 },
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
				contours: [
					rectangleContour({
						minX: 82,
						minY: 102,
						maxX: 362,
						maxY: 342,
					}),
				],
				fillId: "swatch:coral",
			},
			{
				id: "object:cyan",
				name: "Cyan ellipse",
				contours: [
					ellipseContour({
						minX: 248,
						minY: 278,
						maxX: 530,
						maxY: 560,
					}),
				],
				fillId: "swatch:cyan",
			},
		],
		guides: [],
	}
}

export function parseDesignDocument(
	value: string | null,
): DesignDocument | null {
	if (value === null) return null
	try {
		const parsed = JSON.parse(value) as Partial<DesignDocument>
		if (
			parsed.format !== "create-design.document" ||
			parsed.version !== 1 ||
			typeof parsed.title !== "string" ||
			typeof parsed.page?.width !== "number" ||
			typeof parsed.page.height !== "number" ||
			!Array.isArray(parsed.swatches) ||
			!Array.isArray(parsed.objects) ||
			!Array.isArray(parsed.guides)
		) {
			return null
		}
		return parsed as DesignDocument
	} catch {
		return null
	}
}
