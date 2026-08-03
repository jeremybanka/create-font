import { describe, expect, it } from "vitest"

import { vectorDocumentAdapterContract } from "../../editor/tests/vector-document-adapter.contract.ts"
import {
	designVectorAdapter,
	importDesignVectorClipboard,
	projectDesignVectorObject,
} from "../src/design-vector-adapter.ts"
import { createInitialDocument } from "../src/document.ts"
import { projectDesignObjectContours } from "../src/geometry.ts"

describe("design object vector adapter", () => {
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
