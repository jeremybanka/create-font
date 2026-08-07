import { createInitialDocument } from "@create-design/source"
import { describe, expect, test } from "vitest"

import { resolveDesignArtboardLinks } from "../src/linked-artboards.ts"

describe("linked artboards", () => {
	test("resolves workspace-relative artboard references and preserves atomic identity", () => {
		const source = createInitialDocument()
		const sourceObject = source.objects[0]!
		const target = createInitialDocument()
		const linked = {
			...target,
			objects: [
				{
					...sourceObject,
					id: "object:linked",
					geometry: {
						kind: "artboard-link" as const,
						projectId: "source-design",
						artboardId: source.artboards[0]!.id,
						width: source.artboards[0]!.width,
						height: source.artboards[0]!.height,
					},
				},
			],
			layers: [
				{
					...target.layers[0]!,
					children: [{ kind: "object" as const, id: "object:linked" }],
				},
			],
		}
		const resolution = resolveDesignArtboardLinks(linked, [
			{ projectId: "source-design", revision: "r1", document: source },
		])
		expect(resolution.diagnostics).toEqual([])
		expect(resolution.document.objects).toHaveLength(3)
		expect(
			resolution.document.objects.some(({ id }) => id === "object:linked"),
		).toBe(false)
		const outputObjects = resolution.document.objects.filter(
			({ appearance }) => appearance.fill !== undefined,
		)
		expect(outputObjects).toHaveLength(2)
		expect(
			new Set(outputObjects.map(({ appearance }) => appearance.fill?.swatchId))
				.size,
		).toBe(2)
		expect(
			outputObjects.every(
				({ id }) =>
					resolution.linkObjectIdByProjectedId.get(id) === "object:linked",
			),
		).toBe(true)
		const rootGroup = resolution.document.groups.find(
			({ name }) => name === sourceObject.name,
		)
		expect(rootGroup?.clippingPathId).toMatch(/artboard-clip/u)
		expect(
			resolution.document.layers[0]?.children.some(
				(child) => child.kind === "group" && child.id === rootGroup?.id,
			),
		).toBe(true)
	})

	test("preserves live text, images, masks, and collision-proof runtime resources", () => {
		const source = createInitialDocument()
		const fontBytes = new Uint8Array([1, 2, 3])
		const imageBytes = new Uint8Array([4, 5, 6])
		const maskedSource = {
			...source,
			objects: [
				...source.objects,
				{
					id: "object:clip",
					name: "Clip",
					geometry: {
						kind: "rectangle" as const,
						x: 70,
						y: 90,
						width: 180,
						height: 180,
					},
					transform: source.objects[0]!.transform,
					appearance: {},
				},
				{
					id: "object:image",
					name: "Placed image",
					geometry: {
						kind: "image" as const,
						source: { kind: "embedded" as const, id: "asset:shared" },
						mediaType: "image/png" as const,
						intrinsicWidth: 80,
						intrinsicHeight: 60,
					},
					transform: { a: 1, b: 0, c: 0, d: 1, e: 100, f: 120 },
					appearance: {},
				},
				{
					id: "object:text",
					name: "Live label",
					geometry: {
						kind: "text" as const,
						mode: "point" as const,
						text: "Linked live text",
						typography: {
							font: { id: "font:shared", family: "Shared" },
							size: 24,
							leading: 28,
							tracking: 0,
							kerning: "auto" as const,
							alignment: "start" as const,
							direction: "ltr" as const,
						},
						x: 100,
						y: 230,
					},
					transform: source.objects[0]!.transform,
					appearance: { fill: { swatchId: "swatch:ink" } },
				},
			],
			groups: [
				{
					id: "group:masked",
					name: "Masked content",
					clippingPathId: "object:clip",
					children: [
						{ kind: "object" as const, id: "object:clip" },
						{ kind: "object" as const, id: "object:image" },
					],
				},
			],
			layers: [
				{
					...source.layers[0]!,
					children: [
						...source.layers[0]!.children,
						{ kind: "group" as const, id: "group:masked" },
						{ kind: "object" as const, id: "object:text" },
					],
				},
			],
		}
		const target = createInitialDocument()
		const link = {
			...target.objects[0]!,
			id: "object:linked-fidelity",
			geometry: {
				kind: "artboard-link" as const,
				projectId: "source-design",
				artboardId: source.artboards[0]!.id,
				width: source.artboards[0]!.width,
				height: source.artboards[0]!.height,
			},
		}
		const resolution = resolveDesignArtboardLinks(
			{
				...target,
				objects: [link],
				layers: [
					{
						...target.layers[0]!,
						children: [{ kind: "object", id: link.id }],
					},
				],
			},
			[
				{
					projectId: "source-design",
					revision: "r1",
					document: maskedSource,
					images: [
						{
							id: "asset:shared",
							mediaType: "image/png",
							bytes: imageBytes,
						},
					],
					fonts: [
						{
							reference: { id: "font:shared", family: "Shared" },
							bytes: fontBytes,
						},
					],
				},
			],
		)
		const projectedImage = resolution.document.objects.find(
			({ geometry }) => geometry.kind === "image",
		)
		const projectedText = resolution.document.objects.find(
			({ geometry }) => geometry.kind === "text",
		)
		expect(projectedImage?.geometry).toMatchObject({ kind: "image" })
		expect(projectedText?.geometry).toMatchObject({
			kind: "text",
			text: "Linked live text",
		})
		if (projectedImage?.geometry.kind !== "image") throw new Error("image")
		if (projectedText?.geometry.kind !== "text") throw new Error("text")
		expect(projectedImage.geometry.source.id).not.toBe("asset:shared")
		expect(projectedText.geometry.typography.font.id).not.toBe("font:shared")
		expect(resolution.imageResources).toEqual([
			{
				id: projectedImage.geometry.source.id,
				mediaType: "image/png",
				bytes: imageBytes,
			},
		])
		expect(resolution.fontResources).toEqual([
			{
				reference: {
					id: projectedText.geometry.typography.font.id,
					family: "Shared",
				},
				bytes: fontBytes,
			},
		])
		const maskedGroup = resolution.document.groups.find(
			({ name }) => name === "Masked content",
		)
		expect(maskedGroup?.clippingPathId).toBeDefined()
		expect(maskedGroup?.clippingPathId).not.toBe("object:clip")
	})

	test("keeps a selectable fallback and reports a missing source", () => {
		const document = createInitialDocument()
		const object = document.objects[0]!
		const linked = {
			...document,
			objects: [
				{
					...object,
					geometry: {
						kind: "artboard-link" as const,
						projectId: "missing",
						artboardId: "artboard:page",
						width: 100,
						height: 100,
					},
				},
			],
		}
		const resolution = resolveDesignArtboardLinks(linked, [])
		expect(resolution.document.objects[0]!.geometry.kind).toBe("artboard-link")
		expect(resolution.diagnostics[0]?.code).toBe(
			"artboard-link.missing-project",
		)
	})

	test("stops recursive links with a stable cycle diagnostic", () => {
		const document = createInitialDocument()
		const link = {
			...document.objects[0]!,
			id: "object:self-link",
			geometry: {
				kind: "artboard-link" as const,
				projectId: "self",
				artboardId: document.artboards[0]!.id,
				width: document.artboards[0]!.width,
				height: document.artboards[0]!.height,
			},
		}
		const self = {
			...document,
			objects: [link],
			layers: [
				{
					...document.layers[0]!,
					children: [{ kind: "object" as const, id: link.id }],
				},
			],
		}
		const resolution = resolveDesignArtboardLinks(self, [
			{ projectId: "self", revision: "r1", document: self },
		])
		expect(
			resolution.diagnostics.some(({ code }) => code === "artboard-link.cycle"),
		).toBe(true)
	})
})
