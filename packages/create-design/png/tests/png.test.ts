import { describe, expect, it } from "vitest"
import { createHash } from "node:crypto"
import { createInitialDocument } from "@create-design/source"
import { resolvedRgb } from "@create-design/model"

import {
	encodeRgbaPng,
	exportPng,
	pngArtifactFilename,
	preflightPngExport,
	resolvePngArtboards,
} from "../src/index.ts"

function chunks(bytes: Uint8Array, name: string): Uint8Array[] {
	const values: Uint8Array[] = []
	for (let offset = 8; offset < bytes.length;) {
		const view = new DataView(bytes.buffer, bytes.byteOffset + offset)
		const length = view.getUint32(0)
		const type = new TextDecoder().decode(
			bytes.subarray(offset + 4, offset + 8),
		)
		if (type === name)
			values.push(bytes.subarray(offset + 8, offset + 8 + length))
		offset += 12 + length
	}
	return values
}

async function decode(
	bytes: Uint8Array,
): Promise<Readonly<{ width: number; height: number; rgba: Uint8Array }>> {
	const ihdr = chunks(bytes, "IHDR")[0]!
	const view = new DataView(ihdr.buffer, ihdr.byteOffset, ihdr.byteLength)
	const width = view.getUint32(0)
	const height = view.getUint32(4)
	const idat = chunks(bytes, "IDAT")
	const packed = new Uint8Array(
		idat.reduce((sum, part) => sum + part.length, 0),
	)
	let offset = 0
	for (const part of idat) {
		packed.set(part, offset)
		offset += part.length
	}
	const raw = new Uint8Array(
		await new Response(
			new Blob([packed])
				.stream()
				.pipeThrough(new DecompressionStream("deflate")),
		).arrayBuffer(),
	)
	const rgba = new Uint8Array(width * height * 4)
	for (let row = 0; row < height; row += 1)
		rgba.set(
			raw.subarray(row * (width * 4 + 1) + 1, (row + 1) * (width * 4 + 1)),
			row * width * 4,
		)
	return { width, height, rgba }
}

