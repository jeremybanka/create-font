import { describe, expect, test } from "vitest"

import { createInitialDocument } from "../src/initial-document.ts"
import { validateDesignDocument } from "../src/document.ts"

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
