import { resolve } from "node:path"

import { resolveDesignArtboardLinks } from "@create-design/model"
import { assembleDesignDocument } from "@create-design/source"
import { validatePdf } from "mondrian.pdf"
import { describe, expect, it } from "vitest"

import { createPdfIr, exportPdf } from "@create-design/pdf"
import { exportPng } from "@create-design/png"
import { exportSvg } from "@create-design/svg"
import { loadDesignLinkedArtboardResources } from "../src/linked-artboard-export.ts"
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
		expect(assembled.value.objects).toHaveLength(15)
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
			{ name: "Brand mark", children: 1, uiColor: "purple" },
			{ name: "Lettering", children: 4, uiColor: "yellow" },
		])
		expect(
			assembled.value.objects.find(
				({ id }) => id === "object:create-design-logo",
			),
		).toMatchObject({
			geometry: {
				kind: "artboard-link",
				projectId: "create-design-logo",
				artboardId: "artboard:logo",
			},
			transform: { a: 0.5, d: 0.5, e: 208, f: 60 },
		})
		const resources = await loadDesignLinkedArtboardResources(root)
		const logo = resources.find(
			({ projectId }) => projectId === "create-design-logo",
		)
		expect(logo?.document).toMatchObject({
			title: "create-design logo",
			artboards: [{ id: "artboard:logo", width: 128, height: 128 }],
		})
		const resolved = resolveDesignArtboardLinks(assembled.value, resources)
		expect(resolved.diagnostics).toEqual([])
		expect(
			resolved.document.objects.some(({ id }) =>
				id.includes("object%3Aanchor-node"),
			),
		).toBe(true)
		const outputDocument = resolved.document
		const recolored = {
			...outputDocument,
			layers: outputDocument.layers.map((layer) => ({
				...layer,
				uiColor: "magenta" as const,
			})),
		}
		const singleton = {
			...outputDocument,
			layers: [
				{
					id: "layer:artwork",
					name: "Artwork",
					children: outputDocument.layers.flatMap(({ children }) => children),
				},
			],
		}
		expect(validatePdf(createPdfIr(outputDocument))).toEqual([])
		const pdf = new TextDecoder().decode(exportPdf(outputDocument))
		expect(pdf.startsWith("%PDF-1.7")).toBe(true)
		expect(pdf).toContain("/MediaBox [0 0 612 792]")
		expect(pdf).toContain("/Title <FEFF")
		expect(exportPdf(outputDocument)).toEqual(exportPdf(singleton))
		expect(exportPdf(outputDocument)).toEqual(exportPdf(recolored))
		expect(exportSvg(outputDocument)).toEqual(exportSvg(singleton))
		expect(exportSvg(outputDocument)).toEqual(exportSvg(recolored))
		const request = { scope: { kind: "all" as const }, samples: 1 as const }
		expect(
			(await exportPng(outputDocument, request)).artifacts[0]?.bytes,
		).toEqual((await exportPng(singleton, request)).artifacts[0]?.bytes)
		expect(
			(await exportPng(outputDocument, request)).artifacts[0]?.bytes,
		).toEqual((await exportPng(recolored, request)).artifacts[0]?.bytes)
	}, 15_000)
})
