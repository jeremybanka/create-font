import {
	createInitialDocument,
	DEFAULT_DESIGN_STROKE_STYLE,
} from "@create-design/source"
import { describe, expect, test } from "vitest"

import { resolveDesignArtboardLinks } from "../src/linked-artboards.ts"
import { projectDesignOutput } from "../src/output.ts"

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

	test("projects an authored artboard background behind clipped children", () => {
		const initial = createInitialDocument()
		const artboard = {
			...initial.artboards[0]!,
			x: 50,
			y: 75,
			width: 20,
			height: 10,
			backgroundColor: "#123456",
		}
		const foreground = {
			...initial.objects[0]!,
			geometry: {
				kind: "rectangle" as const,
				x: 55,
				y: 77,
				width: 5,
				height: 4,
			},
			transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
		}
		const source = {
			...initial,
			artboards: [artboard],
			objects: [foreground],
			layers: [
				{
					...initial.layers[0]!,
					children: [{ kind: "object" as const, id: foreground.id }],
				},
			],
		}
		const target = createInitialDocument()
		const transform = { a: 2, b: 0.25, c: -0.5, d: 3, e: 11, f: 13 }
		const link = {
			...target.objects[0]!,
			id: "object:background-link",
			transform,
			geometry: {
				kind: "artboard-link" as const,
				projectId: "source-design",
				artboardId: artboard.id,
				width: artboard.width,
				height: artboard.height,
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
			[{ projectId: "source-design", revision: "r1", document: source }],
		)
		const root = resolution.document.groups.find(
			({ name }) => name === link.name,
		)!
		const backgroundId = root.children[1]?.id
		const background = resolution.document.objects.find(
			({ id }) => id === backgroundId,
		)!
		expect(root.children.map(({ id }) => id)).toEqual([
			root.clippingPathId,
			background.id,
			expect.stringContaining(encodeURIComponent(foreground.id)),
		])
		expect(background).toMatchObject({
			geometry: { kind: "rectangle", x: 0, y: 0, width: 20, height: 10 },
			transform,
		})
		expect(
			resolution.document.swatches.find(
				({ id }) => id === background.appearance.fill?.swatchId,
			),
		).toMatchObject({ source: { space: "rgb", r: 0x12, g: 0x34, b: 0x56 } })
		expect(resolution.linkObjectIdByProjectedId.get(background.id)).toBe(
			link.id,
		)

		const transparent = resolveDesignArtboardLinks(
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
					revision: "r2",
					document: {
						...source,
						artboards: [{ ...artboard, backgroundColor: undefined }],
					},
				},
			],
		)
		expect(
			transparent.document.objects.some(({ name }) =>
				name.endsWith(" background"),
			),
		).toBe(false)
	})

	test("preserves link-level hidden and locked state in the runtime projection", () => {
		const source = createInitialDocument()
		const target = createInitialDocument()
		const linkedDocument = (hidden: boolean, locked: boolean) => {
			const link = {
				...target.objects[0]!,
				id: "object:stateful-link",
				hidden,
				locked,
				geometry: {
					kind: "artboard-link" as const,
					projectId: "source-design",
					artboardId: source.artboards[0]!.id,
					width: source.artboards[0]!.width,
					height: source.artboards[0]!.height,
				},
			}
			return resolveDesignArtboardLinks(
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
				[{ projectId: "source-design", revision: "r1", document: source }],
			).document
		}
		const hidden = linkedDocument(true, false)
		expect(hidden.objects.every((object) => object.hidden === true)).toBe(true)
		expect(projectDesignOutput(hidden).objects).toEqual([])

		const locked = linkedDocument(false, true)
		expect(projectDesignOutput(locked).objects.length).toBeGreaterThan(0)
		expect(
			projectDesignOutput(locked).objects.every(
				(object) => object.locked === true,
			),
		).toBe(true)
		expect(source.objects.every((object) => object.locked !== true)).toBe(true)
	})

	test("retains stroke paint that crosses the source artboard edge", () => {
		const initial = createInitialDocument()
		const artboard = { ...initial.artboards[0]!, width: 10, height: 10 }
		const stroke = {
			...initial.objects[0]!,
			id: "object:outside-centerline",
			geometry: {
				kind: "path" as const,
				contours: [
					{
						id: "contour:outside-centerline",
						closed: false,
						points: [
							{ id: "point:outside:0", x: -1, y: 0 },
							{ id: "point:outside:1", x: -1, y: 10 },
						],
					},
				],
			},
			transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
			appearance: {
				stroke: {
					...DEFAULT_DESIGN_STROKE_STYLE,
					swatchId: "swatch:ink",
					width: 4,
				},
			},
		}
		const source = {
			...initial,
			artboards: [artboard],
			objects: [stroke],
			layers: [
				{
					...initial.layers[0]!,
					children: [{ kind: "object" as const, id: stroke.id }],
				},
			],
		}
		const target = createInitialDocument()
		const link = {
			...target.objects[0]!,
			id: "object:edge-link",
			geometry: {
				kind: "artboard-link" as const,
				projectId: "source-design",
				artboardId: artboard.id,
				width: artboard.width,
				height: artboard.height,
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
			[{ projectId: "source-design", revision: "r1", document: source }],
		)
		expect(
			projectDesignOutput(resolution.document).objects.some(
				({ name }) => name === stroke.name,
			),
		).toBe(true)
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
