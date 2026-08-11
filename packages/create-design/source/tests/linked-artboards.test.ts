import { describe, expect, test } from "vitest"

import { createInitialDocument } from "../src/initial-document.ts"
import { validateDesignDocument } from "../src/document.ts"
import {
	CREATE_DESIGN_SOURCE_VERSION,
	VERSION_FOUR_CREATE_DESIGN_SOURCE_VERSION,
	assembleDesignDocument,
	defaultObjectUnitPath,
	designSourcePaths,
	splitDesignDocument,
} from "../src/directory.ts"

describe("linked artboard source", () => {
	test("round-trips a stable workspace project and artboard identity", () => {
		const document = createInitialDocument()
		const linked = {
			...document,
			objects: [
				{
					...document.objects[0]!,
					geometry: {
						kind: "artboard-link" as const,
						projectId: "brand-system",
						artboardId: "artboard:logo",
						width: 320,
						height: 180,
					},
				},
			],
			layers: [
				{
					...document.layers[0]!,
					children: [{ kind: "object" as const, id: document.objects[0]!.id }],
				},
			],
		}
		const result = validateDesignDocument(linked)
		expect(result.ok).toBe(true)
		const split = splitDesignDocument(linked)
		if (!split.ok) throw new Error("Expected linked source to split.")
		expect(split.value[designSourcePaths.project]).toMatchObject({
			sourceVersion: CREATE_DESIGN_SOURCE_VERSION,
			documentVersion: 8,
		})
		expect(
			split.value[defaultObjectUnitPath(linked.objects[0]!.id)],
		).toMatchObject({ version: 3, geometry: { kind: "artboard-link" } })
		const previousSource = {
			...split.value,
			[designSourcePaths.project]: {
				...(split.value[designSourcePaths.project] as Record<string, unknown>),
				sourceVersion: VERSION_FOUR_CREATE_DESIGN_SOURCE_VERSION,
			},
		}
		expect(assembleDesignDocument(previousSource)).toMatchObject({
			ok: false,
			errors: [
				expect.objectContaining({
					code: "directory.unsupported",
					message: expect.stringContaining("does not support linked artboards"),
				}),
			],
		})
	})

	test("rejects traversal in a portable project identity", () => {
		const document = createInitialDocument()
		const result = validateDesignDocument({
			...document,
			objects: [
				{
					...document.objects[0]!,
					geometry: {
						kind: "artboard-link",
						projectId: "../outside",
						artboardId: "artboard:page",
						width: 100,
						height: 100,
					},
				},
			],
		})
		expect(result.ok).toBe(false)
	})
})
