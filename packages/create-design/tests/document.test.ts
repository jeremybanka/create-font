import { describe, expect, it } from "vitest"

import {
	createInitialDocument,
	DESIGN_STORAGE_KEY,
	LEGACY_DESIGN_STORAGE_KEY,
	parseDesignDocument,
	PREVIOUS_DESIGN_STORAGE_KEY,
	readStoredDesignDocument,
} from "../src/document.ts"

function legacyDocument() {
	return {
		format: "create-design.document",
		version: 1,
		title: "Stored legacy design",
		page: { width: 120, height: 80 },
		swatches: [
			{
				id: "swatch:black",
				name: "Black",
				source: { space: "rgb", r: 0, g: 0, b: 0 },
			},
		],
		objects: [
			{
				id: "object:legacy",
				name: "Legacy object",
				contours: [{ closed: false, points: [{ x: 1, y: 2 }] }],
				fillId: "swatch:black",
				hidden: true,
			},
		],
		guides: [{ id: "guide:top", axis: "y", value: 8 }],
	}
}

function memoryStorage(entries: Readonly<Record<string, string>>) {
	const values = new Map(Object.entries(entries))
	return {
		getItem: (key: string) => values.get(key) ?? null,
		setItem: (key: string, value: string) => values.set(key, value),
		removeItem: (key: string) => values.delete(key),
		values,
	}
}

describe("design document storage", () => {
	it("round-trips fill-only, stroke-only, combined, and invisible appearances", () => {
		const initial = createInitialDocument()
		const template = initial.objects[0]
		if (template === undefined) throw new Error("Expected a design object.")
		const appearances = [
			{ fill: { swatchId: "swatch:coral" } },
			{ stroke: { swatchId: "swatch:ink", width: 2 } },
			{
				fill: { swatchId: "swatch:cyan" },
				stroke: { swatchId: "swatch:ink", width: 3 },
			},
			{},
		]
		const document = {
			...initial,
			objects: appearances.map((appearance, index) => ({
				...template,
				id: `object:appearance-${index}`,
				appearance,
			})),
		}
		expect(parseDesignDocument(JSON.stringify(document))?.objects).toEqual(
			document.objects,
		)
	})

	it("hydrates a v1 key, migrates once, and saves canonical v3", () => {
		const storage = memoryStorage({
			[LEGACY_DESIGN_STORAGE_KEY]: JSON.stringify(legacyDocument()),
		})
		const loaded = readStoredDesignDocument(storage)
		expect(loaded).toMatchObject({
			status: "loaded",
			migrated: true,
			document: {
				version: 3,
				page: { x: 0, y: 0, width: 120, height: 80 },
				title: "Stored legacy design",
				objects: [
					{
						id: "object:legacy",
						geometry: { kind: "path" },
						appearance: { fill: { swatchId: "swatch:black" } },
						hidden: true,
					},
				],
			},
		})
		expect(storage.values.has(LEGACY_DESIGN_STORAGE_KEY)).toBe(false)
		expect(JSON.parse(storage.values.get(DESIGN_STORAGE_KEY) ?? "")).toEqual(
			loaded.status === "loaded" ? loaded.document : null,
		)
		expect(readStoredDesignDocument(storage)).toMatchObject({
			status: "loaded",
			migrated: false,
		})
	})

	it("migrates the previous v2 key with deterministic path identities", () => {
		const previous = {
			...legacyDocument(),
			version: 2,
			objects: [
				{
					id: "object:legacy",
					name: "Legacy object",
					geometry: {
						kind: "path",
						contours: [{ closed: false, points: [{ x: 1, y: 2 }] }],
					},
					transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
					appearance: { fill: { swatchId: "swatch:black" } },
				},
			],
		}
		const storage = memoryStorage({
			[PREVIOUS_DESIGN_STORAGE_KEY]: JSON.stringify(previous),
		})
		const loaded = readStoredDesignDocument(storage)
		expect(loaded).toMatchObject({
			status: "loaded",
			migrated: true,
			document: {
				version: 3,
				objects: [
					{
						geometry: {
							contours: [
								{
									id: "object:legacy:contour:0",
									points: [{ id: "object:legacy:contour:0:point:0" }],
								},
							],
						},
					},
				],
			},
		})
		expect(storage.values.has(PREVIOUS_DESIGN_STORAGE_KEY)).toBe(false)
	})

	it("does not overwrite or delete malformed and future-version input", () => {
		for (const { code, path, value } of [
			{ code: "json.syntax", path: "$", value: "{" },
			{
				code: "document.future_version",
				path: "$.version",
				value: JSON.stringify({ ...legacyDocument(), version: 999 }),
			},
		]) {
			const storage = memoryStorage({ [DESIGN_STORAGE_KEY]: value })
			const result = readStoredDesignDocument(storage)
			expect(result).toMatchObject({
				status: "invalid",
				errors: [expect.objectContaining({ code, path })],
			})
			expect(storage.values.get(DESIGN_STORAGE_KEY)).toBe(value)
			expect(storage.values.size).toBe(1)
		}
	})
})
