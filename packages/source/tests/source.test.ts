import { describe, expect, expectTypeOf, test } from "vitest"

import { createFontEditorState } from "../../states/src/state.ts"
import type { EditorFontSource } from "../../states/src/types.ts"
import { makeGeometricOEditorFont } from "../../states/tests/fixtures/geometric-o.ts"
import {
	assembleEditorFontSource as assembleBrowserEditorFontSource,
	splitEditorFontSource as splitBrowserEditorFontSource,
} from "../src/browser.ts"
import {
	assembleEditorFontSource,
	canonicalizeEditorFontSource,
	defaultGlyphUnitPath,
	decodeEditorFontSource,
	encodeEditorFontSource,
	fromEditorFontFile,
	jsonSchemaForSourceUnit,
	sourceUnitDescriptors,
	splitEditorFontSource,
	toEditorFontFile,
	validateEditorFontSource,
	validateSourceUnit,
	type EditorFontFile,
	type FontSourceDirectoryFiles,
	type SourceUnitKind,
} from "../src/index.ts"

type DeepMutable<Value> = Value extends readonly (infer Item)[]
	? DeepMutable<Item>[]
	: Value extends object
		? { -readonly [Key in keyof Value]: DeepMutable<Value[Key]> }
		: Value

let stateNamespace = 0

function mutableFile(file: EditorFontFile): DeepMutable<EditorFontFile> {
	return JSON.parse(JSON.stringify(file)) as DeepMutable<EditorFontFile>
}

function legacySharedTopologyGlyph(
	glyph: EditorFontSource["glyphs"][number],
	defaultMasterId: string,
) {
	const defaultLayer = glyph.layers.find(
		(layer) => layer.masterId === defaultMasterId,
	)
	if (defaultLayer === undefined)
		throw new Error("Default glyph layer is missing.")
	return {
		...glyph,
		contours: defaultLayer.contours.map((contour) => ({
			id: contour.id,
			closed: contour.closed,
			points: contour.points.map(({ id, mode }) => ({ id, mode })),
		})),
		layers: glyph.layers.map((layer) => ({
			masterId: layer.masterId,
			advanceWidth: layer.advanceWidth,
			leftSideBearing: layer.leftSideBearing,
			points: layer.contours.flatMap((contour) =>
				contour.points.map(({ id: pointId, mode: _mode, ...geometry }) => ({
					pointId,
					...geometry,
				})),
			),
		})),
	}
}

function geometricOWithEveryEditorField(): EditorFontSource {
	const source = makeGeometricOEditorFont()
	return {
		...source,
		metadata: {
			...source.metadata,
			createdAt: -1n,
			modifiedAt: 18_446_744_073_709_551_615n,
		},
		axes: source.axes.map((axis) => ({
			...axis,
			hidden: true,
			map: [
				{ from: -1, to: -1 },
				{ from: 0, to: 0 },
				{ from: 1, to: 1 },
			],
		})),
		glyphs: source.glyphs.map((glyph, glyphIndex) => ({
			...glyph,
			note: glyphIndex === 0 ? "Required fallback glyph" : "Geometric O",
			color: glyphIndex === 0 ? "#777" : "oklch(55% 0.22 25)",
			overlap: true,
		})),
	}
}

function expectFailure(
	result: ReturnType<typeof decodeEditorFontSource>,
	code: string,
	path?: string,
): void {
	expect(result.ok).toBe(false)
	if (result.ok) return
	expect(result.errors.some((error) => error.code === code)).toBe(true)
	if (path !== undefined) {
		expect(result.errors.some((error) => error.path === path)).toBe(true)
	}
}