describe("deterministic PNG output", () => {
	it("uses authored artboard color by default and permits an explicit override", async () => {
		const initial = createInitialDocument()
		const document = {
			...initial,
			artboards: [
				{
					...initial.artboards[0]!,
					width: 1,
					height: 1,
					backgroundColor: "#123456",
				},
			],
			objects: [],
			layers: [{ ...initial.layers[0]!, children: [] }],
		}
		const authored = await exportPng(document, {
			scope: { kind: "all" },
			samples: 1,
		})
		const transparent = await exportPng(document, {
			scope: { kind: "all" },
			samples: 1,
			background: { kind: "transparent" },
		})

		expect((await decode(authored.artifacts[0]!.bytes)).rgba).toEqual(
			new Uint8Array([0x12, 0x34, 0x56, 0xff]),
		)
		expect((await decode(transparent.artifacts[0]!.bytes)).rgba).toEqual(
			new Uint8Array([0, 0, 0, 0]),
		)
	})

	it("rasterizes hierarchy order with hidden layers omitted and locked layers visible", async () => {
		const initial = createInitialDocument()
		const source = initial.objects[0]!
		const rectangle = {
			...source,
			geometry: {
				kind: "rectangle" as const,
				x: 0,
				y: 0,
				width: 1,
				height: 1,
			},
			transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
		}
		const back = { ...rectangle, id: "object:back" }
		const hidden = {
			...rectangle,
			id: "object:hidden",
			appearance: { fill: { swatchId: "swatch:ink" } },
		}
		const front = {
			...rectangle,
			id: "object:front",
			appearance: { fill: { swatchId: "swatch:cyan" } },
		}
		const document = {
			...initial,
			artboards: [{ ...initial.artboards[0]!, width: 1, height: 1 }],
			objects: [front, hidden, back],
			layers: [
				{
					id: "layer:back",
					name: "Back",
					children: [{ kind: "group" as const, id: "group:back" }],
				},
				{
					id: "layer:hidden",
					name: "Hidden",
					hidden: true,
					children: [{ kind: "object" as const, id: hidden.id }],
				},
				{
					id: "layer:front",
					name: "Front",
					locked: true,
					children: [{ kind: "object" as const, id: front.id }],
				},
			],
			groups: [
				{
					id: "group:back",
					name: "Back group",
					children: [{ kind: "object" as const, id: back.id }],
				},
			],
		}
		const request = { scope: { kind: "all" as const }, samples: 1 as const }
		const locked = await exportPng(document, request)
		const unlocked = await exportPng(
			{
				...document,
				layers: document.layers.map((layer) => ({
					...layer,
					...(layer.id === "layer:front" ? { locked: false } : {}),
				})),
			},
			request,
		)
		const image = await decode(locked.artifacts[0]!.bytes)
		const expected = resolvedRgb(
			initial.swatches.find(({ id }) => id === "swatch:cyan")!,
		)

		expect(locked.artifacts[0]!.bytes).toEqual(unlocked.artifacts[0]!.bytes)
		expect([...image.rgba]).toEqual([
			Math.round(expected.r),
			Math.round(expected.g),
			Math.round(expected.b),
			255,
		])
	})

	it("encodes canonical metadata-free RGBA bytes", async () => {
		const bytes = encodeRgbaPng(1, 1, new Uint8Array([12, 34, 56, 78]))
		expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
		expect(chunks(bytes, "tIME")).toHaveLength(0)
		expect(await decode(bytes)).toEqual({
			width: 1,
			height: 1,
			rgba: new Uint8Array([12, 34, 56, 78]),
		})
		expect(encodeRgbaPng(1, 1, new Uint8Array([12, 34, 56, 78]))).toEqual(bytes)
	})

	it("decodes to exact dimensions and representative transparent/color pixels", async () => {
		const initial = createInitialDocument()
		const document = {
			...initial,
			title: "Pixel fixture",
			artboards: [{ ...initial.artboards[0]!, width: 4, height: 4 }],
			objects: [
				{
					...initial.objects[0]!,
					geometry: {
						kind: "rectangle" as const,
						x: 1,
						y: 1,
						width: 2,
						height: 2,
					},
				},
			],
		}
		const request = { scope: { kind: "all" as const }, samples: 1 as const }
		const first = await exportPng(document, request)
		const second = await exportPng(document, request)
		expect(first.artifacts[0]!.bytes).toEqual(second.artifacts[0]!.bytes)
		expect(
			createHash("sha256").update(first.artifacts[0]!.bytes).digest("hex"),
		).toBe("817bce8acce0b1c69dd558dff47c370706cef392380fab6453c6f2adb58fb4ee")
		const image = await decode(first.artifacts[0]!.bytes)
		expect([image.width, image.height]).toEqual([4, 4])
		expect([...image.rgba.subarray(0, 4)]).toEqual([0, 0, 0, 0])
		expect([
			...image.rgba.subarray((1 * 4 + 1) * 4, (1 * 4 + 1) * 4 + 4),
		]).toEqual([218, 94, 67, 255])
	})

	it("resolves all selection and reversed ranges in document order", () => {
		const first = createInitialDocument()
		const document = {
			...first,
			artboards: [
				first.artboards[0]!,
				{ ...first.artboards[0]!, id: "artboard:two", name: "Two" },
			],
		}
		expect(
			resolvePngArtboards(document, {
				scope: {
					kind: "selected",
					artboardIds: ["artboard:two", "artboard:page"],
				},
			}).map(({ id }) => id),
		).toEqual(["artboard:page", "artboard:two"])
		expect(
			resolvePngArtboards(document, {
				scope: {
					kind: "range",
					startArtboardId: "artboard:two",
					endArtboardId: "artboard:page",
				},
			}).map(({ id }) => id),
		).toEqual(["artboard:page", "artboard:two"])
		expect(pngArtifactFilename(document, document.artboards[1]!, 1, 2)).toBe(
			"untitled-design-02-two.png",
		)
	})

	it("lowers live blend intermediates into the production raster", async () => {
		const initial = createInitialDocument()
		const start = {
			...initial.objects[0]!,
			id: "object:start",
			geometry: { kind: "rectangle" as const, x: 0, y: 0, width: 1, height: 1 },
			transform: { ...initial.objects[0]!.transform, e: 0 },
		}
		const end = {
			...start,
			id: "object:end",
			appearance: { fill: { swatchId: "swatch:paper" } },
			transform: { ...start.transform, e: 3 },
		}
		const points = Array.from({ length: 4 }, (_, index) => ({
			startPointId: `object:start:contour:0:point:${index}`,
			endPointId: `object:end:contour:0:point:${index}`,
		}))
		const document = {
			...initial,
			artboards: [{ ...initial.artboards[0]!, width: 4, height: 1 }],
			objects: [start, end],
			layers: initial.layers.map((layer) => ({
				...layer,
				children: [
					{ kind: "object" as const, id: start.id },
					{ kind: "object" as const, id: end.id },
				],
			})),
			blends: [
				{
					id: "blend:one",
					name: "One step",
					startObjectId: start.id,
					endObjectId: end.id,
					steps: 1,
					contours: [
						{
							startContourId: "object:start:contour:0",
							endContourId: "object:end:contour:0",
							points,
						},
					],
				},
			],
		}
		const request = {
			scope: { kind: "all" },
			samples: 1 as const,
		} as const
		const result = await exportPng(document, request)
		const image = await decode(result.artifacts[0]!.bytes)
		expect([0, 1, 2, 3].map((column) => image.rgba[column * 4 + 3])).toEqual([
			255, 255, 0, 255,
		])

		const hiddenLayer = {
			...document,
			layers: document.layers.map((layer) => ({ ...layer, hidden: true })),
		}
		expect(preflightPngExport(hiddenLayer, request)).toMatchObject({
			decision: "ready",
			diagnostics: [
				{
					code: "png.blend.endpoint.hidden",
					layerId: document.layers[0]!.id,
					severity: "info",
				},
			],
		})
	})

	it("blocks invalid scale, unknown scopes, and excessive allocations", () => {
		const document = createInitialDocument()
		expect(
			preflightPngExport(document, {
				scope: { kind: "active", artboardId: "artboard:missing" },
			}).decision,
		).toBe("blocked")
		expect(
			preflightPngExport(document, {
				scope: { kind: "all" },
				scale: 10_000,
			}).diagnostics.map(({ code }) => code),
		).toContain("png.dimensions.too-large")
	})
})
