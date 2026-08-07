import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { sourceSyncStateFromSnapshot } from "@create-art/source-rpc"
import { resolveDesignArtboardLinks } from "@create-design/model"
import {
	createInitialDocument,
	type DesignDocument,
} from "@create-design/source"
import { afterEach, describe, expect, test } from "vitest"

import { loadDesignLinkedArtboardResources } from "../src/linked-artboard-export.ts"
import { exportDesignPdf } from "../src/pdf-export.ts"
import { exportDesignPng } from "../src/png-export.ts"
import { designSourceTransaction } from "../src/source-sync.ts"
import {
	createDesignSourceService,
	initializeDesignSourceWorkspace,
} from "../src/source-service.ts"
import { exportDesignSvg } from "../src/svg-export.ts"

const temporaryPaths: string[] = []

afterEach(async () => {
	await Promise.all(
		temporaryPaths
			.splice(0)
			.map((path) => rm(path, { force: true, recursive: true })),
	)
})

async function writeDocument(root: string, document: DesignDocument) {
	await initializeDesignSourceWorkspace(root)
	const service = await createDesignSourceService(root, { initialize: false })
	const snapshot = await service.readSnapshot()
	const transaction = designSourceTransaction(
		sourceSyncStateFromSnapshot(snapshot),
		document,
	)
	if (transaction.writes.length + transaction.removals.length === 0) return
	await service.writeUnits({
		idempotencyKey: crypto.randomUUID(),
		...transaction,
	})
}

describe("headless linked-artboard exports", () => {
	test("loads sibling designs and projects heterogeneous artwork for every headless export", async () => {
		const workspace = await mkdtemp(join(tmpdir(), "design-links-export-"))
		temporaryPaths.push(workspace)
		const sourceRoot = join(workspace, "designs", "source")
		const targetRoot = join(workspace, "designs", "target")
		const sourceInitial = createInitialDocument()
		const source = {
			...sourceInitial,
			artboards: [{ ...sourceInitial.artboards[0]!, width: 32, height: 24 }],
			objects: sourceInitial.objects.map((object, index) => ({
				...object,
				geometry: {
					kind: "rectangle" as const,
					x: index * 16,
					y: 0,
					width: 16,
					height: 24,
				},
				transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
			})),
		}
		const targetInitial = createInitialDocument()
		const target = {
			...targetInitial,
			artboards: [{ ...targetInitial.artboards[0]!, width: 32, height: 24 }],
		}
		const link = {
			...target.objects[0]!,
			id: "object:portable-link",
			name: "Source artboard",
			geometry: {
				kind: "artboard-link" as const,
				projectId: "source",
				artboardId: source.artboards[0]!.id,
				width: source.artboards[0]!.width,
				height: source.artboards[0]!.height,
			},
		}
		await writeDocument(sourceRoot, source)
		await writeDocument(targetRoot, {
			...target,
			objects: [link],
			layers: [
				{
					...target.layers[0]!,
					children: [{ kind: "object", id: link.id }],
				},
			],
		})

		const resources = await loadDesignLinkedArtboardResources(targetRoot)
		expect(resources).toHaveLength(2)
		const resolution = resolveDesignArtboardLinks(
			{
				...target,
				objects: [link],
				layers: [
					{
						...target.layers[0]!,
						children: [{ kind: "object", id: link.id }],
					},
				],
			},
			resources,
		)
		expect(
			new Set(
				resolution.document.objects.flatMap(({ appearance }) =>
					appearance.fill === undefined ? [] : [appearance.fill.swatchId],
				),
			).size,
		).toBe(2)
		const output = join(tmpdir(), `linked-${crypto.randomUUID()}.pdf`)
		const svgOutput = join(tmpdir(), `linked-${crypto.randomUUID()}.svg`)
		const pngOutput = join(tmpdir(), `linked-${crypto.randomUUID()}.png`)
		temporaryPaths.push(output, svgOutput, pngOutput)
		await expect(
			exportDesignPdf({ root: targetRoot, output }),
		).resolves.toMatchObject({ pages: 1, preflight: { decision: "ready" } })
		await expect(
			exportDesignSvg({
				root: targetRoot,
				output: svgOutput,
				artboardIds: [target.artboards[0]!.id],
			}),
		).resolves.toMatchObject({ preflight: { decision: "ready" } })
		await expect(
			exportDesignPng({ root: targetRoot, output: pngOutput }),
		).resolves.toMatchObject({ preflight: { decision: "ready" } })
	})

	test("blocks a recursive workspace reference with a cycle-specific export diagnostic", async () => {
		const workspace = await mkdtemp(join(tmpdir(), "design-links-cycle-"))
		temporaryPaths.push(workspace)
		const firstRoot = join(workspace, "designs", "first")
		const secondRoot = join(workspace, "designs", "second")
		const initial = createInitialDocument()
		const linkedDocument = (projectId: string) => {
			const link = {
				...initial.objects[0]!,
				id: `object:link-to-${projectId}`,
				geometry: {
					kind: "artboard-link" as const,
					projectId,
					artboardId: initial.artboards[0]!.id,
					width: initial.artboards[0]!.width,
					height: initial.artboards[0]!.height,
				},
			}
			return {
				...initial,
				objects: [link],
				layers: [
					{
						...initial.layers[0]!,
						children: [{ kind: "object" as const, id: link.id }],
					},
				],
			}
		}
		await writeDocument(firstRoot, linkedDocument("second"))
		await writeDocument(secondRoot, linkedDocument("first"))
		const output = join(tmpdir(), `linked-cycle-${crypto.randomUUID()}.svg`)
		temporaryPaths.push(output)
		await expect(
			exportDesignSvg({
				root: firstRoot,
				output,
				artboardIds: [initial.artboards[0]!.id],
			}),
		).rejects.toMatchObject({
			name: "DesignSvgPreflightError",
			preflight: {
				decision: "blocked",
				diagnostics: expect.arrayContaining([
					expect.objectContaining({ code: "svg.artboard-link.cycle" }),
				]),
			},
		})
	})
})
