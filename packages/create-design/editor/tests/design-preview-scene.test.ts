import { describe, expect, it } from "vitest"

import {
	INACTIVE_DESIGN_PREVIEW_SCENE,
	projectDesignPreviewScene,
	resolveCanvasKitPreviewScene,
} from "../src/design-preview-scene.ts"
import type { DesignDocument } from "../src/types.ts"

function createVectorDocument(): DesignDocument {
	return {
		format: "create-design.document",
		version: 8,
		title: "Preview fixture",
		artboards: [
			{
				id: "artboard:page",
				name: "Page",
				x: 0,
				y: 0,
				width: 612,
				height: 792,
			},
		],
		swatches: [
			{
				id: "swatch:coral",
				name: "Coral",
				source: { space: "rgb", r: 218, g: 94, b: 67 },
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
				transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
				appearance: { fill: { swatchId: "swatch:coral" } },
			},
		],
		layers: [
			{
				id: "layer:artwork",
				name: "Artwork",
				children: [{ kind: "object", id: "object:coral" }],
			},
		],
		groups: [],
		guides: [],
	}
}

describe("design preview scene projection", () => {
	it("does no CanvasKit projection work in any other renderer mode", () => {
		for (const renderer of ["konva", "konva-preserved", "vello-hybrid"] as const) {
			let projections = 0
			const scene = resolveCanvasKitPreviewScene(renderer, () => {
				projections += 1
				throw new Error(`${renderer} must not project a CanvasKit scene.`)
			})

			expect(scene).toBe(INACTIVE_DESIGN_PREVIEW_SCENE)
			expect(projections).toBe(0)
		}
	})

	it("projects vector artwork into stable renderer-neutral path commands", () => {
		const document = createVectorDocument()
		const scene = resolveCanvasKitPreviewScene("canvaskit", () =>
			projectDesignPreviewScene({
				document,
				artboards: document.artboards.map((artboard) => ({
					...artboard,
					background: "#fff",
				})),
				objects: document.objects,
			}),
		)

		expect(scene.supported).toBe(true)
		expect(scene.diagnostics).toEqual([])
		expect(scene.paths.map(({ id }) => id)).toEqual(["object:coral"])
		expect(scene.paths[0]).toMatchObject({
			fill: { color: "rgb(218 94 67)" },
			fillRule: "evenodd",
		})
		expect(scene.paths[0]?.pathData).toBe(
			"M 82 102 L 362 102 L 362 342 L 82 342 L 82 102 Z",
		)
		expect(
			projectDesignPreviewScene({
				document,
				artboards: document.artboards.map((artboard) => ({
					...artboard,
					background: "#fff",
				})),
				objects: document.objects,
			}).revision,
		).toBe(scene.revision)
	})

	it("requires an all-supported scene before CanvasKit takes visual ownership", () => {
		const document = createVectorDocument()
		const image = {
			...document.objects[0]!,
			id: "object:image",
			name: "Placed logo",
			geometry: {
				kind: "image" as const,
				source: { kind: "embedded" as const, id: "image:logo" },
				mediaType: "image/png" as const,
				intrinsicWidth: 100,
				intrinsicHeight: 80,
			},
		}
		const scene = projectDesignPreviewScene({
			document,
			artboards: document.artboards,
			objects: [document.objects[0]!, image],
			maskedObjectIds: new Set([document.objects[0]!.id]),
		})

		expect(scene.supported).toBe(false)
		expect(scene.diagnostics.map(({ code }) => code)).toEqual([
			"clipping-mask",
			"image",
		])
		expect(scene.paths).toEqual([])
	})
})
