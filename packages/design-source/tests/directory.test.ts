import { describe, expect, it } from "vitest"

import {
	DEFAULT_LAYER_ID,
	assembleDesignDocument,
	defaultObjectUnitPath,
	designSourcePaths,
	formatSourceUnit,
	parseSourceUnitText,
	sourceUnitKindForPath,
	splitDesignDocument,
	validateDesignDocument,
	validateSourceUnit,
	type DesignDocument,
	type DesignSourceDirectoryFiles,
	type DocumentFile,
} from "../src/index.ts"

const fixture = (): DesignDocument => ({
	format: "create-design.document",
	version: 1,
	title: "Directory proof",
	page: { width: 612, height: 792 },
	swatches: [
		{
			id: "swatch:coral",
			name: "Coral",
			source: { space: "rgb", r: 218, g: 94, b: 67 },
			alternate: { space: "cmyk", c: 0, m: 72, y: 68, k: 4 },
		},
		{
			id: "swatch:ink",
			name: "Ink",
			source: { space: "cmyk", c: 60, m: 40, y: 40, k: 100 },
		},
	],
	objects: [
		{
			id: "object:coral",
			name: "Coral rectangle",
			fillId: "swatch:coral",
			contours: [
				{
					closed: true,
					points: [
						{ x: 82, y: 102 },
						{ x: 362, y: 102 },
						{ x: 362, y: 342 },
						{ x: 82, y: 342 },
					],
				},
			],
		},
		{
			id: "object:ink",
			name: "Ink curve",
			fillId: "swatch:ink",
			locked: true,
			contours: [
				{
					closed: false,
					points: [
						{ x: 40, y: 50, outgoing: { x: 30, y: 20 } },
						{ x: 180, y: 120, incoming: { x: -40, y: -10 } },
					],
				},
			],
		},
	],
	guides: [{ id: "guide:center", axis: "x", value: 306 }],
})

function split(
	document: DesignDocument,
	options?: Parameters<typeof splitDesignDocument>[1],
): DesignSourceDirectoryFiles {
	const result = splitDesignDocument(document, options)
	if (!result.ok) throw new Error(result.errors[0].message)
	return result.value
}

function assemble(files: DesignSourceDirectoryFiles): DesignDocument {
	const result = assembleDesignDocument(files)
	if (!result.ok)
		throw new Error(
			result.errors
				.map(
					(error) =>
						`${error.code} ${error.unitPath ?? ""} ${error.path}: ${error.message}`,
				)
				.join("\n"),
		)
	return result.value
}

function mutable(
	files: DesignSourceDirectoryFiles,
): Record<string, Record<string, unknown>> {
	return structuredClone(files) as Record<string, Record<string, unknown>>
}

function unit(
	files: Record<string, Record<string, unknown>>,
	path: string,
): Record<string, unknown> {
	const value = files[path]
	if (value === undefined)
		throw new Error(`Missing fixture source unit ${path}.`)
	return value
}

function changedPaths(
	left: DesignSourceDirectoryFiles,
	right: DesignSourceDirectoryFiles,
): readonly string[] {
	return [...new Set([...Object.keys(left), ...Object.keys(right)])]
		.filter(
			(path) => JSON.stringify(left[path]) !== JSON.stringify(right[path]),
		)
		.toSorted()
}

