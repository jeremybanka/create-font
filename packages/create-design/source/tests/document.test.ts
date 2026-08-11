import { describe, expect, it } from "vitest"

import {
	CREATE_DESIGN_DOCUMENT_VERSION,
	decodeDesignDocument,
	parseDesignDocumentText,
	validateDesignDocument,
} from "../src/document.ts"
import { DEFAULT_DESIGN_STROKE_STYLE } from "../src/types.ts"
import { createInitialDocument } from "../src/initial-document.ts"

const legacyFixture = () => ({
	format: "create-design.document" as const,
	version: 1 as const,
	title: "Legacy campaign",
	page: { width: 612, height: 792 },
	swatches: [
		{
			id: "swatch:coral",
			name: "Coral",
			source: { space: "rgb" as const, r: 218, g: 94, b: 67 },
			alternate: {
				space: "cmyk" as const,
				c: 0,
				m: 72,
				y: 68,
				k: 4,
			},
		},
	],
	objects: [
		{
			id: "object:mark",
			name: "Campaign mark",
			contours: [
				{
					id: "contour:legacy-mark",
					closed: true,
					points: [
						{
							id: "point:legacy-start",
							x: 10,
							y: 20,
							outgoing: { x: 3, y: 4 },
						},
						{
							id: "point:legacy-end",
							x: 50,
							y: 60,
							incoming: { x: -5, y: -6 },
						},
					],
				},
			],
			fillId: "swatch:coral",
			hidden: false,
			locked: true,
		},
	],
	guides: [
		{ id: "guide:left", axis: "x" as const, value: 10 },
		{ id: "guide:baseline", axis: "y" as const, value: 700 },
	],
})

describe("editable text source", () => {
	it("accepts optional solid artboard appearance and rejects invalid colors", () => {
		const initial = createInitialDocument()
		const document = {
			...initial,
			artboards: initial.artboards.map((artboard) => ({
				...artboard,
				backgroundColor: "#abcdef",
				borderColor: "#767676",
			})),
		}
		expect(validateDesignDocument(document).ok).toBe(true)
		expect(
			validateDesignDocument({
				...document,
				artboards: [{ ...document.artboards[0]!, backgroundColor: "red" }],
			}).ok,
		).toBe(false)
	})

	it("round-trips point and area text with durable font references", () => {
		const base = {
			format: "create-design.document" as const,
			version: CREATE_DESIGN_DOCUMENT_VERSION,
			title: "Type specimen",
			artboards: [
				{
					id: "artboard:page",
					name: "Page",
					x: 0,
					y: 0,
					width: 400,
					height: 300,
				},
			],
			swatches: [
				{
					id: "swatch:black",
					name: "Black",
					source: { space: "rgb" as const, r: 0, g: 0, b: 0 },
				},
			],
			objects: [
				{
					id: "object:text",
					name: "Headline",
					geometry: {
						kind: "text" as const,
						mode: "area" as const,
						text: "مرحبا world",
						x: 20,
						y: 30,
						typography: {
							font: {
								id: "font:specimen",
								family: "Specimen",
								revision: "sha256:test",
							},
							size: 32,
							leading: 38,
							tracking: 10,
							kerning: "auto" as const,
							alignment: "start" as const,
							direction: "auto" as const,
						},
						frame: {
							width: 220,
							height: 90,
							inset: { top: 4, right: 4, bottom: 4, left: 4 },
							verticalAlignment: "top" as const,
						},
					},
					transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
					appearance: { fill: { swatchId: "swatch:black" } },
				},
			],
			layers: [
				{
					id: "layer:artwork",
					name: "Artwork",
					uiColor: "red" as const,
					children: [{ kind: "object" as const, id: "object:text" }],
				},
			],
			groups: [],
			guides: [],
		}
		const validated = validateDesignDocument(base)
		expect(validated).toEqual({ ok: true, value: base })
		expect(parseDesignDocumentText(JSON.stringify(base))).toEqual(validated)
	})

	it("rejects area text without a frame and point text with one", () => {
		const point = {
			format: "create-design.document",
			version: CREATE_DESIGN_DOCUMENT_VERSION,
			title: "Invalid type",
			artboards: [
				{
					id: "artboard:page",
					name: "Page",
					x: 0,
					y: 0,
					width: 100,
					height: 100,
				},
			],
			swatches: [],
			objects: [
				{
					id: "object:text",
					name: "Text",
					geometry: {
						kind: "text",
						mode: "area",
						text: "x",
						x: 0,
						y: 0,
						typography: {
							font: { id: "font:test", family: "Test" },
							size: 12,
							leading: 14,
							tracking: 0,
							kerning: "auto",
							alignment: "start",
							direction: "auto",
						},
					},
					transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
					appearance: {},
				},
			],
			guides: [],
		}
		expect(validateDesignDocument(point)).toMatchObject({ ok: false })
	})
})

