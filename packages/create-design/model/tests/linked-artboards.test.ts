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
		expect(resolution.document.objects).toHaveLength(1)
		expect(resolution.document.objects[0]).toMatchObject({
			id: "object:linked",
			geometry: { kind: "path" },
		})
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
