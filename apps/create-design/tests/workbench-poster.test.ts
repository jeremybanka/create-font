import { resolve } from "node:path"

import { assembleDesignDocument } from "@create-design/source"
import { validatePdf } from "mondrian.pdf"
import { describe, expect, it } from "vitest"

import { createPdfIr, exportPdf } from "@create-design/pdf"
import { exportPng } from "@create-design/png"
import { exportSvg } from "@create-design/svg"
import { createDesignSourceService } from "../src/source-service.ts"

describe("Workbench Poster", () => {
	it("assembles representative layers without changing any supported output", async () => {
		const root = resolve(
			import.meta.dirname,
			"../../../designs/workbench-poster",
		)
		const service = await createDesignSourceService(root, {
			initialize: false,
		})
		const snapshot = await service.readSnapshot()
		const assembled = assembleDesignDocument(
			Object.fromEntries(
				snapshot.units.map(({ path, value }) => [path, value]),
			),
		)
		if (!assembled.ok) {
			throw new Error(
				assembled.errors
					.map(
						({ code, message, unitPath }) =>
							`${code} ${unitPath ?? ""}: ${message}`,
					)
					.join("\n"),
			)
		}

		expect(assembled.value).toMatchObject({
			title: "Counterform No. 1",
			artboards: [
				{
					id: "artboard:page",
					name: "Artboard 1",
					width: 612,
					height: 792,
				},
			],
		})
		expect(assembled.value.swatches).toHaveLength(6)
		expect(assembled.value.objects).toHaveLength(14)
		expect(assembled.value.guides).toHaveLength(7)
		expect(
			assembled.value.layers.map(({ name, children, uiColor }) => ({
				name,
				children: children.length,
				uiColor,
			})),
		).toEqual([
			{ name: "Background", children: 1, uiColor: "red" },
			{ name: "Composition", children: 9, uiColor: "blue" },
			{ name: "Lettering", children: 4, uiColor: "yellow" },
		])
		const recolored = {
			...assembled.value,
			layers: assembled.value.layers.map((layer) => ({
				...layer,
				uiColor: "magenta" as const,
			})),
		}
		const singleton = {
			...assembled.value,
			layers: [
				{
					id: "layer:artwork",
					name: "Artwork",
					children: assembled.value.layers.flatMap(({ children }) => children),
				},
			],
		}
		expect(validatePdf(createPdfIr(assembled.value))).toEqual([])
		const pdf = new TextDecoder().decode(exportPdf(assembled.value))
		expect(pdf.startsWith("%PDF-1.7")).toBe(true)
		expect(pdf).toContain("/MediaBox [0 0 612 792]")
		expect(pdf).toContain("/Title <FEFF")
		expect(exportPdf(assembled.value)).toEqual(exportPdf(singleton))
		expect(exportPdf(assembled.value)).toEqual(exportPdf(recolored))
		expect(exportSvg(assembled.value)).toEqual(exportSvg(singleton))
		expect(exportSvg(assembled.value)).toEqual(exportSvg(recolored))
		const request = { scope: { kind: "all" as const }, samples: 1 as const }
		expect(
			(await exportPng(assembled.value, request)).artifacts[0]?.bytes,
		).toEqual((await exportPng(singleton, request)).artifacts[0]?.bytes)
		expect(
			(await exportPng(assembled.value, request)).artifacts[0]?.bytes,
		).toEqual((await exportPng(recolored, request)).artifacts[0]?.bytes)
	}, 15_000)
})
