import { describe, expect, it } from "vitest"

import {
	DEFAULT_DESIGN_STROKE_STYLE,
	DEFAULT_LAYER_ID,
	assembleDesignDocument,
	decodeDesignDocument,
	defaultArtboardUnitPath,
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
	version: 5,
	title: "Directory proof",
	artboards: [
		{
			id: "artboard:page",
			name: "Artboard 1",
			x: -24,
			y: 36,
			width: 612,
			height: 792,
		},
	],
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
			geometry: {
				kind: "rectangle",
				x: 82,
				y: 102,
				width: 280,
				height: 240,
			},
			transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
			appearance: { fill: { swatchId: "swatch:coral" } },
		},
		{
			id: "object:ink",
			name: "Ink curve",
			locked: true,
			geometry: {
				kind: "path",
				contours: [
					{
						id: "contour:ink",
						closed: false,
						points: [
							{
								id: "point:ink:start",
								x: 40,
								y: 50,
								outgoing: { x: 30, y: 20 },
							},
							{
								id: "point:ink:end",
								x: 180,
								y: 120,
								incoming: { x: -40, y: -10 },
							},
						],
					},
				],
			},
			transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
			appearance: { fill: { swatchId: "swatch:ink" } },
		},
	],
	guides: [{ id: "guide:center", axis: "x", value: 306, locked: true }],
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
	it("normalizes legacy path-and-fill objects deterministically", () => {
		const document = fixture()
		const result = decodeDesignDocument({
			format: document.format,
			version: 1,
			title: document.title,
			page: {
				width: document.artboards[0]!.width,
				height: document.artboards[0]!.height,
			},
			swatches: document.swatches,
			objects: [
				{
					id: "object:legacy",
					name: "Legacy",
					contours: [
						{
							closed: true,
							points: [
								{ x: 1, y: 2 },
								{ x: 3, y: 4 },
								{ x: 5, y: 6 },
							],
						},
					],
					fillId: "swatch:coral",
				},
			],
			guides: document.guides,
		})
		expect(result).toMatchObject({
			ok: true,
			value: {
				objects: [
					{
						geometry: {
							kind: "path",
							contours: [
								{
									id: "object:legacy:contour:0",
									points: [
										{ id: "object:legacy:contour:0:point:0" },
										{ id: "object:legacy:contour:0:point:1" },
										{ id: "object:legacy:contour:0:point:2" },
									],
								},
							],
						},
						transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
						appearance: { fill: { swatchId: "swatch:coral" } },
					},
				],
			},
		})
	})

	it("normalizes v2 width-only stroke object units", () => {
		const files = mutable(split(fixture()))
		unit(files, "create-design.json").documentVersion = 2
		const object = unit(files, defaultObjectUnitPath("object:coral"))
		object.appearance = {
			stroke: { swatchId: "swatch:ink", width: 3 },
		}
		const assembled = assemble(files as DesignSourceDirectoryFiles)
		expect(assembled.version).toBe(5)
		expect(assembled.objects[0]?.appearance.stroke).toEqual({
			...DEFAULT_DESIGN_STROKE_STYLE,
			swatchId: "swatch:ink",
			width: 3,
		})
	})

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

	it("owns ordered global artboards independently from object units", () => {
		const original = fixture()
		const originalFiles = split(original)
		const artboard = original.artboards[0]!
		expect(originalFiles["artboards/page.json"]).toMatchObject({
			id: artboard.id,
			name: artboard.name,
			x: artboard.x,
			y: artboard.y,
			width: artboard.width,
			height: artboard.height,
		})
		const movedFiles = split({
			...original,
			artboards: [
				{ ...artboard, x: 240, y: -180, height: 1_000 },
				{
					id: "artboard:social",
					name: "Social square",
					x: 700,
					y: -180,
					width: 500,
					height: 500,
					bleed: { top: 9, right: 9, bottom: 9, left: 9 },
					safeArea: { top: 24, right: 24, bottom: 24, left: 24 },
				},
			],
		})
		expect(changedPaths(originalFiles, movedFiles)).toEqual([
			defaultArtboardUnitPath("artboard:social"),
			"artboards/index.json",
			"artboards/page.json",
		])
		for (const object of original.objects) {
			expect(movedFiles[defaultObjectUnitPath(object.id)]).toEqual(
				originalFiles[defaultObjectUnitPath(object.id)],
			)
		}
		expect(assemble(movedFiles).artboards).toEqual([
			{ ...artboard, x: 240, y: -180, height: 1_000 },
			{
				id: "artboard:social",
				name: "Social square",
				x: 700,
				y: -180,
				width: 500,
				height: 500,
				bleed: { top: 9, right: 9, bottom: 9, left: 9 },
				safeArea: { top: 24, right: 24, bottom: 24, left: 24 },
			},
		])
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

	it("formats a varied valid metadata corpus idempotently at nested width boundaries", () => {
		const documents = Array.from(
			{ length: 25 },
			(_, guideCount): DocumentFile => ({
				format: "create-design.metadata",
				version: 1,
				title: `Width boundary ${guideCount}`,
				guides: Array.from({ length: guideCount }, (_, index) => ({
					axis: index % 2 === 0 ? "y" : "x",
					id: `guide:${index}_${"x".repeat(10 + (index % 9))}`,
					value: index * 11.339506169749999,
				})),
			}),
		)

		for (const document of documents) {
			const formatted = formatSourceUnit("document", document)
			expect(formatted.ok).toBe(true)
			if (!formatted.ok) continue
			const parsed = parseSourceUnitText("document", formatted.value)
			expect(parsed.ok).toBe(true)
			if (!parsed.ok) continue
			expect(formatSourceUnit("document", parsed.value)).toEqual(formatted)
		}

		const elevenGuides = documents[11]
		if (elevenGuides === undefined)
			throw new Error("Missing regression fixture.")
		const regression = formatSourceUnit("document", {
			...elevenGuides,
			guides: elevenGuides.guides.map((guide, index) =>
				index === 4
					? {
							axis: "y",
							id: "guide:4_xxxxxxxxxxxxxx",
							value: 45.358024678999996,
						}
					: guide,
			),
		})
		expect(regression.ok).toBe(true)
		if (regression.ok) {
			expect(regression.value).toContain(
				'\t\t{\n\t\t\t"axis": "y",\n\t\t\t"id": "guide:4_xxxxxxxxxxxxxx",\n\t\t\t"value": 45.358024678999996\n\t\t},',
			)
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
						byteLength: 42,
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

	it("accepts byte-preserved asset descriptors without treating bytes as JSON units", () => {
		const files = mutable(split(fixture()))
		unit(files, designSourcePaths.assetIndex).entries = [
			{
				id: "asset:reference",
				path: "assets/reference.png",
				mediaType: "image/png",
				byteLength: 42,
				sha256: "0".repeat(64),
			},
		]
		expect(assembleDesignDocument(files)).toMatchObject({ ok: true })
	})

	it("reserves groups and fonts for later versions", () => {
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

	it("requires a source-version bump before adding artboards", () => {
		const files = mutable(split(fixture()))
		unit(files, designSourcePaths.project).sourceVersion = 1
		unit(files, designSourcePaths.artboardIndex).entries = [
			{ id: "artboard:page", path: "artboards/page.json" },
			{ id: "artboard:second", path: "artboards/second.json" },
		]
		files["artboards/second.json"] = {
			format: "create-design.artboard",
			version: 2,
			id: "artboard:second",
			name: "Second",
			x: 700,
			y: 0,
			width: 400,
			height: 400,
		}
		expect(assembleDesignDocument(files)).toMatchObject({
			ok: false,
			errors: expect.arrayContaining([
				expect.objectContaining({
					code: "directory.unsupported",
					unitPath: designSourcePaths.artboardIndex,
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
					{
						...document.objects[0],
						appearance: { fill: { swatchId: "swatch:missing" } },
					},
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