describe("create-design directory source", () => {
	it("splits and reassembles the current document without losing authored facts", () => {
		const document = fixture()
		const files = split(document)
		expect(assemble(files)).toEqual(document)
		expect(files[designSourcePaths.groupIndex]).toMatchObject({ entries: [] })
		expect(files[designSourcePaths.assetIndex]).toMatchObject({ entries: [] })
		expect(files[designSourcePaths.fontIndex]).toMatchObject({ entries: [] })
		expect(files[designSourcePaths.objectIndex]).toMatchObject({
			entries: [
				{
					id: "object:coral",
					path: defaultObjectUnitPath("object:coral"),
				},
				{
					id: "object:ink",
					path: defaultObjectUnitPath("object:ink"),
				},
			],
		})
	})

	it("keeps IDs, display names, source paths, and stacking order independent", () => {
		const original = fixture()
		const originalFiles = split(original)
		const renamed = {
			...original,
			objects: original.objects.map((object) =>
				object.id === "object:coral"
					? { ...object, name: "Renamed without moving" }
					: object,
			),
		}
		const renamedFiles = split(renamed)
		expect(changedPaths(originalFiles, renamedFiles)).toEqual([
			defaultObjectUnitPath("object:coral"),
		])

		const reorderedFiles = split({
			...original,
			objects: original.objects.toReversed(),
		})
		expect(changedPaths(originalFiles, reorderedFiles)).toEqual([
			"scene/layers/artwork.json",
		])
		expect(reorderedFiles[designSourcePaths.objectIndex]).toEqual(
			originalFiles[designSourcePaths.objectIndex],
		)
	})

	it("supports explicit stable object paths without deriving identity from them", () => {
		const document = fixture()
		const files = split(document, {
			objectPath: (object) =>
				object.id === "object:coral"
					? "scene/objects/brand/coral.json"
					: defaultObjectUnitPath(object.id),
		})
		expect(files["scene/objects/brand/coral.json"]).toMatchObject({
			id: "object:coral",
		})
		expect(assemble(files)).toEqual(document)
	})

	it("emits canonical source text with sorted keys, retained order, and negative zero", () => {
		const result = formatSourceUnit("document", {
			version: 1,
			title: "Canonical",
			guides: [{ value: -0, id: "guide:zero", axis: "x" }],
			format: "create-design.metadata",
		})
		expect(result).toEqual({
			ok: true,
			value:
				'{\n\t"format": "create-design.metadata",\n\t"guides": [{ "axis": "x", "id": "guide:zero", "value": -0 }],\n\t"title": "Canonical",\n\t"version": 1\n}\n',
		})
		const parsed = parseSourceUnitText(
			"document",
			result.ok ? result.value : "",
			"document.json",
		)
		expect(parsed.ok).toBe(true)
		if (parsed.ok) {
			const document = parsed.value as DocumentFile
			expect(Object.is(document.guides[0]?.value, -0)).toBe(true)
		}
	})

	it("classifies singleton, inventory, collection, and unknown paths", () => {
		expect(sourceUnitKindForPath("create-design.json")).toBe("project")
		expect(sourceUnitKindForPath("scene/objects/index.json")).toBe(
			"object-index",
		)
		expect(sourceUnitKindForPath("scene/objects/brand/mark.json")).toBe(
			"object",
		)
		expect(sourceUnitKindForPath("../escape.json")).toBeNull()
	})

	it("rejects encoded traversal in reserved asset and font inventories", () => {
		expect(
			validateSourceUnit("asset-index", {
				format: "create-design.asset-index",
				version: 1,
				entries: [
					{
						id: "asset:escape",
						path: "assets/%252e%252e/escape.png",
						mediaType: "image/png",
						sha256: "0".repeat(64),
					},
				],
			}),
		).toMatchObject({ ok: false })
		expect(
			validateSourceUnit("font-index", {
				format: "create-design.font-index",
				version: 1,
				entries: [
					{
						id: "font:escape",
						path: "fonts/%2e%2e/escape.woff2",
						sha256: "0".repeat(64),
					},
				],
			}),
		).toMatchObject({ ok: false })
	})

	it("rejects unsafe and duplicate object source paths before splitting", () => {
		const document = fixture()
		const unsafe = splitDesignDocument(document, {
			objectPath: () => "../object.json",
		})
		expect(unsafe).toMatchObject({
			ok: false,
			errors: expect.arrayContaining([
				expect.objectContaining({ code: "directory.unsafe_path" }),
			]),
		})
		const duplicate = splitDesignDocument(document, {
			objectPath: () => "scene/objects/shared.json",
		})
		expect(duplicate).toMatchObject({
			ok: false,
			errors: expect.arrayContaining([
				expect.objectContaining({ code: "directory.duplicate_path" }),
			]),
		})
	})

	it("rejects missing, orphaned, unknown, and identity-mismatched units", () => {
		const files = mutable(split(fixture()))
		delete files[defaultObjectUnitPath("object:ink")]
		files["scene/objects/orphan.json"] = {
			format: "create-design.object",
			version: 1,
			id: "object:orphan",
			name: "Orphan",
			contours: [],
			fillId: "swatch:ink",
		}
		files["notes.txt"] = { ignored: false }
		files[defaultObjectUnitPath("object:coral")] = {
			...files[defaultObjectUnitPath("object:coral")],
			id: "object:not-coral",
		}
		const result = assembleDesignDocument(files)
		expect(result).toMatchObject({ ok: false })
		if (result.ok) throw new Error("Expected invalid directory.")
		expect(result.errors.map(({ code }) => code)).toEqual(
			expect.arrayContaining([
				"directory.missing_file",
				"directory.orphan_file",
				"directory.unknown_file",
				"directory.entity_id",
			]),
		)
	})

	it("rejects duplicate inventories, dangling children, and unparented objects", () => {
		const files = mutable(split(fixture()))
		const index = unit(files, designSourcePaths.objectIndex)
		const entries = structuredClone(index.entries) as Record<string, unknown>[]
		index.entries = [...entries, entries[0]]
		const layer = unit(files, "scene/layers/artwork.json")
		layer.children = [
			{ kind: "object", id: "object:missing" },
			{ kind: "object", id: "object:coral" },
			{ kind: "object", id: "object:coral" },
		]
		const result = assembleDesignDocument(files)
		expect(result).toMatchObject({ ok: false })
		if (result.ok) throw new Error("Expected invalid hierarchy.")
		expect(result.errors.map(({ code }) => code)).toEqual(
			expect.arrayContaining([
				"directory.duplicate_id",
				"directory.duplicate_path",
				"directory.reference",
				"directory.hierarchy",
			]),
		)
		expect(
			result.errors.some(({ message }) =>
				message.includes("object:ink has no structural parent"),
			),
		).toBe(true)
	})

	it("reserves groups, assets, fonts, and multiple artboards for later versions", () => {
		const files = mutable(split(fixture()))
		unit(files, designSourcePaths.groupIndex).entries = [
			{ id: "group:future", path: "scene/groups/future.json" },
		]
		files["scene/groups/future.json"] = {
			format: "create-design.group",
			version: 1,
			id: "group:future",
			name: "Future group",
			children: [],
		}
		const result = assembleDesignDocument(files)
		expect(result).toMatchObject({
			ok: false,
			errors: expect.arrayContaining([
				expect.objectContaining({
					code: "directory.unsupported",
					unitPath: designSourcePaths.groupIndex,
				}),
			]),
		})
	})

	it("validates relational facts in complete in-memory documents", () => {
		const document = fixture()
		expect(
			validateDesignDocument({
				...document,
				objects: [
					...document.objects,
					{ ...document.objects[0], fillId: "swatch:missing" },
				],
			}),
		).toMatchObject({
			ok: false,
			errors: expect.arrayContaining([
				expect.objectContaining({ code: "directory.duplicate_id" }),
				expect.objectContaining({ code: "directory.reference" }),
			]),
		})
	})

	it("requires the canonical version-one layer identity", () => {
		const files = mutable(split(fixture()))
		const index = unit(files, designSourcePaths.layerIndex)
		index.entries = [{ id: "layer:renamed", path: "scene/layers/artwork.json" }]
		const result = assembleDesignDocument(files)
		expect(result).toMatchObject({
			ok: false,
			errors: expect.arrayContaining([
				expect.objectContaining({
					code: "directory.entity_id",
					message: `Source version 1 requires layer ID ${DEFAULT_LAYER_ID}.`,
				}),
			]),
		})
	})
})
