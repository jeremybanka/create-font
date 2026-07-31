import { describe, expect, it } from "vitest"

import {
	DESIGN_VECTOR_MIME,
	designObjectsToFontOutline,
	FONT_OUTLINE_MIME,
	readDesignClipboard,
	writeDesignClipboard,
} from "../src/clipboard.ts"
import { importDesignObjects } from "../src/design-vector-adapter.ts"
import { createInitialDocument } from "../src/document.ts"
import { expandDesignShape } from "../src/shape-expansion.ts"

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
		expect(
			readDesignClipboard(
				{
					getData: (format) =>
						format === FONT_OUTLINE_MIME ? JSON.stringify(font) : "",
				},
				document,
				() => "test",
				{ nativeOnly: true },
			),
		).toBeNull()
	})

	it("preserves native live geometry and refreshes expanded control identities", () => {
		const document = createInitialDocument()
		const entries = new Map<string, string>()
		const rectangle = document.objects[0]
		const ellipse = document.objects[1]
		if (rectangle === undefined || ellipse === undefined)
			throw new Error("Missing live shape fixtures.")
		let expansionSequence = 0
		const expanded = expandDesignShape(
			ellipse,
			() => `source:${expansionSequence++}`,
		)
		const source = {
			...document,
			objects: [rectangle, expanded],
		}
		writeDesignClipboard(
			{ setData: (format, value) => entries.set(format, value) },
			source,
			source.objects.map((object) => object.id),
		)
		let pasteSequence = 0
		const addition = readDesignClipboard(
			{ getData: (format) => entries.get(format) ?? "" },
			document,
			() => `paste:${pasteSequence++}`,
		)
		if (addition === null) throw new Error("Missing native design payload.")
		expect(addition.objects[0]?.geometry.kind).toBe("rectangle")
		expect(addition.objects[0]?.transform).toEqual({
			...rectangle.transform,
			e: rectangle.transform.e + 12,
			f: rectangle.transform.f + 12,
		})
		const pastedPath = addition.objects[1]
		expect(pastedPath?.geometry.kind).toBe("path")
		if (pastedPath?.geometry.kind !== "path") return
		expect(pastedPath.geometry.contours[0]?.id).toMatch(/^contour:paste:/u)
		expect(pastedPath.geometry.contours[0]?.id).not.toBe(
			expanded.geometry.kind === "path"
				? expanded.geometry.contours[0]?.id
				: undefined,
		)

		const imported = importDesignObjects(document, [], addition)
		expect(imported.ok).toBe(true)
		if (!imported.ok) return
		expect(imported.document.objects.at(-2)?.geometry.kind).toBe("rectangle")
		expect(imported.selection).toEqual(
			addition.objects.map((object) => object.id),
		)
	})
})