const canonicalV1Fixture = () => ({
	format: "create-design.document" as const,
	version: 1 as const,
	title: "Canonical v1 campaign",
	page: { width: 841.89, height: 595.28 },
	swatches: [
		{
			id: "swatch:brand",
			name: "Brand blue",
			source: { space: "rgb" as const, r: 12, g: 34, b: 210 },
			alternate: {
				space: "cmyk" as const,
				c: 91,
				m: 79,
				y: 0,
				k: 0,
			},
		},
		{
			id: "swatch:accent",
			name: "Accent",
			source: { space: "cmyk" as const, c: 0, m: 70, y: 80, k: 3 },
		},
	],
	objects: [
		{
			id: "object:transformed-rectangle",
			name: "Transformed rectangle",
			geometry: {
				kind: "rectangle" as const,
				x: 17,
				y: 29,
				width: 203,
				height: 107,
			},
			transform: { a: 0.5, b: 0.25, c: -0.125, d: 2, e: 43, f: -19 },
			appearance: {
				fill: { swatchId: "swatch:brand" },
				stroke: { swatchId: "swatch:accent", width: 3.5 },
			},
			hidden: false,
			locked: true,
		},
		{
			id: "object:identified-path",
			name: "Identified path",
			geometry: {
				kind: "path" as const,
				contours: [
					{
						id: "contour:identified",
						closed: false,
						points: [
							{
								id: "point:identified-a",
								x: 1,
								y: 2,
								outgoing: { x: 3, y: 4 },
							},
							{
								id: "point:identified-b",
								x: 50,
								y: 60,
								incoming: { x: -7, y: 8 },
							},
						],
					},
				],
			},
			transform: { a: 1, b: 0, c: 0, d: 1, e: 11, f: 13 },
			appearance: { stroke: { swatchId: "swatch:brand", width: 0.75 } },
			hidden: true,
			locked: false,
		},
	],
	guides: [
		{ id: "guide:vertical", axis: "x" as const, value: 123.5 },
		{ id: "guide:horizontal", axis: "y" as const, value: 456.25 },
	],
})

