import { describe, expect, it } from "vitest"

import {
	DESIGN_VECTOR_MIME,
	designObjectsToFontOutline,
	FONT_OUTLINE_MIME,
	readDesignClipboard,
	writeDesignClipboard,
} from "../src/clipboard.ts"
import { createInitialDocument } from "../src/document.ts"

describe("vector clipboard interoperability", () => {
	it("writes native design data and create-font outline data together", () => {
		const document = createInitialDocument()
		const entries = new Map<string, string>()
		expect(
			writeDesignClipboard(
				{ setData: (format, value) => entries.set(format, value) },
				document,
				["object:coral"],
			),
		).toBe(1)
		expect(JSON.parse(entries.get(DESIGN_VECTOR_MIME) ?? "{}")).toMatchObject({
			format: "create-design.vector",
			version: 1,
		})
		expect(JSON.parse(entries.get(FONT_OUTLINE_MIME) ?? "{}")).toMatchObject({
			format: "create-font.outline",
			version: 1,
			sourceApplication: "create-design",
			masterIds: ["master:create-design"],
		})
	})

	it("maps the design Y axis into font coordinates", () => {
		const document = createInitialDocument()
		const object = document.objects[0]
		if (object === undefined) throw new Error("Missing fixture object.")
		const payload = designObjectsToFontOutline([object], document.page.height)
		expect(payload.layers[0]?.points[0]).toMatchObject({
			x: 82,
			y: 690,
		})
	})

	it("pastes create-font payloads into the artboard", () => {
		const document = createInitialDocument()
		const font = {
			format: "create-font.outline",
			version: 1,
			masterIds: ["master:regular"],
			contours: [
				{
					closed: true,
					points: [
						{ key: "0/0", mode: "hard" },
						{ key: "0/1", mode: "hard" },
						{ key: "0/2", mode: "hard" },
					],
				},
			],
			layers: [
				{
					masterId: "master:regular",
					points: [
						{ key: "0/0", x: 0, y: 0 },
						{ key: "0/1", x: 100, y: 0 },
						{ key: "0/2", x: 0, y: 100 },
					],
				},
			],
		}
		const addition = readDesignClipboard(
			{
				getData: (format) =>
					format === FONT_OUTLINE_MIME ? JSON.stringify(font) : "",
			},
			document,
			() => "test",
		)
		expect(addition?.objects).toHaveLength(1)
		expect(addition?.objects[0]?.name).toContain("create-font")
	})
})
