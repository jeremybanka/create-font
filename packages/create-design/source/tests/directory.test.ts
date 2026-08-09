import { describe, expect, it } from "vitest"

import {
	DEFAULT_DESIGN_STROKE_STYLE,
	DEFAULT_LAYER_ID,
	CREATE_DESIGN_SOURCE_VERSION,
	VERSION_TWO_CREATE_DESIGN_SOURCE_VERSION,
	assembleDesignDocument,
	decodeDesignDocument,
	defaultArtboardUnitPath,
	defaultGroupUnitPath,
	defaultLayerUnitPath,
	defaultObjectUnitPath,
	defaultTextContentUnitPath,
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
	version: 6,
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
				fillRule: "nonzero",
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
	layers: [
		{
			id: "layer:artwork",
			name: "Artwork",
			uiColor: "red",
			children: [
				{ kind: "object", id: "object:coral" },
				{ kind: "object", id: "object:ink" },
			],
		},
	],
	groups: [],
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

function appendObjects(
	document: DesignDocument,
	...objects: readonly DesignDocument["objects"][number][]
): DesignDocument {
	const target = document.layers.at(-1)!
	return {
		...document,
		objects: [...document.objects, ...objects],
		layers: document.layers.map((layer) =>
			layer.id === target.id
				? {
						...layer,
						children: [
							...layer.children,
							...objects.map(({ id }) => ({ kind: "object" as const, id })),
						],
					}
				: layer,
		),
	}
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
	it("rejects live-corner metadata on soft nodes in object units", () => {
		const files = mutable(split(fixture()))
		const object = unit(files, defaultObjectUnitPath("object:ink"))
		const geometry = object.geometry as {
			contours: Array<{ points: Array<Record<string, unknown>> }>
		}
		const point = geometry.contours[0]?.points[0]
		if (point === undefined) throw new Error("fixture point is missing")
		point.mode = "soft"
		point.corner = { profile: "circular", amount: 12 }

		expect(
			validateSourceUnit("object", object, "scene/objects/ink.json"),
		).toMatchObject({
			ok: false,
			errors: expect.arrayContaining([
				expect.objectContaining({
					code: "source.schema",
					unitPath: "scene/objects/ink.json",
					path: "$.geometry.contours[0].points[0].corner",
					message: "Corner profiles require a hard node.",
				}),
			]),
		})
	})

	it("round-trips optional artboard appearance in only its source unit", () => {
		const initial = fixture()
		const document: DesignDocument = {
			...initial,
			artboards: initial.artboards.map((artboard) => ({
				...artboard,
				backgroundColor: "#fefefe",
				borderColor: "#123456",
			})),
		}
		const before = split(initial)
		const after = split(document)

		expect(changedPaths(before, after)).toEqual(["artboards/page.json"])
		expect(after["artboards/page.json"]).toMatchObject({
			backgroundColor: "#fefefe",
			borderColor: "#123456",
		})
		expect(assemble(after)).toEqual(document)
	})

	it("round-trips placed-image identity and explicit mask hierarchy", () => {
		const initial = fixture()
		const clip = initial.objects[0]!
		const image = {
			id: "object:placed",
			name: "Placed portrait",
			geometry: {
				kind: "image" as const,
				source: { kind: "embedded" as const, id: "asset:portrait" },
				mediaType: "image/jpeg" as const,
				intrinsicWidth: 640,
				intrinsicHeight: 480,
			},
			transform: { a: 0.5, b: 0, c: 0, d: 0.5, e: 72, f: 96 },
			appearance: {},
		}
		const document: DesignDocument = {
			...initial,
			objects: [image, clip, initial.objects[1]!],
			layers: [
				{
					...initial.layers[0]!,
					children: [
						{ kind: "group", id: "group:portrait-mask" },
						{ kind: "object", id: initial.objects[1]!.id },
					],
				},
			],
			groups: [
				{
					id: "group:portrait-mask",
					name: "Portrait mask",
					children: [
						{ kind: "object", id: image.id },
						{ kind: "object", id: clip.id },
					],
					clippingPathId: clip.id,
				},
			],
		}
		const assetIndex = {
			format: "create-design.asset-index" as const,
			version: 1 as const,
			entries: [
				{
					id: "asset:portrait",
					path: "assets/portrait.jpg",
					mediaType: "image/jpeg",
					byteLength: 1234,
					sha256: "1".repeat(64),
				},
			],
		}
		const files = split(document, { assetIndex })
		expect(files[designSourcePaths.assetIndex]).toEqual(assetIndex)
		expect(assemble(files)).toEqual(document)
	})

	it("preserves a missing linked image as recoverable document structure", () => {
		const initial = fixture()
		const linked = {
			id: "object:linked",
			name: "Missing logo",
			geometry: {
				kind: "image" as const,
				source: {
					kind: "linked" as const,
					id: "asset:linked-logo",
					href: "../brand/logo.jpg",
					expectedDigest: `sha256:${"a".repeat(64)}` as const,
				},
				mediaType: "image/jpeg" as const,
				intrinsicWidth: 300,
				intrinsicHeight: 120,
			},
			transform: { a: 1, b: 0, c: 0, d: 1, e: 10, f: 20 },
			appearance: {},
		}
		const document = appendObjects(initial, linked)
		const result = assembleDesignDocument(split(document))
		expect(result).toMatchObject({ ok: true })
		if (result.ok)
			expect(result.value.objects.at(-1)?.geometry).toEqual(linked.geometry)
	})
	it("round-trips point and area text through canonical object units", () => {
		const document = fixture()
		const typography = {
			font: {
				id: "font:workspace-sans",
				family: "Workspace Sans",
				revision: `sha256:${"0".repeat(64)}`,
			},
			size: 24,
			leading: 28.8,
			tracking: 0,
			kerning: "auto" as const,
			alignment: "start" as const,
			direction: "auto" as const,
		}
		const point = {
			id: "object:point-text",
			name: "Point text",
			geometry: {
				kind: "text" as const,
				mode: "point" as const,
				text: "Hello world",
				typography,
				x: 120,
				y: 180,
			},
			transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
			appearance: { fill: { swatchId: "swatch:ink" } },
		}
		const area = {
			...point,
			id: "object:area-text",
			name: "Area text",
			geometry: {
				...point.geometry,
				mode: "area" as const,
				x: 120,
				y: 240,
				frame: {
					width: 260,
					height: 100,
					inset: { top: 8, right: 8, bottom: 8, left: 8 },
					verticalAlignment: "top" as const,
				},
			},
		}
		const withText = appendObjects(document, point, area)

		const files = split(withText)
		expect(files[defaultTextContentUnitPath(point.id)]).toBe("Hello world")
		expect(files[defaultObjectUnitPath(point.id)]).toMatchObject({
			version: 2,
			geometry: {
				kind: "text",
				contentPath: defaultTextContentUnitPath(point.id),
			},
		})
		expect(files[defaultObjectUnitPath(point.id)]).not.toHaveProperty(
			"geometry.text",
		)
		expect(assemble(files)).toEqual(withText)
	})

	it.each([
		["empty", ""],
		["whitespace", " \t  "],
		["unicode and bidi", "A😀 e\u0301 العربية אבג"],
		["CR, LF, and terminal newline", "one\r\ntwo\rthree\n"],
		["leading BOM scalar", "\uFEFFauthored"],
	])("preserves raw %s text bytes without wrappers", (_label, text) => {
		const base = fixture()
		const object: DesignDocument["objects"][number] = {
			id: "object:raw-text",
			name: "Raw text",
			geometry: {
				kind: "text",
				mode: "point",
				text,
				typography: {
					font: { id: "font:test", family: "Test" },
					size: 12,
					leading: 14,
					tracking: 0,
					kerning: "auto",
					alignment: "start",
					direction: "auto",
				},
				x: 10,
				y: 20,
			},
			transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
			appearance: { fill: { swatchId: "swatch:ink" } },
		}
		const document = appendObjects(base, object)
		const files = split(document)
		expect(files[defaultTextContentUnitPath(object.id)]).toBe(text)
		expect(assemble(files)).toEqual(document)
	})

	it("rejects strings that cannot be represented losslessly as UTF-8", () => {
		expect(formatSourceUnit("text-content", "\uD800")).toMatchObject({
			ok: false,
			errors: expect.arrayContaining([
				expect.objectContaining({ code: "source.schema" }),
			]),
		})
	})

	it("migrates inline version-two source to canonical raw text units", () => {
		const base = fixture()
		const object: DesignDocument["objects"][number] = {
			id: "object:migrate-text",
			name: "Migrate text",
			geometry: {
				kind: "text",
				mode: "point",
				text: "legacy\r\n😀\n",
				typography: {
					font: { id: "font:test", family: "Test" },
					size: 12,
					leading: 14,
					tracking: 0,
					kerning: "auto",
					alignment: "start",
					direction: "auto",
				},
				x: 10,
				y: 20,
			},
			transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
			appearance: { fill: { swatchId: "swatch:ink" } },
		}
		const document = appendObjects(base, object)
		const legacy = structuredClone(split(document)) as Record<string, unknown>
		const objectPath = defaultObjectUnitPath(object.id)
		legacy[objectPath] = {
			format: "create-design.object",
			version: 1,
			id: object.id,
			name: object.name,
			geometry: object.geometry,
			transform: object.transform,
			appearance: object.appearance,
		}
		delete legacy[defaultTextContentUnitPath(object.id)]
		;(
			legacy[designSourcePaths.project] as Record<string, unknown>
		).sourceVersion = VERSION_TWO_CREATE_DESIGN_SOURCE_VERSION
		const hydrated = assemble(legacy)
		expect(hydrated).toEqual(document)
		const migrated = split(hydrated)
		expect(
			(migrated[designSourcePaths.project] as { sourceVersion: number })
				.sourceVersion,
		).toBe(CREATE_DESIGN_SOURCE_VERSION)
		expect(migrated[defaultTextContentUnitPath(object.id)]).toBe(
			object.geometry.kind === "text" ? object.geometry.text : "",
		)
	})

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
		expect(assembled.version).toBe(6)
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

	it("round-trips ordered, empty, hidden, and locked layers with nested groups", () => {
		const original = fixture()
		const layered: DesignDocument = {
			...original,
			layers: [
				{
					id: "layer:background",
					name: "Background",
					uiColor: "red",
					hidden: true,
					children: [{ kind: "object", id: "object:coral" }],
				},
				{
					id: "layer:empty",
					name: "Empty notes",
					uiColor: "blue",
					locked: true,
					children: [],
				},
				{
					id: "layer:foreground",
					name: "Foreground",
					uiColor: "yellow",
					children: [{ kind: "group", id: "group:top" }],
				},
			],
			groups: [
				{
					id: "group:nested",
					name: "Nested",
					children: [{ kind: "object", id: "object:ink" }],
				},
				{
					id: "group:top",
					name: "Top",
					children: [{ kind: "group", id: "group:nested" }],
				},
			],
		}
		const files = mutable(
			split(layered, {
				layerPath: (layer, index) =>
					`scene/layers/${index}-${layer.name.toLowerCase().replaceAll(" ", "-")}.json`,
			}),
		)
		expect(unit(files, designSourcePaths.layerIndex).entries).toEqual([
			{ id: "layer:background", path: "scene/layers/0-background.json" },
			{ id: "layer:empty", path: "scene/layers/1-empty-notes.json" },
			{ id: "layer:foreground", path: "scene/layers/2-foreground.json" },
		])
		expect(unit(files, "scene/layers/0-background.json")).toMatchObject({
			version: 2,
			name: "Background",
			hidden: true,
		})
		expect(unit(files, "scene/layers/1-empty-notes.json")).toMatchObject({
			children: [],
			locked: true,
		})

		const objectIndex = unit(files, designSourcePaths.objectIndex)
		objectIndex.entries = (
			structuredClone(objectIndex.entries) as Record<string, unknown>[]
		).toReversed()
		expect(assemble(files)).toEqual(layered)
	})

	it("migrates a pre-v4 singleton layer unit without changing hierarchy order", () => {
		const original = fixture()
		const files = mutable(split(original))
		const project = unit(files, designSourcePaths.project)
		project.sourceVersion = 3
		project.documentVersion = 5
		const currentLayer = unit(files, defaultLayerUnitPath(DEFAULT_LAYER_ID))
		files[defaultLayerUnitPath(DEFAULT_LAYER_ID)] = {
			format: "create-design.layer",
			version: 1,
			id: DEFAULT_LAYER_ID,
			children: currentLayer.children,
		}

		expect(assemble(files)).toEqual(original)
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
			layers: original.layers.map((layer) => ({
				...layer,
				children: layer.children.toReversed(),
			})),
		})
		expect(changedPaths(originalFiles, reorderedFiles)).toEqual([
			"scene/layers/artwork.json",
		])
		expect(reorderedFiles[designSourcePaths.objectIndex]).toEqual(
			originalFiles[designSourcePaths.objectIndex],
		)
	})

	it("persists a layer UI color in only that layer source unit", () => {
		const original = fixture()
		const originalFiles = split(original)
		const recolored = {
			...original,
			layers: original.layers.map((layer) => ({
				...layer,
				uiColor: "magenta" as const,
			})),
		}
		const recoloredFiles = split(recolored)
		expect(changedPaths(originalFiles, recoloredFiles)).toEqual([
			defaultLayerUnitPath("layer:artwork"),
		])
		expect(recoloredFiles[defaultLayerUnitPath("layer:artwork")]).toMatchObject(
			{
				uiColor: "magenta",
			},
		)
		expect(assemble(recoloredFiles)).toEqual(recolored)
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
						byteLength: 42,
						id: "font:escape",
						mediaType: "font/woff2",
						path: "fonts/%2e%2e/escape.woff2",
						sha256: "0".repeat(64),
					},
				],
			}),
		).toMatchObject({ ok: false })
	})

	it("requires canonical descriptor metadata in font inventories", () => {
		expect(
			validateSourceUnit("font-index", {
				format: "create-design.font-index",
				version: 1,
				entries: [
					{
						id: "font:workspace-sans",
						path: "fonts/workspace-sans.otf",
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
						byteLength: 58_068,
						id: "font:workspace-sans",
						mediaType: "font/otf",
						path: "fonts/workspace-sans.otf",
						sha256: "0".repeat(64),
					},
				],
			}),
		).toMatchObject({ ok: true })
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

	it("rejects missing, orphaned, and noncanonical text sidecars", () => {
		const base = fixture()
		const textObject: DesignDocument["objects"][number] = {
			id: "object:sidecar",
			name: "Sidecar",
			geometry: {
				kind: "text",
				mode: "point",
				text: "sidecar",
				typography: {
					font: { id: "font:test", family: "Test" },
					size: 12,
					leading: 14,
					tracking: 0,
					kerning: "auto",
					alignment: "start",
					direction: "auto",
				},
				x: 0,
				y: 0,
			},
			transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
			appearance: { fill: { swatchId: "swatch:ink" } },
		}
		const canonical = split(appendObjects(base, textObject))
		const missing = structuredClone(canonical) as Record<string, unknown>
		delete missing[defaultTextContentUnitPath(textObject.id)]
		expect(assembleDesignDocument(missing)).toMatchObject({
			ok: false,
			errors: expect.arrayContaining([
				expect.objectContaining({ code: "directory.missing_file" }),
			]),
		})
		const orphaned = structuredClone(canonical) as Record<string, unknown>
		orphaned["scene/objects/orphan.txt"] = "orphan"
		expect(assembleDesignDocument(orphaned)).toMatchObject({
			ok: false,
			errors: expect.arrayContaining([
				expect.objectContaining({ code: "directory.orphan_file" }),
			]),
		})
		const redirected = structuredClone(canonical) as Record<string, unknown>
		const objectPath = defaultObjectUnitPath(textObject.id)
		const file = redirected[objectPath] as {
			geometry: { contentPath: string }
		}
		file.geometry.contentPath = "scene/objects/other.txt"
		redirected["scene/objects/other.txt"] = "sidecar"
		expect(assembleDesignDocument(redirected)).toMatchObject({
			ok: false,
			errors: expect.arrayContaining([
				expect.objectContaining({ code: "directory.reference" }),
			]),
		})
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

	it("splits and assembles nested structural groups", () => {
		const document = fixture()
		const grouped: DesignDocument = {
			...document,
			layers: document.layers.map((layer) => ({
				...layer,
				children: [{ kind: "group", id: "group:artwork" }],
			})),
			groups: [
				{
					id: "group:artwork",
					name: "Artwork",
					children: document.objects.map(({ id }) => ({
						kind: "object",
						id,
					})),
				},
			],
		}
		const files = split(grouped)
		expect(unit(files, designSourcePaths.groupIndex).entries).toHaveLength(1)
		expect(assemble(files)).toEqual(grouped)
	})

	it("keeps groups unavailable to legacy source version 1", () => {
		const document = fixture()
		const files = mutable(
			split({
				...document,
				layers: document.layers.map((layer) => ({
					...layer,
					children: [{ kind: "group", id: "group:artwork" }],
				})),
				groups: [
					{
						id: "group:artwork",
						name: "Artwork",
						children: document.objects.map(({ id }) => ({
							kind: "object",
							id,
						})),
					},
				],
			}),
		)
		unit(files, designSourcePaths.project).sourceVersion = 1
		expect(assembleDesignDocument(files)).toMatchObject({
			ok: false,
			errors: expect.arrayContaining([
				expect.objectContaining({ code: "directory.unsupported" }),
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
		unit(files, designSourcePaths.project).sourceVersion = 1
		const index = unit(files, designSourcePaths.layerIndex)
		index.entries = [{ id: "layer:renamed", path: "scene/layers/artwork.json" }]
		const result = assembleDesignDocument(files)
		expect(result).toMatchObject({
			ok: false,
			errors: expect.arrayContaining([
				expect.objectContaining({
					code: "directory.unsupported",
					message: `Source versions before ${CREATE_DESIGN_SOURCE_VERSION} require the singleton ${DEFAULT_LAYER_ID} layer.`,
				}),
			]),
		})
	})

	it("reports precise layer schema, inventory, and hierarchy failures", () => {
		expect(
			validateSourceUnit("layer", {
				format: "create-design.layer",
				version: 2,
				id: "not-a-layer",
				name: "Invalid",
				children: [],
			}),
		).toMatchObject({
			ok: false,
			errors: [expect.objectContaining({ path: "$.id" })],
		})

		const original = fixture()
		const duplicateLayer = {
			...original,
			layers: [...original.layers, { ...original.layers[0]!, children: [] }],
		}
		expect(validateDesignDocument(duplicateLayer)).toMatchObject({
			ok: false,
			errors: expect.arrayContaining([
				expect.objectContaining({
					code: "directory.duplicate_id",
					path: "$.layers[1].id",
				}),
			]),
		})

		const missing = mutable(split(original))
		delete missing[defaultLayerUnitPath(DEFAULT_LAYER_ID)]
		expect(assembleDesignDocument(missing)).toMatchObject({
			ok: false,
			errors: expect.arrayContaining([
				expect.objectContaining({
					code: "directory.missing_file",
					unitPath: defaultLayerUnitPath(DEFAULT_LAYER_ID),
				}),
			]),
		})

		const grouped: DesignDocument = {
			...original,
			layers: [
				{
					id: "layer:first",
					name: "First",
					children: [{ kind: "group", id: "group:shared" }],
				},
				{
					id: "layer:second",
					name: "Second",
					children: [],
				},
			],
			groups: [
				{
					id: "group:shared",
					name: "Shared",
					children: original.objects.map(({ id }) => ({
						kind: "object",
						id,
					})),
				},
			],
		}
		const crossLayer = mutable(split(grouped))
		const secondLayerPath = defaultLayerUnitPath("layer:second")
		unit(crossLayer, secondLayerPath).children = [
			{ kind: "group", id: "group:shared" },
		]
		const crossLayerResult = assembleDesignDocument(crossLayer)
		expect(crossLayerResult).toMatchObject({
			ok: false,
			errors: expect.arrayContaining([
				expect.objectContaining({
					code: "directory.hierarchy",
					path: "$.children[0].id",
					unitPath: secondLayerPath,
				}),
			]),
		})

		const cyclic = mutable(split(grouped))
		unit(cyclic, defaultGroupUnitPath("group:shared")).children = [
			{ kind: "group", id: "group:shared" },
		]
		expect(assembleDesignDocument(cyclic)).toMatchObject({
			ok: false,
			errors: expect.arrayContaining([
				expect.objectContaining({
					code: "directory.hierarchy",
					path: "$.children[0].id",
					unitPath: defaultGroupUnitPath("group:shared"),
				}),
			]),
		})
	})
})
