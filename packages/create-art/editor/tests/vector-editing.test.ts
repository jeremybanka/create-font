import { describe, expect, it } from "vitest"

import {
	readVectorClipboard,
	validateVectorObject,
	vectorClipboardPayload,
	writeVectorClipboard,
	VECTOR_CLIPBOARD_MIME,
	type VectorObject,
} from "../src/vector-editing.ts"

const rectangle = (): VectorObject => ({
	id: "object:test",
	name: "Test",
	style: { kind: "neutral" },
	contours: [
		{
			id: "contour:test",
			closed: true,
			nodes: [
				{ id: "point:0", mode: "hard", x: 10, y: 20 },
				{ id: "point:1", mode: "hard", x: 110, y: 20 },
				{ id: "point:2", mode: "hard", x: 110, y: 220 },
				{ id: "point:3", mode: "hard", x: 10, y: 220 },
			],
		},
	],
})

describe("application-neutral vector adapter contract", () => {
	it("validates identity and topology", () => {
		const object = rectangle()
		expect(validateVectorObject(object)).toBeNull()
		expect(
			validateVectorObject({
				...object,
				contours: [{ ...object.contours[0]!, nodes: [] }],
			}),
		).toContain("requires at least three")
	})

	it("projects only object selections and serializes the neutral MIME", () => {
		const object = rectangle()
		const payload = vectorClipboardPayload({
			revision: "1",
			objects: [object, { ...object, id: "object:other" }],
			selection: [{ kind: "object", objectId: object.id }],
		})
		expect(payload.objects.map((item) => item.id)).toEqual(["object:test"])
		const values = new Map<string, string>()
		expect(
			writeVectorClipboard(
				{ setData: (format, value) => values.set(format, value) },
				payload,
			),
		).toBe(true)
		expect(values.has(VECTOR_CLIPBOARD_MIME)).toBe(true)
		expect(
			readVectorClipboard({
				getData: (format) => values.get(format) ?? "",
			}),
		).toEqual(payload)
	})
})
