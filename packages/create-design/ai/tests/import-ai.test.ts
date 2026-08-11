import { existsSync, readFileSync } from "node:fs"

import { describe, expect, it } from "vitest"
import {
	assembleDesignDocument,
	splitDesignDocument,
} from "@create-design/source"

import {
	decodeIllustratorPrivateSource,
	importAdobeIllustrator,
	lexIllustratorSource,
	lowerIllustratorSource,
	parseIllustratorSource,
} from "../src/index.ts"
import {
	privateAiFixture,
	sourceFixture,
	textSourceFixture,
} from "./fixture.ts"

describe("Illustrator native-source import", () => {
	it("ships the repository MPL-2.0 license text", () => {
		const license = readFileSync(new URL("../LICENSE", import.meta.url), "utf8")
		expect(license).toMatch(/^ Mozilla Public License Version 2\.0/u)
	})

	it("decodes private blocks by part number, independent of PDF object order", () => {
		const source = sourceFixture()
		const decoded = decodeIllustratorPrivateSource(
			privateAiFixture(source, { parts: [31, 97] }),
		)
		expect(decoded).toMatchObject({
			ok: true,
			value: { compression: "deflate", text: source },
		})
	})

	it("decodes AI24 zstd private source", () => {
		const source = sourceFixture()
		expect(
			decodeIllustratorPrivateSource(
				privateAiFixture(source, { compression: "zstd" }),
			),
		).toMatchObject({ ok: true, value: { compression: "zstd", text: source } })
	})

	it("resolves PDF objects by object and generation and validates PieceInfo", () => {
		const source = sourceFixture()
		expect(
			decodeIllustratorPrivateSource(
				privateAiFixture(source, {
					chunkGenerations: [2],
					pieceInfoDescriptor: { id: 1, generation: 0 },
				}),
			),
		).toMatchObject({ ok: true, value: { text: source } })
		expect(
			decodeIllustratorPrivateSource(
				privateAiFixture(source, {
					chunkGenerations: [2],
					descriptor: "/NumBlock 1 /AIPrivateData1 10 0 R",
				}),
			),
		).toMatchObject({
			ok: false,
			message: expect.stringContaining("generation mismatch"),
		})
		expect(
			decodeIllustratorPrivateSource(
				privateAiFixture(source, {
					pieceInfoDescriptor: { id: 4, generation: 0 },
				}),
			),
		).toMatchObject({
			ok: false,
			message: expect.stringContaining("PieceInfo"),
		})
		expect(
			decodeIllustratorPrivateSource(
				privateAiFixture(source, {
					extraObjects: [
						"3 0 obj<</PieceInfo<</Illustrator<</Private 4 0 R>>>>>>endobj\n",
					],
				}),
			),
		).toMatchObject({ ok: true, value: { text: source } })
	})

	it("rejects duplicate PDF objects and ambiguous private descriptors", () => {
		const source = sourceFixture()
		expect(
			decodeIllustratorPrivateSource(
				privateAiFixture(source, {
					extraObjects: ["1 0 obj<</Note(duplicate)>>endobj\n"],
				}),
			),
		).toMatchObject({
			ok: false,
			message: expect.stringContaining("defined more than once"),
		})
		expect(
			decodeIllustratorPrivateSource(
				privateAiFixture(source, {
					extraObjects: [
						"4 0 obj<</NumBlock 1 /AIPrivateData1 10 0 R>>endobj\n",
					],
				}),
			),
		).toMatchObject({
			ok: false,
			message: expect.stringContaining("multiple ambiguous"),
		})
	})

	it("honors direct stream lengths when binary payload contains PDF keywords", () => {
		const decoded = decodeIllustratorPrivateSource(
			privateAiFixture(sourceFixture(), {
				adversarialStream: "binary endobj stream endstream bytes\n",
			}),
		)
		expect(decoded.ok).toBe(true)
	})

	it.each([
		{ descriptor: "/NumBlock 2 /AIPrivateData1 10 0 R /AIPrivateData1 11 0 R" },
		{ descriptor: "/NumBlock 2 /AIPrivateData1 10 0 R /AIPrivateData3 11 0 R" },
		{ descriptor: "/NumBlock 3 /AIPrivateData1 10 0 R /AIPrivateData2 11 0 R" },
	])("rejects malformed private block numbering", ({ descriptor }) => {
		const result = decodeIllustratorPrivateSource(
			privateAiFixture(sourceFixture(), { parts: [31], descriptor }),
		)
		expect(result).toMatchObject({
			ok: false,
			code: "ai.import.private-source-corrupt",
		})
	})

	it("accepts direct Illustrator PostScript and rejects unrelated PostScript", () => {
		const source = sourceFixture()
		expect(
			decodeIllustratorPrivateSource(new TextEncoder().encode(source)),
		).toMatchObject({
			ok: true,
			value: { compression: "none" },
		})
		expect(
			decodeIllustratorPrivateSource(
				new TextEncoder().encode("%!PS-Adobe-3.0\n%%Creator: Other\n"),
			),
		).toMatchObject({ ok: false, code: "ai.import.private-source-missing" })
	})

	it("rejects truncated and corrupt private compression", () => {
		const valid = privateAiFixture(sourceFixture())
		expect(
			decodeIllustratorPrivateSource(valid.slice(0, valid.length - 24)).ok,
		).toBe(false)
		const corrupt = valid.slice()
		corrupt.fill(
			0,
			Math.floor(corrupt.length / 2),
			Math.floor(corrupt.length / 2) + 12,
		)
		expect(decodeIllustratorPrivateSource(corrupt).ok).toBe(false)
	})

	it("losslessly lexes nested strings, CRLF comments, arrays, dictionaries, and procedures", () => {
		const source =
			"%_pseudo\r\n<< /N (a\\(b\\) (c)) /A [1 2e1] /P {true null <CAFE>} >>"
		const tokens = lexIllustratorSource(source)
		expect(tokens.map(({ raw }) => raw).join("")).toBe(source)
		expect(tokens).toContainEqual(
			expect.objectContaining({ kind: "pseudo-comment", value: "_pseudo" }),
		)
		expect(tokens).toContainEqual(
			expect.objectContaining({ kind: "string", value: "a(b) (c)" }),
		)
		expect(tokens).toContainEqual(
			expect.objectContaining({ kind: "hex", value: "CAFE" }),
		)
	})

	it("bounds the public lossless lexer before materializing excessive tokens", () => {
		expect(() => lexIllustratorSource("a b c", { maxTokens: 2 })).toThrow(
			/2-token lexer limit/u,
		)
		expect(() =>
			lexIllustratorSource("12345", { maxSourceCharacters: 4 }),
		).toThrow(/4-character lexer limit/u)
	})

	it("decodes PostScript string continuations across CRLF", () => {
		const parsed = parseIllustratorSource(
			sourceFixture().replace("(Artwork) Ln", "(Art\\\r\nwork) Ln"),
		)
		expect(parsed.layers[0]?.name).toBe("Artwork")
	})

	it("retains malformed lexer values with bounded source spans", () => {
		for (const source of ["(unterminated", "<CAFE", "[1 {2"]) {
			const tokens = lexIllustratorSource(source)
			expect(tokens.map(({ raw }) => raw).join("")).toBe(source)
			expect(
				tokens.every(
					({ span }) => span.start >= 0 && span.end <= source.length,
				),
			).toBe(true)
		}
	})

	it.each(["\r", "\n", "\r\n"])(
		"parses %j-delimited Illustrator source",
		(lineEnding) => {
			const source = sourceFixture().replace(/\r/gu, lineEnding)
			const parsed = parseIllustratorSource(source)
			expect(parsed.layers).toHaveLength(1)
			expect(parsed.artboards).toHaveLength(2)
			expect(parsed.layers[0]?.span.line).toBeGreaterThan(1)
		},
	)

	it("enforces public parser limits before materializing statements or text resources", () => {
		const source = textSourceFixture()
		for (const parsed of [
			parseIllustratorSource(source, {
				maxSourceCharacters: source.length - 1,
			}),
			parseIllustratorSource(source, { maxStatements: 2 }),
			parseIllustratorSource(source, { maxTextResourceCharacters: 8 }),
		]) {
			expect(parsed.diagnostics[0]?.severity).toBe("error")
			expect(parsed.statements).toEqual([])
			expect(parsed.resources).toEqual({})
			expect(parsed.layers).toEqual([])
		}
		expect(
			parseIllustratorSource(source, { maxSourceCharacters: source.length - 1 })
				.diagnostics[0]?.code,
		).toBe("ai.source.source-limit")
	})

	it("keeps overlapping artboards independent from one shared, unclipped hierarchy", () => {
		const result = importAdobeIllustrator(privateAiFixture(sourceFixture()))
		expect(result.ok).toBe(true)
		expect(result.document?.artboards).toMatchObject([
			{ name: "First", x: 0, y: -100, width: 100, height: 100 },
			{ name: "Overlap", x: 50, y: -50, width: 100, height: 100 },
		])
		expect(result.document?.objects).toHaveLength(7)
		expect(result.document?.groups).toHaveLength(2)
		const geometry = result.document?.objects[0]?.geometry
		expect(geometry?.kind).toBe("path")
		if (geometry?.kind === "path")
			expect(geometry.contours[0]?.points[0]).toMatchObject({ x: -20, y: -10 })
	})

	it("keeps Xk as fill, preserves group paint state, and merges compound contours", () => {
		const result = importAdobeIllustrator(privateAiFixture(sourceFixture()))
		expect(result.ok).toBe(true)
		const first = result.document?.objects[0]
		expect(first?.appearance.fill).toBeDefined()
		expect(first?.appearance.stroke).toBeUndefined()
		expect(result.document?.objects[1]?.appearance.stroke).toMatchObject({
			width: 4,
			cap: "round",
			join: "bevel",
			dashArray: [3, 2],
			dashOffset: 1,
		})
		const strokeSwatch = result.document?.swatches.find(
			({ id }) =>
				id === result.document?.objects[1]?.appearance.stroke?.swatchId,
		)
		expect(strokeSwatch).toMatchObject({
			source: { space: "rgb", r: 0, g: 255, b: 0 },
			alternate: { space: "cmyk", c: 0, m: 100, y: 0, k: 0 },
		})
		const firstSwatch = result.document?.swatches.find(
			({ id }) => id === first?.appearance.fill?.swatchId,
		)
		expect(firstSwatch).toMatchObject({
			name: "Orange",
			source: { space: "cmyk", c: 0, m: 50, y: 100, k: 0 },
		})
		expect(result.document?.objects[3]?.appearance.fill).toEqual(
			result.document?.objects[2]?.appearance.fill,
		)
		expect(
			result.document?.objects.find(({ name }) => name === "Compound path")
				?.geometry,
		).toMatchObject({ kind: "path", contours: [{}, {}] })
	})

	it("preserves legacy and generic custom-color grammar and diagnoses tint and overprint", () => {
		const generic = sourceFixture().replace(
			"0 0.5 1 0 (Orange) 0 0 Xk",
			"0.2 0.4 0.6 (RGB Spot) 0.5 1 Xx 1 O 1 R",
		)
		const parsed = parseIllustratorSource(generic)
		const first = parsed.layers[0]?.children.find(({ kind }) => kind === "path")
		expect(first).toMatchObject({
			kind: "path",
			fill: {
				space: "rgb",
				r: 0.2,
				g: 0.4,
				b: 0.6,
				name: "RGB Spot",
				tint: 0.5,
				colorType: 1,
			},
		})
		expect(parsed.diagnostics).toContainEqual(
			expect.objectContaining({
				code: "ai.source.unsupported-custom-color-tint",
			}),
		)
		expect(parsed.diagnostics).toContainEqual(
			expect.objectContaining({ code: "ai.source.unsupported-overprint" }),
		)
		expect(parsed.stats.unknownOperators).toMatchObject({ O: 1, R: 1 })
		expect(
			lowerIllustratorSource(parsed).document?.swatches.find(
				({ name }) => name === "RGB Spot",
			),
		).toMatchObject({ source: { space: "rgb", r: 153, g: 178.5, b: 204 } })
		const legacy = parseIllustratorSource(
			sourceFixture().replace(
				"0 0.5 1 0 (Orange) 0 0 Xk",
				"0.1 0.2 0.3 0.4 (Legacy) 0.7 x",
			),
		)
		expect(
			legacy.layers[0]?.children.find(({ kind }) => kind === "path"),
		).toMatchObject({
			kind: "path",
			fill: {
				space: "cmyk",
				name: "Legacy",
				alternateGray: 0.7,
			},
		})
		const legacySource = lowerIllustratorSource(legacy).document?.swatches.find(
			({ name }) => name === "Legacy",
		)?.source
		expect(legacySource).toMatchObject({ space: "cmyk" })
		if (legacySource?.space === "cmyk") {
			expect(legacySource.c).toBeCloseTo(3)
			expect(legacySource.m).toBeCloseTo(6)
			expect(legacySource.y).toBeCloseTo(9)
			expect(legacySource.k).toBeCloseTo(12)
		}
	})

	it("preserves complete path spans and authored group names", () => {
		const authored = sourceFixture()
			.replace("u\r", "6 (Named Group) XW\ru\r")
			.replace("q 70", "6 (Named Clip) XW\rq 70")
			.replace("*u\r", "6 (Named Compound) XW\r*u\r")
		const parsed = parseIllustratorSource(authored)
		const first = parsed.layers[0]?.children.find(({ kind }) => kind === "path")
		expect(first?.kind).toBe("path")
		if (first?.kind === "path")
			expect(authored.slice(first.span.start, first.span.end)).toBe(
				"-20 10 m 20 10 L 20 -10 L -20 -10 L f",
			)
		const imported = importAdobeIllustrator(new TextEncoder().encode(authored))
		expect(imported.document?.groups.map(({ name }) => name)).toContain(
			"Named Group",
		)
		expect(imported.document?.groups.map(({ name }) => name)).toContain(
			"Named Clip",
		)
		expect(imported.document?.objects.map(({ name }) => name)).toContain(
			"Named Compound",
		)
	})

	it("produces a valid split/assemble hierarchy with every object referenced once", () => {
		const result = importAdobeIllustrator(privateAiFixture(sourceFixture()))
		if (!result.ok || result.document === null)
			throw new Error("fixture import failed")
		const split = splitDesignDocument(result.document)
		expect(split.ok).toBe(true)
		if (!split.ok) return
		expect(assembleDesignDocument(split.value).ok).toBe(true)
		const references = [
			...result.document.layers.flatMap(({ children }) => children),
			...result.document.groups.flatMap(({ children }) => children),
		].filter(({ kind }) => kind === "object")
		for (const object of result.document.objects)
			expect(references.filter(({ id }) => id === object.id)).toHaveLength(1)
	})

	it("preserves unknown extension operators with spans and diagnostics", () => {
		const parsed = parseIllustratorSource(
			sourceFixture().replace("LB", "12 (payload) FutureAIExtension\rLB"),
		)
		expect(parsed.stats.unknownOperators).toMatchObject({
			FutureAIExtension: 1,
		})
		const unknown = parsed.layers[0]?.children.find(
			({ kind }) => kind === "unknown",
		)
		expect(unknown).toMatchObject({
			kind: "unknown",
			operator: "FutureAIExtension",
		})
		expect(unknown?.span.line).toBeGreaterThan(1)
		expect(parsed.diagnostics).toContainEqual(
			expect.objectContaining({ code: "ai.source.unknown-operator" }),
		)
		const imported = importAdobeIllustrator(
			new TextEncoder().encode(
				sourceFixture().replace("LB", "12 (payload) FutureAIExtension\rLB"),
			),
		)
		expect(imported.diagnostics[0]?.sourceSpan).toMatchObject({
			line: expect.any(Number),
			column: expect.any(Number),
		})
	})

	it("preserves fidelity-affecting operators and recovers unbalanced groups", () => {
		const parsed = parseIllustratorSource(
			sourceFixture()
				.replace("u\r", "u\r/Gradient Bg\r")
				.replace("\rU\r", "\r"),
		)
		expect(parsed.diagnostics).toContainEqual(
			expect.objectContaining({ code: "ai.source.unsupported-gradient" }),
		)
		expect(parsed.diagnostics).toContainEqual(
			expect.objectContaining({ code: "ai.source.unbalanced-group" }),
		)
	})

	it("associates active AI11 text resources in scene order and strips only the story sentinel", () => {
		const source = parseIllustratorSource(textSourceFixture())
		expect(source.resources.text?.fonts[0]?.postScriptName).toBe("Brahmin-5r")
		expect(source.resources.text?.stories[0]).toMatchObject({
			index: 0,
			text: "Hello\r",
			position: { x: 10, y: -20 },
			size: 12,
			fontSelector: 0,
		})
		const kinds = source.layers[0]?.children.map(({ kind }) => kind)
		expect(kinds?.slice(0, 3)).toEqual(["path", "text", "path"])
		const imported = importAdobeIllustrator(
			new TextEncoder().encode(textSourceFixture()),
		)
		expect(imported.ok).toBe(true)
		const text = imported.document?.objects.find(
			({ geometry }) => geometry.kind === "text",
		)
		expect(text?.geometry).toMatchObject({
			kind: "text",
			text: "Hello",
			x: 10,
			y: 20,
		})
		if (text?.geometry.kind === "text")
			expect(text.geometry.typography.font.family).toBe("Brahmin-5r")
		expect(imported.diagnostics).toContainEqual(
			expect.objectContaining({
				code: "ai.import.external-font-required",
				message: expect.stringContaining("Brahmin-5r"),
			}),
		)
		expect(imported.diagnostics).toContainEqual(
			expect.objectContaining({ code: "ai.import.unsupported-text-structure" }),
		)
	})

	it("decodes arbitrary UTF-16BE AI11 text, including surrogate pairs", () => {
		const story = "Café ƀ 世界 Привет 😀\r"
		const parsed = parseIllustratorSource(textSourceFixture(story))
		expect(parsed.resources.text?.stories[0]?.text).toBe(story)
		const imported = importAdobeIllustrator(
			new TextEncoder().encode(textSourceFixture(story)),
		)
		expect(
			imported.document?.objects.find(
				({ geometry }) => geometry.kind === "text",
			)?.geometry,
		).toMatchObject({ kind: "text", text: story.slice(0, -1) })
	})

	it("diagnoses text structures that cannot be represented exactly", () => {
		const source = textSourceFixture().replace(
			"0 /FrameIndex ,",
			"1 /FrameIndex ,",
		)
		const imported = importAdobeIllustrator(new TextEncoder().encode(source))
		expect(imported.diagnostics).toContainEqual(
			expect.objectContaining({
				code: "ai.import.unsupported-text-structure",
				sourceSpan: expect.objectContaining({
					start: expect.any(Number),
					end: expect.any(Number),
				}),
			}),
		)
	})

	it("enforces the structural nesting limit", () => {
		const source = sourceFixture().replace("u\r", "u\r".repeat(513))
		expect(parseIllustratorSource(source).diagnostics).toContainEqual(
			expect.objectContaining({ code: "ai.source.resource-limit" }),
		)
	})

	it("bounds numeric arrays independently from the token limit", () => {
		const oversizedDash = `[${"1 ".repeat(16_385)}]`
		const parsed = parseIllustratorSource(
			sourceFixture().replace("[3 2]", oversizedDash),
		)
		expect(parsed.diagnostics).toContainEqual(
			expect.objectContaining({
				code: "ai.source.token-limit",
				severity: "error",
			}),
		)
	})

	it("fails instead of importing visible PDF pages when native source is absent", () => {
		const result = importAdobeIllustrator(
			new TextEncoder().encode("%PDF-1.7\n1 0 obj<<>>endobj\n%%EOF"),
		)
		expect(result).toMatchObject({ ok: false, document: null })
		expect(result.diagnostics[0]?.code).toBe("ai.import.private-source-missing")
	})
})