describe("@create-font/source", () => {
	test("splits the state graph into loadable-aligned directory units", () => {
		const source = geometricOWithEveryEditorField()
		const split = splitEditorFontSource(source)
		expect(split.ok).toBe(true)
		if (!split.ok) return

		expect(Object.keys(split.value).sort()).toEqual([
			"axes/axis%3Awght~8b338244.json",
			"axes/index.json",
			"cmap/004F.json",
			"cmap/index.json",
			"create-font.json",
			"glyphs/glyph%3A.notdef~b88a7b05.json",
			"glyphs/glyph%3AO~e48dd026.json",
			"glyphs/index.json",
			"instances/index.json",
			"instances/instance%3Ablack~9b4bfa3b.json",
			"instances/instance%3Arazor~e8094f74.json",
			"masters/index.json",
			"masters/master%3Ablack~e935e1c2.json",
			"masters/master%3Arazor~f06b8821.json",
			"metadata.json",
			"metrics.json",
			"names.json",
			"style.json",
		])
		expect(split.value["glyphs/index.json"]).toEqual([
			{
				id: "glyph:.notdef",
				path: "glyphs/glyph%3A.notdef~b88a7b05.json",
			},
			{ id: "glyph:O", path: "glyphs/glyph%3AO~e48dd026.json" },
		])
		expect(split.value["create-font.json"]).toEqual({
			format: "create-font.source",
			sourceVersion: 1,
			editorFormat: "create-font.editor",
			editorVersion: 5,
		})
		expect(split.value["glyphs/glyph%3AO~e48dd026.json"]).toEqual(
			source.glyphs[1],
		)
		expect(split.value["metadata.json"]).toEqual({
			...source.metadata,
			createdAt: "-1",
			modifiedAt: "18446744073709551615",
		})
		expect(split.value["axes/index.json"]).toEqual([
			{ id: "axis:wght", path: "axes/axis%3Awght~8b338244.json" },
		])
		expect(split.value["masters/index.json"]).toEqual({
			defaultMasterId: "master:razor",
			entries: [
				{
					id: "master:razor",
					path: "masters/master%3Arazor~f06b8821.json",
				},
				{
					id: "master:black",
					path: "masters/master%3Ablack~e935e1c2.json",
				},
			],
		})
		expect(split.value["cmap/index.json"]).toEqual([
			{ codePoint: 0x4f, path: "cmap/004F.json" },
		])
		expect(Object.isFrozen(split.value)).toBe(true)
		expect(Object.isFrozen(split.value["glyphs/glyph%3AO~e48dd026.json"])).toBe(
			true,
		)
	})

	test("assembles directory units into the exact state snapshot", () => {
		const source = geometricOWithEveryEditorField()
		const split = splitEditorFontSource(source, {
			axisPath: () => "axes/weight.json",
			masterPath: (_master, index) => `masters/unit-${index}.json`,
			instancePath: (_instance, index) => `instances/unit-${index}.json`,
			glyphPath: (_glyph, index) =>
				index === 0 ? "glyphs/fallback.json" : "glyphs/latin/capital-o.json",
			cmapPath: () => "cmap/latin-capital-o.json",
		})
		if (!split.ok) throw new Error("fixture did not split")

		const assembled = assembleEditorFontSource(split.value)
		expect(assembled.ok).toBe(true)
		if (!assembled.ok) return
		expect(assembled.value).toEqual(source)
		expect(assembled.value.glyphs.map(({ id }) => id)).toEqual([
			"glyph:.notdef",
			"glyph:O",
		])
	})

	test("keeps the browser codec in parity without schema dependencies", () => {
		const source = geometricOWithEveryEditorField()
		const split = splitBrowserEditorFontSource(source)
		expect(split.ok).toBe(true)
		if (!split.ok) return

		const assembled = assembleBrowserEditorFontSource(split.value)
		expect(assembled.ok).toBe(true)
		if (!assembled.ok) return
		expect(assembled.value).toEqual(source)
	})

	test("keeps glyph identity independent from its indexed file path", () => {
		const source = makeGeometricOEditorFont()
		const split = splitEditorFontSource(source, {
			glyphPath: (_glyph, index) => `glyphs/unit-${index}.json`,
		})
		if (!split.ok) throw new Error("fixture did not split")
		const files = {
			...split.value,
			"glyphs/index.json": [
				{ id: "glyph:.notdef", path: "glyphs/unit-0.json" },
				{ id: "glyph:O", path: "glyphs/unit-1.json" },
			],
		} satisfies FontSourceDirectoryFiles
		const assembled = assembleEditorFontSource(files)
		expect(assembled.ok).toBe(true)

		const mismatched = {
			...files,
			"glyphs/index.json": [
				{ id: "glyph:wrong", path: "glyphs/unit-0.json" },
				{ id: "glyph:O", path: "glyphs/unit-1.json" },
			],
		}
		const result = assembleEditorFontSource(mismatched)
		expect(result.ok).toBe(false)
		if (!result.ok) {
			expect(result.errors[0]).toEqual(
				expect.objectContaining({
					code: "directory.entity_id",
					unitPath: "glyphs/unit-0.json",
					path: "$.id",
				}),
			)
		}
	})

	test("publishes one Zod validator and JSON Schema per source unit kind", () => {
		const kinds: readonly SourceUnitKind[] = [
			"project",
			"metadata",
			"names",
			"metrics",
			"style",
			"axis-index",
			"axis",
			"master-index",
			"master",
			"instance-index",
			"instance",
			"glyph-index",
			"glyph",
			"cmap-index",
			"cmap-entry",
		]
		for (const kind of kinds) {
			const schema = jsonSchemaForSourceUnit(kind) as {
				readonly $schema?: string
				readonly title?: string
			}
			expect(schema.$schema).toBe(
				"https://json-schema.org/draft/2020-12/schema",
			)
			expect(schema.title).toMatch(/^create-font /u)
		}

		expect(sourceUnitDescriptors.glyph).toMatchObject({
			cardinality: "collection",
			directory: "glyphs",
			inventoryPath: "glyphs/index.json",
		})
		expect(sourceUnitDescriptors.axis).toMatchObject({
			cardinality: "collection",
			inventoryPath: "axes/index.json",
		})
		expect(
			validateSourceUnit("glyph-index", [
				{ id: "glyph:O", path: "glyphs/latin/o.json" },
			]).ok,
		).toBe(true)
		const invalidIndex = validateSourceUnit(
			"glyph-index",
			[{ id: "glyph:O", path: "../outside.json" }],
			"glyphs/index.json",
		)
		expect(invalidIndex.ok).toBe(false)
		if (!invalidIndex.ok) {
			expect(invalidIndex.errors).toContainEqual(
				expect.objectContaining({
					code: "source.schema",
					unitPath: "glyphs/index.json",
					path: "$[0].path",
				}),
			)
		}
		for (const path of [
			"glyphs/../outside.json",
			"glyphs/./inside.json",
			"glyphs/%2E%2E/outside.json",
			"glyphs/%252e%252e/outside.json",
			"glyphs/folder%2Foutside.json",
			"glyphs/folder%5Coutside.json",
		]) {
			expect(
				validateSourceUnit(
					"glyph-index",
					[{ id: "glyph:O", path }],
					"glyphs/index.json",
				).ok,
				path,
			).toBe(false)
		}
	})

	test("validates versioned overshoot depths in the metrics unit", () => {
		const metrics = makeGeometricOEditorFont().metrics
		expect(validateSourceUnit("metrics", metrics, "metrics.json").ok).toBe(true)
		const invalid = validateSourceUnit(
			"metrics",
			{
				...metrics,
				overshoots: { ...metrics.overshoots, xHeight: -1 },
			},
			"metrics.json",
		)
		expect(invalid.ok).toBe(false)
		if (!invalid.ok) {
			expect(invalid.errors[0]).toMatchObject({
				code: "source.schema",
				unitPath: "metrics.json",
				path: "$.overshoots.xHeight",
			})
		}
	})

	test("diagnoses missing, duplicate, and unindexed source units", () => {
		const split = splitEditorFontSource(makeGeometricOEditorFont())
		if (!split.ok) throw new Error("fixture did not split")
		const { "metadata.json": _missing, ...withoutMetadata } = split.value
		const missing = assembleEditorFontSource(withoutMetadata)
		expect(missing.ok).toBe(false)
		if (!missing.ok) {
			expect(missing.errors[0]).toEqual(
				expect.objectContaining({
					code: "directory.missing_file",
					unitPath: "metadata.json",
				}),
			)
		}

		const duplicateIndex = {
			...split.value,
			"glyphs/index.json": [
				{ id: "glyph:O", path: "glyphs/glyph%3AO~e48dd026.json" },
				{ id: "glyph:O", path: "glyphs/other.json" },
			],
			"glyphs/other.json": split.value["glyphs/glyph%3AO~e48dd026.json"],
		}
		const duplicate = assembleEditorFontSource(duplicateIndex)
		expect(duplicate.ok).toBe(false)
		if (!duplicate.ok) {
			expect(duplicate.errors[0]?.code).toBe("directory.duplicate_id")
		}

		const unknown = assembleEditorFontSource({
			...split.value,
			"glyphs/orphan.json": split.value["glyphs/glyph%3AO~e48dd026.json"],
		})
		expect(unknown.ok).toBe(false)
		if (!unknown.ok) {
			expect(unknown.errors[0]).toEqual(
				expect.objectContaining({
					code: "directory.unknown_file",
					unitPath: "glyphs/orphan.json",
				}),
			)
		}
	})

	test("provides a portable default path without making it an identity", () => {
		expect(defaultGlyphUnitPath("glyph:A/B !")).toBe(
			"glyphs/glyph%3AA%2FB%20%21~fe8d89be.json",
		)
	})

	test("round-trips every state field and bigint timestamp losslessly", () => {
		const source = geometricOWithEveryEditorField()
		const encoded = encodeEditorFontSource(source)
		expect(encoded.ok).toBe(true)
		if (!encoded.ok) return

		const decoded = decodeEditorFontSource(encoded.value)
		expect(decoded.ok).toBe(true)
		if (!decoded.ok) return
		expect(decoded.value).toEqual(source)
		expect(decoded.value.glyphs.map((glyph) => glyph.id)).toEqual([
			"glyph:.notdef",
			"glyph:O",
		])
		expect(decoded.value.glyphs[1]?.note).toBe("Geometric O")
		expect(
			decoded.value.glyphs[1]?.layers[0]?.contours[0]?.points[0]?.mode,
		).toBe("soft")
		expect(decoded.value.glyphs[1]?.layers[0]?.contours[0]?.closed).toBe(true)
		expect(
			decoded.value.glyphs[1]?.layers[0]?.contours[0]?.points[0]?.incoming,
		).toEqual({
			x: -266.6666666666667,
			y: 0,
		})
		expect(decoded.value.metadata.createdAt).toBe(-1n)
		expect(decoded.value.metadata.modifiedAt).toBe(18_446_744_073_709_551_615n)
	})

	test("round-trips open contours as valid work-in-progress source", () => {
		const source = makeGeometricOEditorFont()
		const open: EditorFontSource = {
			...source,
			glyphs: source.glyphs.map((glyph) => ({
				...glyph,
				layers: glyph.layers.map((layer) => ({
					...layer,
					contours: layer.contours.map((contour, index) =>
						glyph.id === "glyph:O" && index === 0
							? { ...contour, closed: false }
							: contour,
					),
				})),
			})),
		}
		const encoded = encodeEditorFontSource(open)
		expect(encoded.ok).toBe(true)
		if (!encoded.ok) return
		const decoded = decodeEditorFontSource(encoded.value)
		expect(decoded.ok).toBe(true)
		if (!decoded.ok) return
		expect(decoded.value.glyphs[1]?.layers[0]?.contours[0]?.closed).toBe(false)
	})

	test("uses the EditorFontSource document as the file root", () => {
		const file = toEditorFontFile(geometricOWithEveryEditorField())
		expect(file.ok).toBe(true)
		if (!file.ok) return
		expect(file.value.format).toBe("create-font.editor")
		expect(file.value.editorVersion).toBe(5)
		expect(file.value).not.toHaveProperty("document")
		expect(file.value).not.toHaveProperty("sourceVersion")
		expect(file.value.metadata.createdAt).toBe("-1")
		expect(file.value.metadata.modifiedAt).toBe("18446744073709551615")
		expectTypeOf(file.value).toEqualTypeOf<EditorFontFile>()
	})

	test("loads a decoded geometric O into the real atom.io state graph", () => {
		const encoded = encodeEditorFontSource(makeGeometricOEditorFont())
		if (!encoded.ok) throw new Error("fixture did not encode")
		const decoded = decodeEditorFontSource(encoded.value)
		if (!decoded.ok) throw new Error("fixture did not decode")

		const editor = createFontEditorState({
			key: `source-test/${(stateNamespace += 1)}`,
			isProduction: true,
		})
		expect(() => editor.actions.load(decoded.value)).not.toThrow()
		expect(editor.read.editorSource()).toEqual(makeGeometricOEditorFont())
		expect(editor.read.compilation().stage).toBe("compiled")
	})

	test("emits one canonical representation independent of input key order", () => {
		const source = geometricOWithEveryEditorField()
		const file = toEditorFontFile(source)
		if (!file.ok) throw new Error("fixture did not convert")
		const nonCanonical = JSON.stringify(file.value, null, 4)
		const canonicalized = canonicalizeEditorFontSource(nonCanonical)
		const encoded = encodeEditorFontSource(source)
		expect(canonicalized).toEqual(encoded)
		if (!encoded.ok) return
		expect(encoded.value.endsWith("\n")).toBe(true)
		expect(encoded.value.startsWith('{"axes":')).toBe(true)
		expect(encoded.value).not.toContain("\n\t")
		expect(encodeEditorFontSource(source)).toEqual(encoded)
	})

	test("normalizes exactly as the atom.io state snapshot", () => {
		const source = makeGeometricOEditorFont()
		const explicitDefaults: EditorFontSource = {
			...source,
			axes: source.axes.map((axis) => ({
				...axis,
				hidden: false,
				map: [],
			})),
			instances: source.instances.map((instance) => ({
				...instance,
				elidable: false,
			})),
			glyphs: source.glyphs.map((glyph) => ({
				...glyph,
				note: "",
				color: "",
				overlap: false,
				layers: glyph.layers.map((layer) => ({
					...layer,
					contours: [...layer.contours].reverse(),
				})),
			})),
		}
		const beforeState = encodeEditorFontSource(explicitDefaults)
		if (!beforeState.ok) throw new Error("defaults did not encode")

		const editor = createFontEditorState({
			key: `source-normalization/${(stateNamespace += 1)}`,
			isProduction: true,
		})
		editor.actions.load(explicitDefaults)
		const stateSource = editor.read.editorSource()
		if (stateSource === null) throw new Error("state did not produce a source")
		const afterState = encodeEditorFontSource(stateSource)
		expect(afterState).toEqual(beforeState)

		const decoded = decodeEditorFontSource(beforeState.value)
		if (!decoded.ok) throw new Error("normalized source did not decode")
		expect(decoded.value.axes[0]).not.toHaveProperty("hidden")
		expect(decoded.value.axes[0]?.map).toEqual([])
		expect(decoded.value.instances[0]).not.toHaveProperty("elidable")
		expect(decoded.value.glyphs[0]).not.toHaveProperty("note")
		expect(decoded.value.glyphs[0]).not.toHaveProperty("overlap")
		expect(decoded.value.glyphs[0]?.color).toBe("")
		expect(
			decoded.value.glyphs[0]?.layers[0]?.contours[0]?.points[0]?.mode,
		).toBe("soft")
		expect(
			decoded.value.glyphs[0]?.layers[0]?.contours.map((contour) => contour.id),
		).toEqual(
			explicitDefaults.glyphs[0]!.layers[0]!.contours.map(
				(contour) => contour.id,
			),
		)
	})

	test("round-trips intermediate master supports", () => {
		const source = makeGeometricOEditorFont()
		const intermediate: EditorFontSource = {
			...source,
			masters: source.masters.map((master) =>
				master.kind === "source"
					? {
							...master,
							support: {
								kind: "intermediate",
								start: { "axis:wght": 100 },
								end: { "axis:wght": 900 },
							},
						}
					: master,
			),
		}
		const encoded = encodeEditorFontSource(intermediate)
		if (!encoded.ok) throw new Error("intermediate source did not encode")
		const decoded = decodeEditorFontSource(encoded.value)
		expect(decoded.ok).toBe(true)
		if (!decoded.ok) return
		expect(decoded.value).toEqual(intermediate)
	})

	test("preserves negative zero under canonical number encoding", () => {
		const source = makeGeometricOEditorFont()
		const glyph = source.glyphs[1]
		if (glyph === undefined) throw new Error("missing O")
		const layer = glyph.layers[0]
		if (layer === undefined) throw new Error("missing layer")
		const point = layer.contours[0]?.points[0]
		if (point === undefined) throw new Error("missing point")
		const modified: EditorFontSource = {
			...source,
			glyphs: source.glyphs.map((candidate) =>
				candidate.id === glyph.id
					? {
							...candidate,
							layers: candidate.layers.map((candidateLayer) =>
								candidateLayer.masterId === layer.masterId
									? {
											...candidateLayer,
											contours: candidateLayer.contours.map((contour) => ({
												...contour,
												points: contour.points.map((candidatePoint) =>
													candidatePoint.id === point.id
														? { ...candidatePoint, x: -0 }
														: candidatePoint,
												),
											})),
										}
									: candidateLayer,
							),
						}
					: candidate,
			),
		}
		const encoded = encodeEditorFontSource(modified)
		if (!encoded.ok) throw new Error("negative zero did not encode")
		expect(encoded.value).toContain('"x":-0')
		const decoded = decodeEditorFontSource(encoded.value)
		if (!decoded.ok) throw new Error("negative zero did not decode")
		expect(
			Object.is(
				decoded.value.glyphs[1]?.layers[0]?.contours[0]?.points[0]?.x,
				-0,
			),
		).toBe(true)
	})

	test("returns detached, deeply frozen values", () => {
		const source = geometricOWithEveryEditorField()
		const file = toEditorFontFile(source)
		if (!file.ok) throw new Error("fixture did not convert")
		expect(Object.isFrozen(file.value)).toBe(true)
		expect(
			Object.isFrozen(file.value.glyphs[0]?.layers[0]?.contours[0]?.points),
		).toBe(true)

		const mutable = mutableFile(file.value)
		const decoded = fromEditorFontFile(mutable)
		if (!decoded.ok) throw new Error("fixture did not decode")
		mutable.names.family = "Mutated outside the codec"
		mutable.glyphs.reverse()
		expect(decoded.value.names.family).toBe("Create Font O Razor")
		expect(decoded.value.glyphs[0]?.id).toBe("glyph:.notdef")
		expect(Object.isFrozen(decoded.value)).toBe(true)
		expect(
			Object.isFrozen(decoded.value.glyphs[0]?.layers[0]?.contours[0]?.points),
		).toBe(true)
	})

	test("accepts structurally sound in-progress state without compiling it", () => {
		const source = makeGeometricOEditorFont()
		const inProgress: EditorFontSource = {
			...source,
			metadata: { ...source.metadata, unitsPerEm: -100 },
			names: { ...source.names, family: "" },
		}
		const validated = validateEditorFontSource(inProgress)
		expect(validated.ok).toBe(true)
		if (!validated.ok) return
		const editor = createFontEditorState({
			key: `source-in-progress/${(stateNamespace += 1)}`,
			isProduction: true,
		})
		editor.actions.load(validated.value)
		expect(editor.read.compilation().ok).toBe(false)
	})

	test("rejects invalid JSON and duplicate or unsafe object keys", () => {
		expectFailure(decodeEditorFontSource("{"), "json.syntax", "$")
		expectFailure(
			decodeEditorFontSource(
				'{"format":"create-font.editor","format":"create-font.editor","editorVersion":1}',
			),
			"json.duplicate_key",
			"$.format",
		)
		expectFailure(
			decodeEditorFontSource('{"__proto__":{},"format":"create-font.editor"}'),
			"json.unsafe_key",
			'$["__proto__"]',
		)
		expectFailure(
			decodeEditorFontSource(
				'{"format":"create-font.editor","editorVersion":1,"metadata":{"unitsPerEm":1000,"unitsPerEm":900}}',
			),
			"json.duplicate_key",
			"$.metadata.unitsPerEm",
		)
		expectFailure(
			decodeEditorFontSource(
				'{"format":"create-font.editor","metadata":{"\\u005f_proto__":{}}}',
			),
			"json.unsafe_key",
			'$.metadata["__proto__"]',
		)
	})

	test("handles ten thousand levels of valid JSON without recursion", () => {
		const deeplyNested = `${"[".repeat(10_000)}0${"]".repeat(10_000)}`
		expect(() => decodeEditorFontSource(deeplyNested)).not.toThrow()
		expect(decodeEditorFontSource(deeplyNested).ok).toBe(false)
	})

	test("rejects sparse and hostile-length arrays without scanning holes", () => {
		const source = makeGeometricOEditorFont()
		const sparse: unknown[] = []
		sparse.length = 0xffff_ffff
		const result = validateEditorFontSource({ ...source, axes: sparse })
		expect(result.ok).toBe(false)
		if (!result.ok) {
			expect(result.errors).toContainEqual(
				expect.objectContaining({ code: "source.array", path: "$.axes" }),
			)
		}

		const holey: unknown[] = []
		holey.length = 2
		holey[1] = source.axes[0]
		expect(validateEditorFontSource({ ...source, axes: holey }).ok).toBe(false)
	})

	test("turns hostile proxy traps and hostile thrown values into diagnostics", () => {
		const hostileCause = Object.create(null) as Record<string, unknown>
		Object.defineProperty(hostileCause, "toString", {
			get() {
				throw new Error("the thrown value must not be inspected")
			},
		})
		const hostileArray = new Proxy([], {
			ownKeys() {
				throw hostileCause
			},
		})
		const source = makeGeometricOEditorFont()
		let arrayResult: ReturnType<typeof validateEditorFontSource> | undefined
		expect(() => {
			arrayResult = validateEditorFontSource({ ...source, axes: hostileArray })
		}).not.toThrow()
		expect(arrayResult?.ok).toBe(false)
		if (arrayResult !== undefined && !arrayResult.ok) {
			expect(arrayResult.errors[0]?.message).toBe(
				"Source data could not be inspected safely.",
			)
		}

		const hostileObject = new Proxy(
			{},
			{
				getPrototypeOf() {
					throw hostileCause
				},
			},
		)
		expect(() => validateEditorFontSource(hostileObject)).not.toThrow()
		expect(validateEditorFontSource(hostileObject).ok).toBe(false)
	})

	test("rejects unknown properties and versions with stable diagnostics", () => {
		const file = toEditorFontFile(makeGeometricOEditorFont())
		if (!file.ok) throw new Error("fixture did not convert")
		const unknown = { ...file.value, surprise: true }
		expectFailure(
			decodeEditorFontSource(JSON.stringify(unknown)),
			"source.unknown_property",
			"$.surprise",
		)
		const future = { ...file.value, editorVersion: 6 }
		expectFailure(
			decodeEditorFontSource(JSON.stringify(future)),
			"source.version",
			"$.editorVersion",
		)
		const legacy = { ...file.value, editorVersion: 2 }
		expectFailure(
			decodeEditorFontSource(JSON.stringify(legacy)),
			"source.version",
			"$.editorVersion",
		)
	})

	test("migrates editor v3 metrics to zero overshoot zones", () => {
		const file = toEditorFontFile(makeGeometricOEditorFont())
		if (!file.ok) throw new Error("fixture did not convert")
		const { overshoots: _overshoots, ...legacyMetrics } = file.value.metrics
		const source = makeGeometricOEditorFont()
		const legacy: Record<string, unknown> = {
			...file.value,
			editorVersion: 3,
			metrics: legacyMetrics,
			glyphs: source.glyphs.map((glyph) =>
				legacySharedTopologyGlyph(glyph, source.defaultMasterId),
			),
		}
		const decoded = decodeEditorFontSource(JSON.stringify(legacy))
		expect(decoded.ok).toBe(true)
		if (!decoded.ok) return
		expect(decoded.value.editorVersion).toBe(5)
		expect(decoded.value.metrics.overshoots).toEqual({
			baseline: 0,
			ascender: 0,
			descender: 0,
			winAscent: 0,
			winDescent: 0,
			xHeight: 0,
			capHeight: 0,
			underlinePosition: 0,
		})
	})

	test("migrates v3 directory sources in server and browser assemblers", () => {
		const split = splitEditorFontSource(makeGeometricOEditorFont())
		if (!split.ok) throw new Error("fixture did not split")
		const project = split.value["create-font.json"] as Record<string, unknown>
		const metrics = split.value["metrics.json"] as Record<string, unknown>
		const { overshoots: _overshoots, ...legacyMetrics } = metrics
		const legacy: Record<string, unknown> = {
			...split.value,
			"create-font.json": { ...project, editorVersion: 3 },
			"metrics.json": legacyMetrics,
		}
		const source = makeGeometricOEditorFont()
		for (const [path, value] of Object.entries(legacy)) {
			if (!path.startsWith("glyphs/") || path === "glyphs/index.json") continue
			const glyph = source.glyphs.find(
				(candidate) => candidate.id === (value as { id?: string }).id,
			)
			if (glyph !== undefined) {
				legacy[path] = legacySharedTopologyGlyph(
					glyph,
					source.defaultMasterId,
				) as never
			}
		}
		for (const assemble of [
			assembleEditorFontSource,
			assembleBrowserEditorFontSource,
		]) {
			const result = assemble(legacy)
			expect(result.ok).toBe(true)
			if (!result.ok) continue
			expect(result.value.editorVersion).toBe(5)
			expect(result.value.metrics.overshoots.xHeight).toBe(0)
		}
	})

	test("allows one-sided soft nodes and enforces alignment when both handles exist", () => {
		const file = toEditorFontFile(makeGeometricOEditorFont())
		if (!file.ok) throw new Error("fixture did not convert")
		const oneSided = mutableFile(file.value)
		const oneSidedPoint = oneSided.glyphs[0]?.layers[0]?.contours[0]?.points[0]
		if (oneSidedPoint === undefined) throw new Error("fixture node is missing")
		delete oneSidedPoint.outgoing
		const decodedOneSided = decodeEditorFontSource(JSON.stringify(oneSided))
		expect(decodedOneSided.ok).toBe(true)

		const handleless = mutableFile(file.value)
		const handlelessPoint =
			handleless.glyphs[0]?.layers[0]?.contours[0]?.points[0]
		if (handlelessPoint === undefined)
			throw new Error("fixture node is missing")
		delete handlelessPoint.incoming
		delete handlelessPoint.outgoing
		expectFailure(
			decodeEditorFontSource(JSON.stringify(handleless)),
			"source.handle",
			"$.glyphs[0].layers[0].contours[0].points[0]",
		)

		const bent = mutableFile(file.value)
		const bentPoint = bent.glyphs[0]?.layers[0]?.contours[0]?.points[0]
		if (bentPoint?.outgoing === undefined) {
			throw new Error("fixture outgoing handle is missing")
		}
		bentPoint.outgoing.y = 100
		expectFailure(
			decodeEditorFontSource(JSON.stringify(bent)),
			"source.handle",
			"$.glyphs[0].layers[0].contours[0].points[0]",
		)
	})

	test("rejects noncanonical timestamps and nonfinite in-memory numbers", () => {
		const file = toEditorFontFile(geometricOWithEveryEditorField())
		if (!file.ok) throw new Error("fixture did not convert")
		const leadingZero = {
			...file.value,
			metadata: { ...file.value.metadata, createdAt: "01" },
		}
		expectFailure(
			decodeEditorFontSource(JSON.stringify(leadingZero)),
			"source.timestamp",
			"$.metadata.createdAt",
		)

		const source = makeGeometricOEditorFont()
		const invalid = {
			...source,
			metrics: { ...source.metrics, ascender: Number.POSITIVE_INFINITY },
		}
		const encoded = encodeEditorFontSource(invalid)
		expect(encoded.ok).toBe(false)
		if (!encoded.ok) {
			expect(encoded.errors).toContainEqual(
				expect.objectContaining({
					code: "source.number",
					path: "$.metrics.ascender",
				}),
			)
		}
	})

	test("rejects duplicate identities and dangling references", () => {
		const file = toEditorFontFile(makeGeometricOEditorFont())
		if (!file.ok) throw new Error("fixture did not convert")
		const firstGlyph = file.value.glyphs[0]
		if (firstGlyph === undefined) throw new Error("missing fixture glyph")
		const duplicateGlyph = {
			...file.value,
			glyphs: [firstGlyph, firstGlyph],
		}
		expectFailure(
			decodeEditorFontSource(JSON.stringify(duplicateGlyph)),
			"source.duplicate",
			"$.glyphs[1].id",
		)

		const danglingLayer = mutableFile(file.value)
		const firstLayer = danglingLayer.glyphs[0]?.layers[0]
		if (firstLayer === undefined) throw new Error("missing fixture layer")
		firstLayer.masterId = "master:missing"
		expectFailure(
			decodeEditorFontSource(JSON.stringify(danglingLayer)),
			"source.reference",
			"$.glyphs[0].layers[0].masterId",
		)
	})
})
