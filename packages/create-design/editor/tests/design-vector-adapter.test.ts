import { describe, expect, it } from "vitest"

import { vectorDocumentAdapterContract } from "../../../create-art/editor/tests/vector-document-adapter.contract.ts"
import {
	createDesignVectorAdapter,
	importDesignVectorClipboard,
	projectDesignVectorRenderObject,
	projectDesignVectorObject,
} from "../src/design-vector-adapter.ts"
import { createInitialDocument } from "../src/document.ts"
import { projectDesignObjectContours } from "@create-design/model"

const defaultScope = {
	layerId: createInitialDocument().layers[0]!.id,
	groupId: null,
} as const
const designVectorAdapter = createDesignVectorAdapter(defaultScope)

describe("design object vector adapter", () => {
	it("rejects a collinear live corner without partially changing the document", () => {
		const initial = createInitialDocument()
		const source = initial.objects[0]!
		const object = {
			...source,
			geometry: {
				kind: "path" as const,
				fillRule: "nonzero" as const,
				contours: [
					{
						id: "contour:collinear",
						closed: true,
						points: [
							{ id: "point:a", x: 0, y: 0 },
							{ id: "point:b", x: 100, y: 0 },
							{ id: "point:c", x: 200, y: 0 },
						],
					},
				],
			},
		}
		const document = {
			...initial,
			objects: initial.objects.map((candidate) =>
				candidate.id === object.id ? object : candidate,
			),
		}
		const result = designVectorAdapter.apply(document, [object.id], {
			kind: "set-corner-profile",
			objectId: object.id,
			corners: [
				{
					contourId: "contour:collinear",
					pointId: "point:b",
					profile: "circular",
					amount: 12,
				},
			],
		})
		expect(result).toEqual({
			ok: false,
			error: expect.stringContaining("collinear-incidents"),
		})
		expect(document.objects[0]).toBe(object)
	})

	it("rejects an eligible corner whose incident spans clamp below tolerance", () => {
		const initial = createInitialDocument()
		const source = initial.objects[0]!
		const object = {
			...source,
			geometry: {
				kind: "path" as const,
				fillRule: "nonzero" as const,
				contours: [
					{
						id: "contour:tiny",
						closed: true,
						points: [
							{ id: "point:a", x: -2.1e-8, y: 0 },
							{ id: "point:b", x: 0, y: 0 },
							{ id: "point:c", x: 0, y: 2.1e-8 },
						],
					},
				],
			},
		}
		const document = {
			...initial,
			objects: initial.objects.map((candidate) =>
				candidate.id === object.id ? object : candidate,
			),
		}
		const result = designVectorAdapter.apply(document, [object.id], {
			kind: "set-corner-profile",
			objectId: object.id,
			corners: [
				{
					contourId: "contour:tiny",
					pointId: "point:b",
					profile: "circular",
					amount: 12,
				},
			],
		})
		expect(result).toEqual({
			ok: false,
			error: expect.stringContaining("no usable incident span"),
		})
		expect(document.objects[0]).toBe(object)
	})

	it("validates adjacent corner requests as one clamped batch", () => {
		const initial = createInitialDocument()
		const source = initial.objects[0]!
		const object = {
			...source,
			geometry: {
				kind: "path" as const,
				contours: [
					{
						id: "contour:batch",
						closed: true,
						points: [
							{ id: "point:a", x: 0, y: 0 },
							{ id: "point:b", x: 100, y: 0 },
							{ id: "point:c", x: 100, y: 100 },
							{ id: "point:d", x: 0, y: 100 },
						],
					},
				],
			},
		}
		const document = {
			...initial,
			objects: initial.objects.map((candidate) =>
				candidate.id === object.id ? object : candidate,
			),
		}
		const result = designVectorAdapter.apply(document, [object.id], {
			kind: "set-corner-profile",
			objectId: object.id,
			corners: [
				{
					contourId: "contour:batch",
					pointId: "point:b",
					profile: "circular",
					amount: 1e-7,
				},
				{
					contourId: "contour:batch",
					pointId: "point:c",
					profile: "circular",
					amount: 1e12,
				},
			],
		})
		expect(result).toEqual({
			ok: false,
			error: expect.stringContaining("no usable incident span"),
		})
		expect(document.objects[0]).toBe(object)
	})

	it("persists and sharply restores live-corner metadata without replacing authored IDs", () => {
		const initial = createInitialDocument()
		const source = initial.objects[0]!
		const object = {
			...source,
			geometry: {
				kind: "path" as const,
				fillRule: "nonzero" as const,
				contours: [
					{
						id: "contour:corner",
						closed: true,
						points: [
							{ id: "point:a", x: 0, y: 0 },
							{ id: "point:b", x: 100, y: 0 },
							{ id: "point:c", x: 100, y: 100 },
						],
					},
				],
			},
		}
		const document = {
			...initial,
			objects: initial.objects.map((candidate) =>
				candidate.id === object.id ? object : candidate,
			),
		}
		const rounded = designVectorAdapter.apply(document, [object.id], {
			kind: "set-corner-profile",
			objectId: object.id,
			corners: [
				{
					contourId: "contour:corner",
					pointId: "point:b",
					profile: "squircle",
					amount: 18,
				},
			],
		})
		expect(rounded.ok).toBe(true)
		if (!rounded.ok) return
		const roundedObject = rounded.document.objects[0]!
		expect(
			roundedObject.geometry.kind === "path"
				? roundedObject.geometry.contours[0]?.points[1]
				: null,
		).toMatchObject({
			id: "point:b",
			corner: { profile: "squircle", amount: 18 },
		})
		expect(projectDesignObjectContours(roundedObject)[0]!.points.length).toBe(7)

		const sharp = designVectorAdapter.apply(
			rounded.document,
			rounded.selection,
			{
				kind: "set-corner-profile",
				objectId: object.id,
				corners: [
					{
						contourId: "contour:corner",
						pointId: "point:b",
						profile: "sharp",
						amount: 0,
					},
				],
			},
		)
		expect(sharp.ok).toBe(true)
		if (!sharp.ok) return
		const sharpObject = sharp.document.objects[0]!
		expect(
			sharpObject.geometry.kind === "path"
				? sharpObject.geometry.contours[0]?.points[1]?.corner
				: null,
		).toBeUndefined()
	})

	it("flattens vector clipboard payloads in effective hierarchy order", () => {
		const initial = createInitialDocument()
		const back = initial.objects[0]!
		const front = initial.objects[1]!
		const hidden = { ...back, id: "object:hidden", name: "Hidden" }
		const document = {
			...initial,
			objects: [front, hidden, back],
			layers: [
				{
					id: "layer:back",
					name: "Back",
					children: [{ kind: "object" as const, id: back.id }],
				},
				{
					id: "layer:hidden",
					name: "Hidden",
					hidden: true,
					children: [{ kind: "object" as const, id: hidden.id }],
				},
				{
					id: "layer:front",
					name: "Front",
					locked: true,
					children: [{ kind: "object" as const, id: front.id }],
				},
			],
			groups: [],
		}
		const payload = createDesignVectorAdapter({
			layerId: "layer:back",
			groupId: null,
		}).clipboard(document, [front.id, hidden.id, back.id])

		expect(payload.objects.map(({ id }) => id)).toEqual([back.id, front.id])
		expect(payload.objects[1]).toMatchObject({ locked: true })
	})

	it("creates through an explicit layer scope without crossing paint boundaries", () => {
		const document = createInitialDocument()
		const source = document.objects[0]!
		const layered = {
			...document,
			layers: [
				{
					id: "layer:back",
					name: "Back",
					children: [{ kind: "object" as const, id: source.id }],
				},
				{
					id: "layer:front",
					name: "Front",
					children: document.objects.slice(1).map((object) => ({
						kind: "object" as const,
						id: object.id,
					})),
				},
			],
		}
		const vector = {
			...projectDesignVectorObject(document, source),
			id: "object:scoped",
			name: "Scoped object",
		}
		const result = createDesignVectorAdapter({
			layerId: "layer:back",
			groupId: null,
		}).apply(layered, [], { kind: "create-object", object: vector })
		expect(result.ok).toBe(true)
		if (!result.ok) return
		expect(result.document.layers[0]?.children.at(-1)).toEqual({
			kind: "object",
			id: vector.id,
		})
		expect(result.document.layers[1]).toEqual(layered.layers[1])
		expect(result.document.objects[1]?.id).toBe(vector.id)
	})

	it("projects authored RGB/CMYK swatches without lossy neutral sentinels", () => {
		const document = createInitialDocument()
		const coral = document.objects[0]
		const cyan = document.objects[1]
		if (coral === undefined || cyan === undefined)
			throw new Error("Design fixture objects are missing.")
		expect(projectDesignVectorObject(document, coral).style).toMatchObject({
			kind: "fill",
			swatchId: "swatch:coral",
			source: { space: "rgb" },
			alternate: { space: "cmyk" },
		})
		expect(projectDesignVectorObject(document, cyan).style).toMatchObject({
			kind: "fill",
			source: { space: "cmyk" },
		})
	})

	it("applies create, update, reorder, style, and delete intents atomically", () => {
		const document = createInitialDocument()
		const source = document.objects[0]
		if (source === undefined)
			throw new Error("Design fixture object is missing.")
		const vector = {
			...projectDesignVectorObject(document, source),
			id: "object:adapter",
			name: "Adapter object",
		}
		const created = designVectorAdapter.apply(document, [], {
			kind: "create-object",
			object: vector,
		})
		expect(created.ok).toBe(true)
		if (!created.ok) return
		expect(created.selection).toEqual(["object:adapter"])
		const moved = {
			...vector,
			contours: vector.contours.map((contour) => ({
				...contour,
				nodes: contour.nodes.map((node) => ({ ...node, x: node.x + 25 })),
			})),
		}
		const updated = designVectorAdapter.apply(
			created.document,
			created.selection,
			{ kind: "replace-object", object: moved },
		)
		expect(updated.ok).toBe(true)
		if (!updated.ok) return
		const styled = designVectorAdapter.apply(
			updated.document,
			updated.selection,
			{
				kind: "set-style",
				objectId: vector.id,
				style: {
					kind: "fill",
					swatchId: "swatch:cyan",
					resolvedCss: "#00a",
					source: { space: "cmyk", c: 100, m: 0, y: 0, k: 0 },
				},
			},
		)
		expect(styled.ok).toBe(true)
		if (!styled.ok) return
		expect(
			styled.document.objects.find((object) => object.id === vector.id)
				?.appearance.fill?.swatchId,
		).toBe("swatch:cyan")
		const reordered = designVectorAdapter.apply(
			styled.document,
			styled.selection,
			{ kind: "reorder", objectId: vector.id, toIndex: 0 },
		)
		expect(reordered.ok).toBe(true)
		if (!reordered.ok) return
		expect(reordered.document.objects[0]?.id).toBe(vector.id)
		const deleted = designVectorAdapter.apply(
			reordered.document,
			reordered.selection,
			{ kind: "delete", objectIds: [vector.id] },
		)
		expect(deleted).toMatchObject({ ok: true, selection: [] })
	})

	it("rejects invalid and locked edits without changing the document", () => {
		const document = createInitialDocument()
		const object = document.objects[0]
		if (object === undefined)
			throw new Error("Design fixture object is missing.")
		const locked = {
			...document,
			objects: document.objects.map((candidate) =>
				candidate.id === object.id ? { ...candidate, locked: true } : candidate,
			),
		}
		const result = designVectorAdapter.apply(locked, [object.id], {
			kind: "delete",
			objectIds: [object.id],
		})
		expect(result).toMatchObject({
			ok: false,
			error: expect.stringContaining("locked"),
		})
		expect(locked.objects).toHaveLength(document.objects.length)
		const malformed = projectDesignVectorObject(document, object)
		const rejected = designVectorAdapter.apply(document, [], {
			kind: "create-object",
			object: { ...malformed, id: "object:new", contours: [] },
		})
		expect(rejected).toMatchObject({ ok: false })
	})

	it("projects only selected objects to the neutral clipboard contract", () => {
		const document = createInitialDocument()
		const payload = designVectorAdapter.clipboard(document, ["object:cyan"])
		expect(payload).toMatchObject({
			format: "create-vector.selection",
			version: 1,
		})
		expect(payload.objects.map((object) => object.id)).toEqual(["object:cyan"])
		expect(payload.objects[0]?.style.kind).toBe("fill")
	})

	it("bakes transformed live corners for render and clipboard parity", () => {
		const initial = createInitialDocument()
		const source = initial.objects[0]!
		const object = {
			...source,
			geometry: {
				kind: "path" as const,
				contours: [
					{
						id: "contour:affine-corner",
						closed: true,
						points: [
							{ id: "point:a", x: 0, y: 0 },
							{
								id: "point:b",
								x: 100,
								y: 0,
								corner: { profile: "circular" as const, amount: 20 },
							},
							{ id: "point:c", x: 100, y: 100 },
						],
					},
				],
			},
			transform: { a: 2, b: 0.25, c: 0.4, d: 1.5, e: 7, f: -4 },
		}
		const document = {
			...initial,
			objects: initial.objects.map((candidate) =>
				candidate.id === object.id ? object : candidate,
			),
		}
		const output = projectDesignObjectContours(object)[0]!
		const rendered = projectDesignVectorRenderObject(document, object)
			.contours[0]!
		expect(rendered.nodes.map(({ x, y }) => ({ x, y }))).toEqual(
			output.points.map(({ x, y }) => ({ x, y })),
		)
		expect(rendered.nodes.every((node) => node.corner === undefined)).toBe(true)
		const clipboard = designVectorAdapter.clipboard(document, [object.id])
		expect(clipboard.objects[0]?.contours[0]?.nodes).toHaveLength(
			output.points.length,
		)
		expect(
			clipboard.objects[0]?.contours[0]?.nodes.every(
				(node) => node.corner === undefined,
			),
		).toBe(true)
	})

	it("keeps clipboard coordinates independent of page placement and height", () => {
		const document = createInitialDocument()
		const original = designVectorAdapter.clipboard(document, ["object:coral"])
		const movedPage = designVectorAdapter.clipboard(
			{
				...document,
				artboards: [
					{
						...document.artboards[0]!,
						x: 900,
						y: -700,
						width: 200,
						height: 3_000,
					},
				],
			},
			["object:coral"],
		)
		expect(movedPage).toEqual(original)
	})

	it("preserves object, contour, and point identities across unrelated edits", () => {
		const document = createInitialDocument()
		const source = document.objects[0]
		const unaffected = document.objects[1]
		if (source === undefined || unaffected === undefined)
			throw new Error("Design fixtures are missing.")
		const vector = projectDesignVectorObject(document, source)
		const replacement = {
			...vector,
			contours: vector.contours.map((contour) => ({
				...contour,
				nodes: contour.nodes.map((node) => ({ ...node, x: node.x + 10 })),
			})),
		}
		const result = designVectorAdapter.apply(document, [source.id], {
			kind: "replace-object",
			object: replacement,
		})
		expect(result.ok).toBe(true)
		if (!result.ok) return
		const updated = result.document.objects[0]
		expect(updated?.id).toBe(source.id)
		expect(result.document.objects[1]).toBe(unaffected)
		if (updated?.geometry.kind !== "path")
			throw new Error("Expected edited path geometry.")
		expect(updated.geometry.contours.map(({ id }) => id)).toEqual(
			vector.contours.map(({ id }) => id),
		)
		expect(
			updated.geometry.contours.flatMap((contour) =>
				contour.points.map(({ id }) => id),
			),
		).toEqual(
			vector.contours.flatMap((contour) => contour.nodes.map(({ id }) => id)),
		)
	})

	it("preserves an authored nonzero rule through direct-selection replacement", () => {
		const document = createInitialDocument()
		const source = document.objects[0]
		if (source === undefined)
			throw new Error("Design fixture object is missing.")
		const authored = {
			...source,
			geometry: {
				kind: "path" as const,
				fillRule: "nonzero" as const,
				contours: projectDesignObjectContours(source),
			},
			transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
		}
		const authoredDocument = {
			...document,
			objects: document.objects.map((object) =>
				object.id === authored.id ? authored : object,
			),
		}
		const vector = projectDesignVectorObject(authoredDocument, authored)
		const replacement = {
			...vector,
			contours: vector.contours.map((contour, contourIndex) => ({
				...contour,
				nodes: contour.nodes.map((node, nodeIndex) =>
					contourIndex === 0 && nodeIndex === 0
						? { ...node, x: node.x + 7 }
						: node,
				),
			})),
		}
		const result = designVectorAdapter.apply(authoredDocument, [authored.id], {
			kind: "replace-object",
			object: replacement,
		})
		expect(result.ok).toBe(true)
		if (!result.ok) return
		const edited = result.document.objects[0]
		expect(
			edited?.geometry.kind === "path" ? edited.geometry.fillRule : undefined,
		).toBe("nonzero")
		expect(
			edited?.geometry.kind === "path"
				? edited.geometry.contours[0]?.points[0]?.x
				: undefined,
		).toBe(projectDesignObjectContours(source)[0]!.points[0]!.x + 7)
	})

	it("round-trips neutral clipboard geometry, IDs, and authored fill atomically", () => {
		const document = createInitialDocument()
		const source = document.objects[0]
		const sourcePoint =
			source === undefined
				? undefined
				: projectDesignObjectContours(source)[0]?.points[0]
		if (source === undefined || sourcePoint === undefined)
			throw new Error("Design fixture object is missing.")
		const payload = designVectorAdapter.clipboard(document, [source.id])
		let sequence = 0
		const imported = importDesignVectorClipboard(
			document,
			[],
			payload,
			() => `contract:${sequence++}`,
			"swatch:ink",
			defaultScope,
		)
		expect(imported.ok).toBe(true)
		if (!imported.ok) return
		const pasted = imported.document.objects.at(-1)
		expect(pasted?.id).not.toBe(source.id)
		expect(pasted?.appearance.fill).toEqual(source.appearance.fill)
		const pastedContour =
			pasted === undefined ? undefined : projectDesignObjectContours(pasted)[0]
		const sourceContour = projectDesignObjectContours(source)[0]
		expect(pastedContour?.closed).toBe(sourceContour?.closed)
		expect(pastedContour?.points[0]).toMatchObject({
			x: sourcePoint.x,
			y: sourcePoint.y,
		})
	})

	it("fills neutral clipboard vectors with the active swatch or ink fallback", () => {
		const document = createInitialDocument()
		const source = document.objects[0]
		if (source === undefined)
			throw new Error("Design fixture object is missing.")
		const payload = designVectorAdapter.clipboard(document, [source.id])
		const neutralPayload = {
			...payload,
			objects: payload.objects.map((object) => ({
				...object,
				style: { kind: "neutral" as const },
			})),
		}
		let sequence = 0
		const withActiveFill = importDesignVectorClipboard(
			document,
			[],
			neutralPayload,
			() => `active:${sequence++}`,
			"swatch:coral",
			defaultScope,
		)
		expect(withActiveFill.ok).toBe(true)
		if (!withActiveFill.ok) return
		expect(
			withActiveFill.document.objects.at(-1)?.appearance.fill?.swatchId,
		).toBe("swatch:coral")

		const withInkFallback = importDesignVectorClipboard(
			document,
			[],
			neutralPayload,
			() => `fallback:${sequence++}`,
			"swatch:missing",
			defaultScope,
		)
		expect(withInkFallback.ok).toBe(true)
		if (!withInkFallback.ok) return
		expect(
			withInkFallback.document.objects.at(-1)?.appearance.fill?.swatchId,
		).toBe("swatch:ink")
	})
})

vectorDocumentAdapterContract("design", () => {
	const document = createInitialDocument()
	const object = document.objects[0]
	if (object === undefined) throw new Error("Design fixture object is missing.")
	return {
		adapter: designVectorAdapter,
		document,
		selection: [object.id],
		selectedObjectId: object.id,
		update: (vector) => ({
			kind: "replace-object" as const,
			object: {
				...vector,
				contours: vector.contours.map((contour) => ({
					...contour,
					nodes: contour.nodes.map((node) => ({ ...node, x: node.x + 13 })),
				})),
			},
		}),
		remove: () => ({
			kind: "delete" as const,
			objectIds: [object.id],
		}),
		invalid: {
			kind: "create-object" as const,
			object: {
				...projectDesignVectorObject(document, object),
				contours: [],
			},
		},
		assertUpdated: (next: typeof document) => {
			expect(
				next.objects[0] === undefined
					? undefined
					: projectDesignObjectContours(next.objects[0])[0]?.points[0]?.x,
			).toBe(projectDesignObjectContours(object)[0]!.points[0]!.x + 13)
		},
		assertDeleted: (next: typeof document) => {
			expect(next.objects.some((candidate) => candidate.id === object.id)).toBe(
				false,
			)
		},
	}
})