describe("complete design document codec", () => {
	const migratedGuides = (
		guides: readonly Readonly<{
			id: string
			axis: "x" | "y"
			value: number
			locked?: boolean
		}>[],
	) =>
		guides.map((guide) => ({
			id: guide.id,
			a:
				guide.axis === "x"
					? { x: guide.value, y: 0 }
					: { x: 0, y: guide.value },
			b:
				guide.axis === "x"
					? { x: guide.value, y: 1 }
					: { x: 1, y: guide.value },
			...(guide.locked === undefined ? {} : { locked: guide.locked }),
		}))
	it("round-trips optional live-corner metadata without a source-version bump", () => {
		const decoded = decodeDesignDocument(canonicalV1Fixture())
		if (!decoded.ok) throw new Error("Expected the fixture to migrate.")
		const path = decoded.value.objects[1]
		if (path?.geometry.kind !== "path")
			throw new Error("Expected an identified path fixture.")
		const points = path.geometry.contours[0]?.points
		if (points === undefined || points[0] === undefined)
			throw new Error("Expected a path point fixture.")
		const document = {
			...decoded.value,
			objects: decoded.value.objects.map((object) =>
				object.id !== path.id || object.geometry.kind !== "path"
					? object
					: {
							...object,
							geometry: {
								...object.geometry,
								contours: object.geometry.contours.map((contour, index) =>
									index !== 0
										? contour
										: {
												...contour,
												closed: true,
												points: [
													...contour.points.map((point, pointIndex) =>
														pointIndex !== 0
															? point
															: {
																	...point,
																	mode: "hard" as const,
																	corner: {
																		profile: "squircle" as const,
																		amount: 18,
																	},
																},
													),
													{
														id: "point:corner-third",
														x: 24,
														y: 84,
														mode: "hard" as const,
													},
												],
											},
								),
							},
						},
			),
		}
		const result = parseDesignDocumentText(JSON.stringify(document))
		expect(result).toMatchObject({ ok: true })
		if (!result.ok) return
		const restored = result.value.objects[1]
		expect(
			restored?.geometry.kind === "path"
				? restored.geometry.contours[0]?.points[0]
				: undefined,
		).toMatchObject({
			mode: "hard",
			corner: { profile: "squircle", amount: 18 },
		})
	})

	it.each([
		["an explicitly soft node", "soft" as const],
		["a node inferred soft from its handles", undefined],
	])("rejects live-corner metadata on %s", (_, mode) => {
		const decoded = decodeDesignDocument(canonicalV1Fixture())
		if (!decoded.ok) throw new Error("Expected the fixture to migrate.")
		const path = decoded.value.objects[1]
		if (path?.geometry.kind !== "path")
			throw new Error("Expected an identified path fixture.")
		const document = {
			...decoded.value,
			objects: decoded.value.objects.map((object) =>
				object.id !== path.id || object.geometry.kind !== "path"
					? object
					: {
							...object,
							geometry: {
								...object.geometry,
								contours: object.geometry.contours.map((contour, index) =>
									index !== 0
										? contour
										: {
												...contour,
												closed: true,
												points: contour.points.map((point, pointIndex) =>
													pointIndex !== 0
														? point
														: {
																...point,
																...(mode === undefined ? {} : { mode }),
																corner: {
																	profile: "circular" as const,
																	amount: 12,
																},
															},
												),
											},
								),
							},
						},
			),
		}
		const result = validateDesignDocument(document)
		expect(result).toMatchObject({
			ok: false,
			errors: expect.arrayContaining([
				expect.objectContaining({
					code: "document.schema",
					path: "$.objects[1].geometry.contours[0].points[0].corner",
					message: "Corner profiles require a hard node.",
				}),
			]),
		})
	})

	it("migrates every shipped v1 field into the explicit v7 model", () => {
		const legacy = legacyFixture()
		const decoded = decodeDesignDocument(legacy)
		expect(decoded).toEqual({
			ok: true,
			value: {
				format: legacy.format,
				version: CREATE_DESIGN_DOCUMENT_VERSION,
				title: legacy.title,
				artboards: [
					{
						id: "artboard:page",
						name: "Artboard 1",
						x: 0,
						y: 0,
						...legacy.page,
					},
				],
				swatches: legacy.swatches,
				objects: [
					{
						id: "object:mark",
						name: "Campaign mark",
						geometry: {
							kind: "path",
							contours: legacy.objects[0]?.contours,
						},
						transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
						appearance: { fill: { swatchId: "swatch:coral" } },
						hidden: false,
						locked: true,
					},
				],
				layers: [
					{
						id: "layer:artwork",
						name: "Artwork",
						uiColor: "red",
						children: [{ kind: "object", id: "object:mark" }],
					},
				],
				groups: [],
				guides: migratedGuides(legacy.guides),
			},
		})
	})

	it("migrates the v5 scene and nested groups into one visible unlocked Artwork layer", () => {
		const current = decodeDesignDocument(canonicalV1Fixture())
		if (!current.ok) throw new Error("Expected the fixture to migrate.")
		const { layers: _layers, groups: _groups, ...common } = current.value
		const previous = {
			...common,
			guides: canonicalV1Fixture().guides,
			version: 5 as const,
			scene: [{ kind: "group" as const, id: "group:root" }],
			groups: [
				{
					id: "group:root",
					name: "Root",
					children: [
						{ kind: "object" as const, id: current.value.objects[0]!.id },
						{ kind: "group" as const, id: "group:nested" },
					],
				},
				{
					id: "group:nested",
					name: "Nested",
					children: [
						{ kind: "object" as const, id: current.value.objects[1]!.id },
					],
				},
			],
		}

		const decoded = decodeDesignDocument(previous)
		expect(decoded).toMatchObject({
			ok: true,
			value: {
				version: CREATE_DESIGN_DOCUMENT_VERSION,
				layers: [
					{
						id: "layer:artwork",
						name: "Artwork",
						uiColor: "red",
						children: previous.scene,
					},
				],
				groups: previous.groups,
			},
		})
		if (!decoded.ok) throw new Error("Expected the v5 fixture to migrate.")
		expect(decoded.value.objects).toEqual(previous.objects)
		expect(decoded.value.layers[0]).not.toHaveProperty("hidden")
		expect(decoded.value.layers[0]).not.toHaveProperty("locked")
	})

	it("migrates v6 documents while reserving linked artboards for v7", () => {
		const current = createInitialDocument()
		const previous = { ...current, version: 6 as const }
		expect(decodeDesignDocument(previous)).toEqual({
			ok: true,
			value: current,
		})
		expect(
			decodeDesignDocument({
				...previous,
				objects: previous.objects.map((object, index) =>
					index === 0
						? {
								...object,
								geometry: {
									kind: "artboard-link",
									projectId: "source",
									artboardId: "artboard:page",
									width: 100,
									height: 100,
								},
							}
						: object,
				),
			}),
		).toMatchObject({ ok: false })
	})

	it("migrates v7 axis guides and rejects coincident v8 guide points", () => {
		const current = createInitialDocument()
		const previous = {
			...current,
			version: 7 as const,
			guides: [
				{ id: "guide:vertical", axis: "x" as const, value: 42, locked: true },
			],
		}
		expect(decodeDesignDocument(previous)).toMatchObject({
			ok: true,
			value: {
				version: CREATE_DESIGN_DOCUMENT_VERSION,
				guides: [
					{
						id: "guide:vertical",
						a: { x: 42, y: 0 },
						b: { x: 42, y: 1 },
						locked: true,
					},
				],
			},
		})
		expect(
			validateDesignDocument({
				...current,
				guides: [
					{
						id: "guide:invalid",
						a: { x: 10, y: 10 },
						b: { x: 10, y: 10 },
					},
				],
			}),
		).toMatchObject({ ok: false })
	})

	it("preserves canonical v1 IDs, ordering, colors, geometry, appearance, transforms, flags, guides, and page properties", () => {
		const canonical = canonicalV1Fixture()
		expect(decodeDesignDocument(canonical)).toEqual({
			ok: true,
			value: {
				format: canonical.format,
				version: CREATE_DESIGN_DOCUMENT_VERSION,
				title: canonical.title,
				artboards: [
					{
						id: "artboard:page",
						name: "Artboard 1",
						x: 0,
						y: 0,
						...canonical.page,
					},
				],
				swatches: canonical.swatches,
				objects: canonical.objects.map((object) => ({
					...object,
					appearance: {
						...object.appearance,
						...(object.appearance.stroke === undefined
							? {}
							: {
									stroke: {
										...DEFAULT_DESIGN_STROKE_STYLE,
										...object.appearance.stroke,
									},
								}),
					},
				})),
				layers: [
					{
						id: "layer:artwork",
						name: "Artwork",
						uiColor: "red",
						children: canonical.objects.map(({ id }) => ({
							kind: "object",
							id,
						})),
					},
				],
				groups: [],
				guides: migratedGuides(canonical.guides),
			},
		})
	})

	it("deterministically assigns missing v2 path identities without rewriting authored IDs or geometry", () => {
		const canonical = canonicalV1Fixture()
		const path = canonical.objects[1]
		if (path?.geometry.kind !== "path")
			throw new Error("Expected a path fixture.")
		const previous = {
			...canonical,
			version: 2,
			objects: [
				{
					...path,
					geometry: {
						kind: "path" as const,
						contours: [
							{
								closed: false,
								points: [
									{ id: "point:authored", x: 1, y: 2 },
									{ x: 50, y: 60, incoming: { x: -7, y: 8 } },
								],
							},
						],
					},
				},
			],
		}
		const first = decodeDesignDocument(previous)
		const second = decodeDesignDocument(structuredClone(previous))
		expect(second).toEqual(first)
		expect(first).toMatchObject({
			ok: true,
			value: {
				version: CREATE_DESIGN_DOCUMENT_VERSION,
				artboards: [
					{
						id: "artboard:page",
						name: "Artboard 1",
						x: 0,
						y: 0,
						width: 841.89,
						height: 595.28,
					},
				],
				objects: [
					{
						id: path.id,
						geometry: {
							kind: "path",
							contours: [
								{
									id: `${path.id}:contour:0`,
									points: [
										{ id: "point:authored", x: 1, y: 2 },
										{
											id: `${path.id}:contour:0:point:1`,
											x: 50,
											y: 60,
										},
									],
								},
							],
						},
					},
				],
			},
		})
	})

	it("migrates v2 width-only strokes to explicit authored defaults", () => {
		const versionTwo = { ...canonicalV1Fixture(), version: 2 as const }
		const decoded = decodeDesignDocument(versionTwo)
		if (!decoded.ok) throw new Error("Expected the v2 fixture to migrate.")
		expect(decoded.value.version).toBe(CREATE_DESIGN_DOCUMENT_VERSION)
		expect(decoded.value.objects[0]?.appearance.stroke).toEqual({
			swatchId: "swatch:accent",
			width: 3.5,
			...DEFAULT_DESIGN_STROKE_STYLE,
		})
	})

	it("migrates v3 width-only strokes while preserving global page coordinates", () => {
		const current = decodeDesignDocument(canonicalV1Fixture())
		if (!current.ok) throw new Error("Expected the fixture to migrate.")
		const versionThree = {
			format: current.value.format,
			version: 3 as const,
			title: current.value.title,
			page: { x: -48, y: 96, width: 841.89, height: 595.28 },
			swatches: current.value.swatches,
			objects: current.value.objects.map((object) => ({
				...object,
				appearance: {
					...object.appearance,
					...(object.appearance.stroke === undefined
						? {}
						: {
								stroke: {
									swatchId: object.appearance.stroke.swatchId,
									width: object.appearance.stroke.width,
								},
							}),
				},
			})),
			guides: canonicalV1Fixture().guides,
		}
		const decoded = decodeDesignDocument(versionThree)
		if (!decoded.ok) throw new Error("Expected the v3 fixture to migrate.")
		expect(decoded.value).toMatchObject({
			version: CREATE_DESIGN_DOCUMENT_VERSION,
			artboards: [{ id: "artboard:page", ...versionThree.page }],
		})
		expect(decoded.value.objects[0]?.appearance.stroke).toEqual({
			swatchId: "swatch:accent",
			width: 3.5,
			...DEFAULT_DESIGN_STROKE_STYLE,
		})
	})

	it("deterministically migrates mixed shipped v1 object forms", () => {
		const canonical = canonicalV1Fixture()
		const legacy = legacyFixture()
		const decoded = decodeDesignDocument({
			...canonical,
			objects: [
				canonical.objects[1],
				{ ...legacy.objects[0], fillId: "swatch:brand" },
			],
		})
		expect(decoded).toMatchObject({
			ok: true,
			value: {
				version: CREATE_DESIGN_DOCUMENT_VERSION,
				objects: [
					{
						...canonical.objects[1],
						appearance: {
							stroke: {
								...DEFAULT_DESIGN_STROKE_STYLE,
								...canonical.objects[1]?.appearance.stroke,
							},
						},
					},
					{
						id: "object:mark",
						geometry: { kind: "path", contours: legacy.objects[0]?.contours },
						transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
						appearance: { fill: { swatchId: "swatch:brand" } },
					},
				],
			},
		})
	})

	it("is deterministic and round-trips current JSON without changing facts", () => {
		const versionOne = canonicalV1Fixture()
		const first = decodeDesignDocument(versionOne)
		const second = decodeDesignDocument(structuredClone(versionOne))
		expect(second).toEqual(first)
		if (!first.ok) throw new Error("Expected migration to succeed.")
		expect(parseDesignDocumentText(JSON.stringify(first.value))).toEqual(first)
		expect(validateDesignDocument(first.value)).toEqual(first)
	})

	it("round-trips ordered named artboards and optional production metadata", () => {
		const migrated = decodeDesignDocument(canonicalV1Fixture())
		if (!migrated.ok) throw new Error("Expected migration to succeed.")
		const document = {
			...migrated.value,
			artboards: [
				{
					id: "artboard:cover",
					name: "Cover",
					x: -40,
					y: 20,
					width: 612,
					height: 792,
					bleed: { top: 9, right: 12, bottom: 9, left: 12 },
					safeArea: { top: 36, right: 36, bottom: 42, left: 36 },
				},
				{
					id: "artboard:back",
					name: "Back",
					x: 700,
					y: -120,
					width: 612,
					height: 792,
				},
			],
		}
		expect(parseDesignDocumentText(JSON.stringify(document))).toEqual({
			ok: true,
			value: document,
		})
		const duplicate = validateDesignDocument({
			...document,
			artboards: [
				document.artboards[0],
				{ ...document.artboards[1], id: "artboard:cover" },
			],
		})
		expect(duplicate).toMatchObject({
			ok: false,
			errors: [
				expect.objectContaining({
					code: "directory.duplicate_id",
					path: "$.artboards[1].id",
				}),
			],
		})
	})

	it("round-trips explicit path fill rules and rejects unknown rules", () => {
		const migrated = decodeDesignDocument(canonicalV1Fixture())
		if (!migrated.ok) throw new Error("Expected migration to succeed.")
		const path = migrated.value.objects[1]
		if (path?.geometry.kind !== "path")
			throw new Error("Expected path fixture.")
		const document = {
			...migrated.value,
			objects: [
				migrated.value.objects[0]!,
				{
					...path,
					geometry: { ...path.geometry, fillRule: "nonzero" as const },
				},
			],
		}
		expect(parseDesignDocumentText(JSON.stringify(document))).toEqual({
			ok: true,
			value: document,
		})
		expect(
			validateDesignDocument({
				...document,
				objects: [
					document.objects[0],
					{
						...path,
						geometry: { ...path.geometry, fillRule: "winding" },
					},
				],
			}),
		).toMatchObject({
			ok: false,
			errors: expect.arrayContaining([
				expect.objectContaining({
					code: "document.schema",
					path: "$.objects[1].geometry.fillRule",
				}),
			]),
		})
	})

	it("accepts an open path as canonical complete-document source without rewriting it", () => {
		const initial = createInitialDocument()
		const open = {
			...initial.objects[0]!,
			id: "object:open",
			geometry: {
				kind: "path" as const,
				contours: [
					{
						id: "contour:open",
						closed: false,
						points: [
							{
								id: "point:open:0",
								x: 10,
								y: 20,
								incoming: { x: -4, y: -5 },
							},
							{
								id: "point:open:1",
								x: 40,
								y: 50,
								outgoing: { x: 6, y: 7 },
							},
						],
					},
				],
			},
		}
		const document = {
			...initial,
			objects: [open],
			layers: initial.layers.map((layer) => ({
				...layer,
				children: [{ kind: "object" as const, id: open.id }],
			})),
		}
		expect(parseDesignDocumentText(JSON.stringify(document))).toEqual({
			ok: true,
			value: document,
		})
	})

	it("rejects fill rules authored before the v5 contract", () => {
		const canonical = canonicalV1Fixture()
		const current = decodeDesignDocument(canonical)
		if (!current.ok) throw new Error("Expected migration to succeed.")
		const addFillRule = <Object extends { geometry: { kind: string } }>(
			object: Object,
		) =>
			object.geometry.kind === "path"
				? {
						...object,
						geometry: { ...object.geometry, fillRule: "nonzero" },
					}
				: object
		const versionThreeObjects = current.value.objects.map((object) => ({
			...addFillRule(object),
			appearance: {
				...object.appearance,
				...(object.appearance.stroke === undefined
					? {}
					: {
							stroke: {
								swatchId: object.appearance.stroke.swatchId,
								width: object.appearance.stroke.width,
							},
						}),
			},
		}))
		const historical = [
			{
				...canonical,
				version: 2,
				objects: canonical.objects.map(addFillRule),
			},
			{
				format: current.value.format,
				version: 3,
				title: current.value.title,
				page: { x: 0, y: 0, width: 841.89, height: 595.28 },
				swatches: current.value.swatches,
				objects: versionThreeObjects,
				guides: current.value.guides,
			},
			{
				format: current.value.format,
				version: 4,
				title: current.value.title,
				page: { x: 0, y: 0, width: 841.89, height: 595.28 },
				swatches: current.value.swatches,
				objects: current.value.objects.map(addFillRule),
				guides: current.value.guides,
			},
		]
		for (const document of historical) {
			expect(decodeDesignDocument(document)).toMatchObject({
				ok: false,
				errors: expect.arrayContaining([
					expect.objectContaining({ code: "document.schema" }),
				]),
			})
		}
	})

	it.each([
		[
			"malformed page",
			(document: ReturnType<typeof legacyFixture>) => ({
				...document,
				page: { ...document.page, width: 0 },
			}),
			"$.page.width",
		],
		[
			"malformed color",
			(document: ReturnType<typeof legacyFixture>) => ({
				...document,
				swatches: [
					{ ...document.swatches[0], source: { space: "rgb", r: 999 } },
				],
			}),
			"$.swatches[0].source.r",
		],
		[
			"malformed point handle",
			(document: ReturnType<typeof legacyFixture>) => ({
				...document,
				objects: [
					{
						...document.objects[0],
						contours: [
							{
								closed: true,
								points: [{ x: 1, y: 2, incoming: { x: "bad", y: 0 } }],
							},
						],
					},
				],
			}),
			"$.objects[0].contours[0].points[0].incoming.x",
		],
	] as const)("rejects %s with a located diagnostic", (_, mutate, path) => {
		const result = decodeDesignDocument(mutate(legacyFixture()))
		expect(result).toMatchObject({
			ok: false,
			errors: expect.arrayContaining([
				expect.objectContaining({ code: "document.schema", path }),
			]),
		})
	})

	it.each([
		[
			"non-string titles",
			(document: ReturnType<typeof canonicalV1Fixture>) => ({
				...document,
				title: 42,
			}),
			"$.title",
		],
		[
			"non-finite alternate colors",
			(document: ReturnType<typeof canonicalV1Fixture>) => ({
				...document,
				swatches: [
					{
						...document.swatches[0],
						alternate: { space: "cmyk", c: 0, m: 0, y: 0, k: Infinity },
					},
					...document.swatches.slice(1),
				],
			}),
			"$.swatches[0].alternate.k",
		],
		[
			"invalid stable object IDs",
			(document: ReturnType<typeof canonicalV1Fixture>) => ({
				...document,
				objects: [
					{ ...document.objects[0], id: "not-an-object-id" },
					...document.objects.slice(1),
				],
			}),
			"$.objects[0].id",
		],
		[
			"non-finite geometry",
			(document: ReturnType<typeof canonicalV1Fixture>) => ({
				...document,
				objects: [
					{
						...document.objects[0],
						geometry: { ...document.objects[0].geometry, width: NaN },
					},
					...document.objects.slice(1),
				],
			}),
			"$.objects[0].geometry.width",
		],
		[
			"malformed transforms",
			(document: ReturnType<typeof canonicalV1Fixture>) => ({
				...document,
				objects: [
					{
						...document.objects[0],
						transform: { ...document.objects[0].transform, e: "43" },
					},
					...document.objects.slice(1),
				],
			}),
			"$.objects[0].transform.e",
		],
		[
			"negative stroke widths",
			(document: ReturnType<typeof canonicalV1Fixture>) => ({
				...document,
				objects: [
					{
						...document.objects[0],
						appearance: {
							...document.objects[0].appearance,
							stroke: { swatchId: "swatch:accent", width: -1 },
						},
					},
					...document.objects.slice(1),
				],
			}),
			"$.objects[0].appearance.stroke.width",
		],
		[
			"non-boolean visibility",
			(document: ReturnType<typeof canonicalV1Fixture>) => ({
				...document,
				objects: [
					{ ...document.objects[0], hidden: "false" },
					...document.objects.slice(1),
				],
			}),
			"$.objects[0].hidden",
		],
		[
			"invalid guide axes",
			(document: ReturnType<typeof canonicalV1Fixture>) => ({
				...document,
				guides: [{ ...document.guides[0], axis: "z" }],
			}),
			"$.guides[0].axis",
		],
		[
			"unknown persisted fields",
			(document: ReturnType<typeof canonicalV1Fixture>) => ({
				...document,
				unexpected: true,
			}),
			"$",
		],
	] as const)(
		"rejects %s in canonical v1 with a located diagnostic",
		(_, mutate, path) => {
			const result = decodeDesignDocument(mutate(canonicalV1Fixture()))
			expect(result).toMatchObject({
				ok: false,
				errors: expect.arrayContaining([
					expect.objectContaining({ code: "document.schema", path }),
				]),
			})
		},
	)

	it("rejects hybrid partial v1 and legacy-shaped v2 objects", () => {
		const legacy = legacyFixture()
		const partialObject = {
			id: "object:partial",
			name: "Missing transform",
			geometry: { kind: "path", contours: legacy.objects[0]?.contours },
			appearance: { fill: { swatchId: "swatch:coral" } },
		}
		expect(
			decodeDesignDocument({ ...legacy, objects: [partialObject] }),
		).toMatchObject({
			ok: false,
			errors: expect.arrayContaining([
				expect.objectContaining({
					code: "document.schema",
					path: "$.objects[0].transform",
				}),
			]),
		})
		expect(
			decodeDesignDocument({ ...legacy, version: 2, objects: legacy.objects }),
		).toMatchObject({ ok: false })
	})

	it("rejects ambiguous persisted contour and point identities", () => {
		const decoded = decodeDesignDocument(canonicalV1Fixture())
		if (!decoded.ok) throw new Error("Expected the fixture to migrate.")
		const current = decoded.value
		const path = current.objects[1]
		if (path?.geometry.kind !== "path")
			throw new Error("Expected an identified path fixture.")
		const contour = path.geometry.contours[0]
		if (contour === undefined)
			throw new Error("Expected an identified contour fixture.")
		const [firstPoint, secondPoint] = contour.points
		if (firstPoint === undefined || secondPoint === undefined)
			throw new Error("Expected identified point fixtures.")
		const duplicate = {
			...current,
			version: CREATE_DESIGN_DOCUMENT_VERSION,
			objects: [
				path,
				{
					...path,
					id: "object:duplicate-identities",
					geometry: {
						kind: "path" as const,
						contours: [
							contour,
							{
								...contour,
								points: [
									firstPoint,
									{ ...secondPoint, id: "point:identified-a" },
								],
							},
						],
					},
				},
			],
		}
		const result = validateDesignDocument(duplicate)
		expect(result).toMatchObject({
			ok: false,
			errors: expect.arrayContaining([
				expect.objectContaining({
					code: "directory.duplicate_id",
					path: "$.objects[1].geometry.contours[1].id",
				}),
				expect.objectContaining({
					code: "directory.duplicate_id",
					path: "$.objects[1].geometry.contours[1].points[1].id",
				}),
			]),
		})
	})

	it("requires contour and point identities in current v5 documents", () => {
		const decoded = decodeDesignDocument(canonicalV1Fixture())
		if (!decoded.ok) throw new Error("Expected fixture migration to succeed.")
		const path = decoded.value.objects[1]
		if (path?.geometry.kind !== "path")
			throw new Error("Expected a current path fixture.")
		const withoutContourId = {
			...decoded.value,
			objects: [
				decoded.value.objects[0],
				{
					...path,
					geometry: {
						...path.geometry,
						contours: path.geometry.contours.map(({ id: _id, ...contour }) => ({
							...contour,
							points: contour.points.map(({ id: _pointId, ...point }) => point),
						})),
					},
				},
			],
		}
		expect(validateDesignDocument(withoutContourId)).toMatchObject({
			ok: false,
			errors: expect.arrayContaining([
				expect.objectContaining({
					code: "document.schema",
					path: "$.objects[1].geometry.contours[0].id",
				}),
				expect.objectContaining({
					code: "document.schema",
					path: "$.objects[1].geometry.contours[0].points[0].id",
				}),
			]),
		})
	})

	it("rejects current dash patterns with no painted length", () => {
		const decoded = decodeDesignDocument(canonicalV1Fixture())
		if (!decoded.ok) throw new Error("Expected the fixture to migrate.")
		const object = decoded.value.objects[0]!
		const stroke = object.appearance.stroke
		if (stroke === undefined) throw new Error("Expected a stroke fixture.")
		const result = validateDesignDocument({
			...decoded.value,
			objects: [
				{
					...object,
					appearance: {
						...object.appearance,
						stroke: { ...stroke, dashArray: [0, 0] },
					},
				},
			],
		})
		expect(result).toMatchObject({
			ok: false,
			errors: [
				expect.objectContaining({
					code: "document.schema",
					path: "$.objects[0].appearance.stroke.dashArray",
				}),
			],
		})
	})

	it("distinguishes future versions, bad envelopes, and invalid JSON", () => {
		expect(
			decodeDesignDocument({ ...legacyFixture(), version: 99 }),
		).toMatchObject({
			ok: false,
			errors: [
				expect.objectContaining({
					code: "document.future_version",
					path: "$.version",
				}),
			],
		})
		expect(
			decodeDesignDocument({ ...legacyFixture(), version: "2" }),
		).toMatchObject({
			ok: false,
			errors: [expect.objectContaining({ code: "document.version" })],
		})
		expect(parseDesignDocumentText("{")).toMatchObject({
			ok: false,
			errors: [expect.objectContaining({ code: "json.syntax", path: "$" })],
		})
	})
})