const sampleDirectory = "/tmp/import-samples"
describe.runIf(existsSync(sampleDirectory))(
	"supplied Illustrator samples",
	() => {
		it.each([
			["biome", 8, 51, 5],
			["equip", 1, 22, 11],
			["lasertag", 4, 216, 45],
		] as const)(
			"imports %s from native source",
			(name, artboards, objects, groups) => {
				const bytes = readFileSync(`${sampleDirectory}/${name}.ai`)
				const result = importAdobeIllustrator(bytes, { title: name })
				expect(result.ok).toBe(true)
				expect(result.summary).toMatchObject({ artboards, objects })
				expect(result.document?.groups).toHaveLength(groups)
			},
		)

		it("recovers all four lasertag artboards and nine active live text frames", () => {
			const bytes = readFileSync(`${sampleDirectory}/lasertag.ai`)
			const decoded = decodeIllustratorPrivateSource(bytes)
			expect(decoded.ok).toBe(true)
			if (!decoded.ok) return
			const source = parseIllustratorSource(decoded.value.text)
			expect(
				source.artboards.map(({ name, left, top, right, bottom }) => [
					name,
					left,
					top,
					right,
					bottom,
				]),
			).toEqual([
				["LasertagIconBlack", 0, 0, 1024, -1024],
				["LasertagWordmarkBlack", -64, 0, 4032, -1024],
				["LasertagIcon", 0, -1044, 1024, -2068],
				["LasertagWordmark", -64, -1044, 4032, -2068],
			])
			expect(source.artboards[0]).toMatchObject({
				uuid: "a68dfe42-a56f-47c8-8f29-0aca3b9d073a",
				selected: false,
				locked: false,
				pixelAspectRatio: 1,
				rulerOrigin: { x: 7679, y: 7679 },
			})
			expect(source.artboards[3]?.selected).toBe(true)
			expect(source.stats).toMatchObject({
				paths: 246,
				groups: 156,
				textFrames: 9,
			})
			expect(
				source.resources.text?.fonts.map(
					({ postScriptName }) => postScriptName,
				),
			).toContain("Manufab-Regular")
		})

		it("recovers equip bleed and authored layer locks", () => {
			const decoded = decodeIllustratorPrivateSource(
				readFileSync(`${sampleDirectory}/equip.ai`),
			)
			if (!decoded.ok) throw new Error(decoded.message)
			const source = parseIllustratorSource(decoded.value.text)
			expect(source.artboards[0]?.bleed).toEqual({
				top: 3,
				right: 3,
				bottom: 3,
				left: 3,
			})
			expect(source.layers.map(({ locked }) => locked)).toEqual([
				false,
				true,
				true,
				true,
				true,
			])
		})
	},
)
