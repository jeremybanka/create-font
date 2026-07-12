import { describe, expect, expectTypeOf, test } from "vitest"

import { createFontEditorState } from "../../states/src/state.ts"
import type { EditorFontSource } from "../../states/src/types.ts"
import { makeGeometricOEditorFont } from "../../states/tests/fixtures/geometric-o.ts"
import {
	canonicalizeEditorFontSource,
	decodeEditorFontSource,
	encodeEditorFontSource,
	fromEditorFontFile,
	toEditorFontFile,
	validateEditorFontSource,
	type EditorFontFile,
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
			contours: glyph.contours.map((contour) => ({
				...contour,
				points: contour.points.map((point) => ({
					...point,
					smooth: true,
				})),
			})),
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

describe("@trigraph/source", () => {
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
		expect(decoded.value.glyphs[1]?.contours[0]?.points[0]?.smooth).toBe(true)
		expect(decoded.value.metadata.createdAt).toBe(-1n)
		expect(decoded.value.metadata.modifiedAt).toBe(18_446_744_073_709_551_615n)
	})

	test("uses the EditorFontSource document as the file root", () => {
		const file = toEditorFontFile(geometricOWithEveryEditorField())
		expect(file.ok).toBe(true)
		if (!file.ok) return
		expect(file.value.format).toBe("trigraph.editor")
		expect(file.value.editorVersion).toBe(1)
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
				contours: glyph.contours.map((contour) => ({
					...contour,
					points: contour.points.map((point) => ({
						...point,
						smooth: false,
					})),
				})),
				layers: glyph.layers.map((layer) => ({
					...layer,
					points: [...layer.points].reverse(),
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
		expect(decoded.value.glyphs[0]?.contours[0]?.points[0]).not.toHaveProperty(
			"smooth",
		)
		const topologyOrder = decoded.value.glyphs[0]?.contours.flatMap((contour) =>
			contour.points.map((point) => point.id),
		)
		expect(
			decoded.value.glyphs[0]?.layers[0]?.points.map((point) => point.pointId),
		).toEqual(topologyOrder)
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
		const point = layer.points[0]
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
											points: candidateLayer.points.map((candidatePoint) =>
												candidatePoint.pointId === point.pointId
													? { ...candidatePoint, x: -0 }
													: candidatePoint,
											),
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
			Object.is(decoded.value.glyphs[1]?.layers[0]?.points[0]?.x, -0),
		).toBe(true)
	})

	test("returns detached, deeply frozen values", () => {
		const source = geometricOWithEveryEditorField()
		const file = toEditorFontFile(source)
		if (!file.ok) throw new Error("fixture did not convert")
		expect(Object.isFrozen(file.value)).toBe(true)
		expect(Object.isFrozen(file.value.glyphs[0]?.contours[0]?.points)).toBe(
			true,
		)

		const mutable = mutableFile(file.value)
		const decoded = fromEditorFontFile(mutable)
		if (!decoded.ok) throw new Error("fixture did not decode")
		mutable.names.family = "Mutated outside the codec"
		mutable.glyphs.reverse()
		expect(decoded.value.names.family).toBe("Trigraph O Razor")
		expect(decoded.value.glyphs[0]?.id).toBe("glyph:.notdef")
		expect(Object.isFrozen(decoded.value)).toBe(true)
		expect(Object.isFrozen(decoded.value.glyphs[0]?.layers[0]?.points)).toBe(
			true,
		)
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
				'{"format":"trigraph.editor","format":"trigraph.editor","editorVersion":1}',
			),
			"json.duplicate_key",
			"$.format",
		)
		expectFailure(
			decodeEditorFontSource('{"__proto__":{},"format":"trigraph.editor"}'),
			"json.unsafe_key",
			'$["__proto__"]',
		)
		expectFailure(
			decodeEditorFontSource(
				'{"format":"trigraph.editor","editorVersion":1,"metadata":{"unitsPerEm":1000,"unitsPerEm":900}}',
			),
			"json.duplicate_key",
			"$.metadata.unitsPerEm",
		)
		expectFailure(
			decodeEditorFontSource(
				'{"format":"trigraph.editor","metadata":{"\\u005f_proto__":{}}}',
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
		const future = { ...file.value, editorVersion: 2 }
		expectFailure(
			decodeEditorFontSource(JSON.stringify(future)),
			"source.version",
			"$.editorVersion",
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
