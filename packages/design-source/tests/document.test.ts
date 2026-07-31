import { describe, expect, it } from "vitest"

import {
	CREATE_DESIGN_DOCUMENT_VERSION,
	decodeDesignDocument,
	parseDesignDocumentText,
	validateDesignDocument,
} from "../src/document.ts"

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
	it("migrates every shipped v1 field into the explicit v3 model", () => {
		const legacy = legacyFixture()
		const decoded = decodeDesignDocument(legacy)
		expect(decoded).toEqual({
			ok: true,
			value: {
				format: legacy.format,
				version: CREATE_DESIGN_DOCUMENT_VERSION,
				title: legacy.title,
				page: { x: 0, y: 0, ...legacy.page },
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
				guides: legacy.guides,
			},
		})
	})

	it("preserves canonical v1 IDs, ordering, colors, geometry, appearance, transforms, flags, guides, and page properties", () => {
		const canonical = canonicalV1Fixture()
		expect(decodeDesignDocument(canonical)).toEqual({
			ok: true,
			value: {
				...canonical,
				version: CREATE_DESIGN_DOCUMENT_VERSION,
				page: { x: 0, y: 0, ...canonical.page },
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
				version: 3,
				page: { x: 0, y: 0, width: 841.89, height: 595.28 },
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
					canonical.objects[1],
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
		const current = canonicalV1Fixture()
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
			page: { x: 0, y: 0, ...current.page },
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

	it("requires contour and point identities in current v3 documents", () => {
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
						contours: path.geometry.contours.map(
							({ id: _id, ...contour }) => ({
								...contour,
								points: contour.points.map(
									({ id: _pointId, ...point }) => point,
								),
							}),
						),
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
