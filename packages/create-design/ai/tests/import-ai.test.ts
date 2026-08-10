import { readFileSync } from "node:fs"

import { describe, expect, it } from "vitest"
import {
	assembleDesignDocument,
	splitDesignDocument,
} from "@create-design/source"

import { importAdobeIllustrator } from "../src/index.ts"
import { illustratorFixture, pdfBytes } from "./fixture.ts"

describe("Adobe Illustrator import", () => {
	it("ships the repository MPL-2.0 license text", () => {
		const license = readFileSync(new URL("../LICENSE", import.meta.url), "utf8")
		expect(license).toMatch(/^ Mozilla Public License Version 2\.0/u)
		expect(license).toContain("Exhibit A - Source Code Form License Notice")
	})

	it("does not mistake stream text inside an ordinary PDF object for a stream", () => {
		const result = importAdobeIllustrator(
			pdfBytes([
				"1 0 obj<</Type/Catalog/Note(line1\nstream\nendobj)/Pages 2 0 R % stream endobj\n>>endobj\n",
				"2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1/MediaBox[0 0 10 10]>>endobj\n",
				"3 0 obj<</Type/Page/Parent 2 0 R/Contents 4 0 R>>endobj\n",
				"4 0 obj<</Length 0>>stream\nendstream\nendobj\n",
			]),
		)
		expect(result.ok).toBe(true)
	})

	it("lowers PDF-compatible paths, artboard geometry, paint, and coordinates", () => {
		const result = importAdobeIllustrator(
			illustratorFixture({
				content:
					"0.1 0.2 0.3 0.4 k 2 w 1 J 2 j 8 M [3 2] 1 d 10 20 m 30 20 l 40 40 50 50 60 60 c h B*\n",
			}),
		)

		expect(result.ok).toBe(true)
		expect(result.document?.title).toBe("Fixture")
		expect(result.document?.artboards).toEqual([
			{
				height: 200,
				id: "artboard:ai-1",
				name: "Artboard 1",
				width: 100,
				x: 0,
				y: 0,
			},
		])
		const object = result.document?.objects[0]
		expect(object?.transform).toEqual({
			a: 1,
			b: 0,
			c: 0,
			d: -1,
			e: -10,
			f: 220,
		})
		expect(object?.appearance.stroke).toMatchObject({
			cap: "round",
			dashArray: [3, 2],
			dashOffset: 1,
			join: "bevel",
			miterLimit: 8,
			width: 2,
		})
		expect(object?.geometry).toMatchObject({
			kind: "path",
			fillRule: "evenodd",
		})
		expect(result.document?.swatches[0]?.source).toEqual({
			space: "cmyk",
			c: 10,
			m: 20,
			y: 30,
			k: 40,
		})
	})

	it("decodes Flate streams and preserves clipping as a native group", () => {
		const result = importAdobeIllustrator(
			illustratorFixture({
				filter: "flate",
				content: "0 0 50 50 re W n 1 0 0 rg 0 0 100 100 re f\n",
			}),
		)

		expect(result.ok).toBe(true)
		expect(result.document?.groups).toHaveLength(1)
		expect(result.document?.groups[0]?.clippingPathId).toBe(
			result.document?.objects[1]?.id,
		)
		expect(result.document?.objects[1]?.appearance).toEqual({})
		expect(splitDesignDocument(result.document!).ok).toBe(true)
	})

	it("activates W clipping only after stroking the path", () => {
		const result = importAdobeIllustrator(
			illustratorFixture({
				content: "0 0 10 10 re W S 1 0 0 rg 0 0 100 100 re f\n",
			}),
		)
		expect(result.ok).toBe(true)
		expect(result.document?.groups).toHaveLength(1)
		expect(
			result.document?.layers[0]?.children.map(({ kind }) => kind),
		).toEqual(["object", "group"])
		expect(result.document?.objects[0]?.appearance.stroke).toBeDefined()
	})

	it("uses the complete path constructed after W as the pending clip", () => {
		const result = importAdobeIllustrator(
			illustratorFixture({
				content: "0 0 10 10 re W 20 20 10 10 re n 0 0 100 100 re f\n",
			}),
		)
		expect(result.ok).toBe(true)
		const clippingPathId = result.document?.groups[0]?.clippingPathId
		const clippingPath = result.document?.objects.find(
			({ id }) => id === clippingPathId,
		)
		expect(clippingPath?.geometry).toMatchObject({
			kind: "path",
			contours: [{ closed: true }, { closed: true }],
		})
		expect(splitDesignDocument(result.document!).ok).toBe(true)
	})

	it.each([
		{
			bytes: new TextEncoder().encode(
				"%!PS-Adobe-3.0\n%%Creator: Adobe Illustrator\n",
			),
			code: "ai.import.not-pdf-compatible",
		},
		{
			bytes: new TextEncoder().encode(
				"%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n",
			),
			code: "ai.import.not-illustrator",
		},
		{
			bytes: illustratorFixture({ version: "2.0" }),
			code: "ai.import.unsupported-pdf-version",
		},
		{
			bytes: illustratorFixture({ filter: "unsupported" }),
			code: "ai.import.unsupported-stream-filter",
		},
	])("rejects an unsupported container with $code", ({ bytes, code }) => {
		const result = importAdobeIllustrator(bytes)
		expect(result.ok).toBe(false)
		expect(result.document).toBeNull()
		expect(result.diagnostics).toContainEqual(
			expect.objectContaining({ code, severity: "error" }),
		)
	})

	it("reports lossy visible-PDF features once per page", () => {
		const result = importAdobeIllustrator(
			illustratorFixture({
				content:
					"BT /F1 12 Tf (hello) Tj ET /DeviceN cs 0.5 scn /Image Do /Shade sh\n",
			}),
		)
		expect(result.ok).toBe(true)
		expect(result.diagnostics.map(({ code }) => code)).toEqual([
			"ai.import.unsupported-text",
			"ai.import.unsupported-color-space",
			"ai.import.missing-xobject",
			"ai.import.unsupported-gradient",
		])
	})

	it("skips bounded inline-image data instead of interpreting it as paths", () => {
		const result = importAdobeIllustrator(
			illustratorFixture({
				content: "BI /W 1 /H 1 /CS /RGB /BPC 8 ID 0 0 10 10 re f EI\n",
			}),
		)
		expect(result.ok).toBe(true)
		expect(result.document?.objects).toHaveLength(0)
		expect(result.diagnostics).toContainEqual(
			expect.objectContaining({ code: "ai.import.unsupported-image" }),
		)
	})

	it("starts at Catalog Pages, inherits page attributes, and walks Kids order", () => {
		const inheritedContent = "/OC /Inherited BDC 0 0 10 10 re f EMC\n"
		const result = importAdobeIllustrator(
			pdfBytes([
				"2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\n",
				"1 0 obj<</Type/Catalog/Pages 9 0 R>>endobj\n",
				"9 0 obj<</Type/Pages/Kids[7 0 R 3 0 R]/Count 2/ArtBox[0 0 1 1]/CropBox[0 0 100 50]/Resources<</Properties<</Inherited 12 0 R>>>>>>endobj\n",
				"7 0 obj<</Type/Pages/Kids[4 0 R]/Count 1>>endobj\n",
				"4 0 obj<</Type/Page/Parent 7 0 R/Contents 5 0 R>>endobj\n",
				"3 0 obj<</Type/Page/Parent 9 0 R/ArtBox[0 0 200 60]/Contents 6 0 R>>endobj\n",
				`5 0 obj<</Length ${inheritedContent.length}>>stream\n${inheritedContent}endstream\nendobj\n`,
				"6 0 obj<</Length 0>>stream\nendstream\nendobj\n",
				"8 0 obj<</Producer(Adobe Illustrator)>>endobj\n",
				"12 0 obj<</Type/OCG/Name(Inherited resources)>>endobj\n",
			]),
		)
		expect(result.document?.artboards).toMatchObject([
			{ width: 100, height: 50, x: 0 },
			{ width: 200, height: 60, x: 148 },
		])
		expect(result.document?.layers[0]?.name).toBe("Inherited resources")
	})

	it("applies inherited page rotation and page UserUnit", () => {
		const content = "0 0 1 1 re f\n"
		const result = importAdobeIllustrator(
			pdfBytes([
				"1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n",
				"2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1/MediaBox[10 20 110 70]/Rotate 90>>endobj\n",
				"3 0 obj<</Type/Page/Parent 2 0 R/UserUnit 2/Contents 4 0 R>>endobj\n",
				`4 0 obj<</Length ${content.length}>>stream\n${content}endstream\nendobj\n`,
				"5 0 obj<</Producer(Adobe Illustrator)>>endobj\n",
			]),
		)
		expect(result.document?.artboards[0]).toMatchObject({
			width: 100,
			height: 200,
		})
		expect(result.document?.objects[0]?.transform).toEqual({
			a: 0,
			b: 2,
			c: 2,
			d: 0,
			e: -40,
			f: -20,
		})
	})

	it("maps OCG names and composes page, graphics-state, and Form transforms", () => {
		const form = "1 0 0 rg 0 0 10 20 re f\n"
		const page = "/OC /MC0 BDC q 1 0 0 1 5 6 cm /Fm0 Do Q EMC\n"
		const result = importAdobeIllustrator(
			pdfBytes([
				"1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n",
				"2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n",
				`3 0 obj<</Type/Page/Parent 2 0 R/ArtBox[0 0 100 100]/Contents 4 0 R/Resources<</Properties<</MC0 6 0 R>>/XObject<</Fm0 5 0 R>>>>>>endobj\n`,
				`4 0 obj<</Length ${page.length}>>stream\n${page}endstream\nendobj\n`,
				`5 0 obj<</Subtype/Form/Matrix[2 0 0 2 1 2]/Length ${form.length}>>stream\n${form}endstream\nendobj\n`,
				"6 0 obj<</Type/OCG/Name(Illustrator Layer)>>endobj\n",
				"7 0 obj<</Producer(Adobe Illustrator)>>endobj\n",
			]),
		)
		expect(result.ok).toBe(true)
		expect(result.document?.layers.map(({ name }) => name)).toEqual([
			"Illustrator Layer",
		])
		expect(result.document?.objects[0]?.transform).toEqual({
			a: 2,
			b: 0,
			c: 0,
			d: -2,
			e: 6,
			f: 92,
		})
	})

	it("canonicalizes alternating OCG layers with native clipping", () => {
		const content = [
			"/OC /Back BDC 1 0 0 rg 0 0 10 10 re f EMC",
			"/OC /Front BDC 0 0 5 5 re W n 0 1 0 rg 0 0 10 10 re f EMC",
			"/OC /Back BDC 0 0 1 rg 20 0 10 10 re f EMC",
		].join("\n")
		const result = importAdobeIllustrator(
			pdfBytes([
				"1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n",
				"2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n",
				"3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 100 100]/Contents 4 0 R/Resources<</Properties<</Back 5 0 R/Front 6 0 R>>>>>>endobj\n",
				`4 0 obj<</Length ${content.length}>>stream\n${content}endstream\nendobj\n`,
				"5 0 obj<</Type/OCG/Name(Back Layer)>>endobj\n",
				"6 0 obj<</Type/OCG/Name(Front Layer)>>endobj\n",
				"7 0 obj<</Producer(Adobe Illustrator)>>endobj\n",
			]),
		)
		expect(result.ok).toBe(true)
		expect(result.document?.layers.map(({ name }) => name)).toEqual([
			"Back Layer",
			"Front Layer",
			"Back Layer",
		])
		expect(result.document?.groups).toHaveLength(2)
		expect(splitDesignDocument(result.document!).ok).toBe(true)
	})

	it("preserves graphics state and paths across a Contents array", () => {
		const first = "1 0 0 rg 0 0 10 10 re"
		const second = "f\n"
		const result = importAdobeIllustrator(
			pdfBytes([
				"1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n",
				"2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1/MediaBox[0 0 20 20]>>endobj\n",
				"3 0 obj<</Type/Page/Parent 2 0 R/Contents[4 0 R 5 0 R]>>endobj\n",
				`4 0 obj<</Length ${first.length}>>stream\n${first}endstream\nendobj\n`,
				`5 0 obj<</Length ${second.length}>>stream\n${second}endstream\nendobj\n`,
				"6 0 obj<</Producer(Adobe Illustrator)>>endobj\n",
			]),
		)
		expect(result.ok).toBe(true)
		expect(result.document?.objects).toHaveLength(1)
		expect(result.document?.swatches[0]?.source).toEqual({
			space: "rgb",
			r: 255,
			g: 0,
			b: 0,
		})
	})

	it("maps OCG default visibility and preserves non-OC marked-content nesting", () => {
		const content = [
			"/OC /Back BDC 0 0 5 5 re f",
			"/Artifact BMC 5 0 5 5 re f EMC",
			"EMC /OC /Front BDC 10 0 5 5 re f EMC",
		].join("\n")
		const result = importAdobeIllustrator(
			pdfBytes([
				"1 0 obj<</Type/Catalog/Pages 2 0 R/OCProperties<</OCGs[5 0 R 6 0 R]/D<</BaseState/OFF/ON[6 0 R]/OFF[5 0 R]>>>>>>endobj\n",
				"2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1/MediaBox[0 0 20 20]>>endobj\n",
				"3 0 obj<</Type/Page/Parent 2 0 R/Contents 4 0 R/Resources<</Properties<</Back 5 0 R/Front 6 0 R>>>>>>endobj\n",
				`4 0 obj<</Length ${content.length}>>stream\n${content}endstream\nendobj\n`,
				"5 0 obj<</Type/OCG/Name(Back)>>endobj\n",
				"6 0 obj<</Type/OCG/Name(Front)>>endobj\n",
				"7 0 obj<</Producer(Adobe Illustrator)>>endobj\n",
			]),
		)
		expect(
			result.document?.layers.map(({ name, hidden, children }) => ({
				name,
				hidden: Boolean(hidden),
				children: children.length,
			})),
		).toEqual([
			{ name: "Back", hidden: true, children: 2 },
			{ name: "Front", hidden: false, children: 1 },
		])
	})

	it("inherits Form paint and clipping, including the Form BBox", () => {
		const page = "0 1 0 rg 0 0 50 50 re W n /Fm Do\n"
		const form = "0 0 100 100 re f\n"
		const result = importAdobeIllustrator(
			pdfBytes([
				"1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n",
				"2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1/MediaBox[0 0 100 100]>>endobj\n",
				"3 0 obj<</Type/Page/Parent 2 0 R/Contents 4 0 R/Resources<</XObject<</Fm 5 0 R>>>>>>endobj\n",
				`4 0 obj<</Length ${page.length}>>stream\n${page}endstream\nendobj\n`,
				`5 0 obj<</Subtype/Form/BBox[0 0 10 20]/Length ${form.length}>>stream\n${form}endstream\nendobj\n`,
				"6 0 obj<</Producer(Adobe Illustrator)>>endobj\n",
			]),
		)
		expect(result.ok).toBe(true)
		expect(result.document?.groups).toHaveLength(2)
		expect(result.document?.swatches[0]?.source).toEqual({
			space: "rgb",
			r: 0,
			g: 255,
			b: 0,
		})
		expect(splitDesignDocument(result.document!).ok).toBe(true)
	})

	it("bounds cyclic and repeated Form expansion", () => {
		const repeated = Array.from({ length: 1_001 }, () => "/Empty Do").join(" ")
		const cyclePage = "/Cycle Do\n"
		const cycleForm = "0 0 1 1 re f /Self Do\n"
		const result = importAdobeIllustrator(
			pdfBytes([
				"1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n",
				"2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1/MediaBox[0 0 10 10]>>endobj\n",
				"3 0 obj<</Type/Page/Parent 2 0 R/Contents[4 0 R 8 0 R]/Resources<</XObject<</Cycle 5 0 R/Empty 7 0 R>>>>>>endobj\n",
				`4 0 obj<</Length ${cyclePage.length}>>stream\n${cyclePage}endstream\nendobj\n`,
				`5 0 obj<</Subtype/Form/BBox[0 0 1 1]/Resources<</XObject<</Self 5 0 R>>>>/Length ${cycleForm.length}>>stream\n${cycleForm}endstream\nendobj\n`,
				"7 0 obj<</Subtype/Form/BBox[0 0 1 1]/Length 0>>stream\nendstream\nendobj\n",
				`8 0 obj<</Length ${repeated.length}>>stream\n${repeated}endstream\nendobj\n`,
				"9 0 obj<</Producer(Adobe Illustrator)>>endobj\n",
			]),
		)
		expect(result.ok).toBe(true)
		expect(result.diagnostics).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ code: "ai.import.form-cycle" }),
				expect.objectContaining({ code: "ai.import.form-expansion-limit" }),
			]),
		)
	})

	it.each([
		{
			name: "active clipping",
			content: `${Array.from({ length: 129 }, () => "0 0 1 1 re W n").join(" ")} 0 0 1 1 re f`,
		},
		{
			name: "graphics-state nesting",
			content: Array.from({ length: 257 }, () => "q").join(" "),
		},
	])(
		"rejects excessive $name depth before building native hierarchy",
		({ content }) => {
			const result = importAdobeIllustrator(illustratorFixture({ content }))
			expect(result.ok).toBe(false)
			expect(result.diagnostics).toContainEqual(
				expect.objectContaining({ code: "ai.import.content-limit" }),
			)
		},
	)

	it.each([
		{
			code: "ai.import.encrypted",
			bytes: pdfBytes([
				"1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n",
				"2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\n",
				"trailer<</Encrypt 3 0 R>>\n",
			]),
		},
		{
			code: "ai.import.indirect-stream-length",
			bytes: pdfBytes([
				"1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n",
				"2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n",
				"3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 10 10]/Contents 4 0 R>>endobj\n",
				"4 0 obj<</Length 5 0 R>>stream\n\nendstream\nendobj\n",
				"5 0 obj 0 endobj\n",
			]),
		},
		{
			code: "ai.import.compressed-objects",
			bytes: pdfBytes([
				"1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n",
				"2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\n",
				"3 0 obj<</Type/ObjStm/Length 0>>stream\nendstream\nendobj\n",
			]),
		},
	])("rejects structural PDF hazards with $code", ({ bytes, code }) => {
		const result = importAdobeIllustrator(bytes)
		expect(result.ok).toBe(false)
		expect(result.diagnostics).toContainEqual(
			expect.objectContaining({ code, severity: "error" }),
		)
	})

	it("is deterministic and round-trips through canonical directory source", () => {
		const bytes = illustratorFixture({ filter: "flate" })
		const first = importAdobeIllustrator(bytes)
		const second = importAdobeIllustrator(bytes)
		expect(second).toEqual(first)
		expect(first.document).not.toBeNull()
		const split = splitDesignDocument(first.document!)
		expect(split.ok).toBe(true)
		if (!split.ok) return
		const assembled = assembleDesignDocument(split.value)
		expect(assembled).toEqual({ ok: true, value: first.document })
	})
})
