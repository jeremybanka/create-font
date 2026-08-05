import { createHash } from "node:crypto"
import { mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
	assembleDesignDocument,
	createInitialDocument,
	defaultTextContentUnitPath,
} from "@create-design/source"
import { describe, expect, test } from "vitest"

import {
	createDesignSourceService,
	initializeDesignSourceWorkspace,
} from "../src/source-service.ts"

describe(`create-design source service`, () => {
	test(`publishes external raw-text changes and reloads their exact content`, async () => {
		const root = await mkdtemp(join(tmpdir(), `create-design-source-`))
		const initial = createInitialDocument()
		const textObject = {
			id: `object:watched-text`,
			name: `Watched text`,
			geometry: {
				kind: `text` as const,
				mode: `point` as const,
				text: `before`,
				typography: {
					font: { id: `font:test`, family: `Test` },
					size: 12,
					leading: 14,
					tracking: 0,
					kerning: `auto` as const,
					alignment: `start` as const,
					direction: `auto` as const,
				},
				x: 20,
				y: 30,
			},
			transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
			appearance: { fill: { swatchId: initial.swatches[1]!.id } },
		}
		await initializeDesignSourceWorkspace(root, {
			...initial,
			objects: [...initial.objects, textObject],
			layers: initial.layers.map((layer) => ({
				...layer,
				children: [
					...layer.children,
					{ kind: `object` as const, id: textObject.id },
				],
			})),
		})
		const service = await createDesignSourceService(root, { initialize: false })
		const contentPath = defaultTextContentUnitPath(textObject.id)
		const changed = new Promise<void>((resolveChanged) => {
			const unsubscribe = service.subscribe?.((event) => {
				if (!event.units.some(({ path }) => path === contentPath)) return
				unsubscribe?.()
				resolveChanged()
			})
		})
		const authored = ` \t😀\r\nterminal\n`
		await writeFile(join(root, contentPath), authored)
		await Promise.race([
			changed,
			new Promise<never>((_resolve, reject) =>
				setTimeout(
					() => reject(new Error(`Timed out waiting for source change.`)),
					2_000,
				),
			),
		])
		const snapshot = await service.readSnapshot()
		expect(snapshot.units.find(({ path }) => path === contentPath)?.value).toBe(
			authored,
		)
		const assembled = assembleDesignDocument(
			Object.fromEntries(
				snapshot.units.map(({ path, value }) => [path, value]),
			),
		)
		expect(assembled).toMatchObject({
			ok: true,
			value: {
				objects: expect.arrayContaining([
					expect.objectContaining({
						id: textObject.id,
						geometry: expect.objectContaining({ text: authored }),
					}),
				]),
			},
		})
	})

	test(`publishes byte-preserved assets with their design inventory`, async () => {
		const root = await mkdtemp(join(tmpdir(), `create-design-source-`))
		const service = await createDesignSourceService(root)
		const index = await service.readUnit(`assets/index.json`)
		const bytes = new Uint8Array([0, 255, 137, 80, 78, 71])
		const sha256 = createHash(`sha256`).update(bytes).digest(`hex`)
		const descriptor = {
			byteLength: bytes.byteLength,
			digest: `sha256:${sha256}` as const,
			id: `asset:reference`,
			mediaType: `image/png`,
			path: `assets/reference.png`,
		}
		const staged = await service.stageAsset({
			bytes: (async function* () {
				yield bytes
			})(),
			descriptor,
			operationId: `publish-reference`,
		})
		await service.writeAssets({
			assetWrites: [
				{ expectedDigest: null, stagingToken: staged.stagingToken },
			],
			idempotencyKey: `publish-reference`,
			writes: [
				{
					expectedRevision: index.revision,
					path: index.path,
					value: {
						format: `create-design.asset-index`,
						version: 1,
						entries: [
							{
								byteLength: bytes.byteLength,
								id: descriptor.id,
								mediaType: descriptor.mediaType,
								path: descriptor.path,
								sha256,
							},
						],
					},
				},
			],
		})
		const content = await service.readAsset(descriptor.path)
		expect(content.descriptor).toEqual(descriptor)
		expect(
			new Uint8Array(await new Response(content.bytes).arrayBuffer()),
		).toEqual(bytes)
	})

	test(`initializes and atomically replaces units`, async () => {
		const root = await mkdtemp(join(tmpdir(), `create-design-source-`))
		const service = await createDesignSourceService(root)
		const before = await service.readSnapshot()
		const files = Object.fromEntries(
			before.units.map(({ path, value }) => [path, value]),
		)
		expect(assembleDesignDocument(files).ok).toBe(true)

		const documentUnit = before.units.find(
			({ path }) => path === `document.json`,
		)
		if (documentUnit === undefined) throw new Error(`Missing document unit.`)
		if (
			documentUnit.value === null ||
			typeof documentUnit.value !== `object` ||
			Array.isArray(documentUnit.value)
		)
			throw new Error(`Invalid document unit.`)
		const result = await service.writeUnits({
			idempotencyKey: `rename`,
			writes: [
				{
					expectedRevision: documentUnit.revision,
					path: documentUnit.path,
					value: { ...documentUnit.value, title: `Stored on disk` },
				},
			],
		})
		expect(result.previousRevision).toBe(before.revision)
		expect(result.removedPaths).toEqual([])
		expect(await readFile(join(root, `document.json`), `utf8`)).toContain(
			`Stored on disk`,
		)
	})

	test(`rejects traversal and stale revisions without partial writes`, async () => {
		const root = await mkdtemp(join(tmpdir(), `create-design-source-`))
		const service = await createDesignSourceService(root)
		const before = await service.readSnapshot()
		await expect(
			service.writeUnits({
				idempotencyKey: `unsafe`,
				writes: [
					{
						expectedRevision: null,
						path: `../outside.json`,
						value: {},
					},
				],
			}),
		).rejects.toMatchObject({ name: `SourceUnitNotFoundError` })
		expect((await service.readSnapshot()).revision).toBe(before.revision)
		await expect(
			service.writeUnits({
				idempotencyKey: `orphan-text`,
				writes: [
					{
						expectedRevision: null,
						path: `scene/objects/orphan.txt`,
						value: `must not persist`,
					},
				],
			}),
		).rejects.toMatchObject({ name: `SourceValidationError` })
		await expect(
			readFile(join(root, `scene/objects/orphan.txt`), `utf8`),
		).rejects.toMatchObject({ code: `ENOENT` })
		expect((await service.readSnapshot()).revision).toBe(before.revision)
	})

	test(`preserves external layout until an affected unit is written`, async () => {
		const root = await mkdtemp(join(tmpdir(), `create-design-source-`))
		await initializeDesignSourceWorkspace(root)
		const documentPath = join(root, `document.json`)
		const palettePath = join(root, `palette.json`)
		const compactDocument = `${JSON.stringify(
			JSON.parse(await readFile(documentPath, `utf8`)),
		)}\n`
		const compactPalette = `${JSON.stringify(
			JSON.parse(await readFile(palettePath, `utf8`)),
		)}\n`
		await writeFile(documentPath, compactDocument)
		await writeFile(palettePath, compactPalette)

		const service = await createDesignSourceService(root, { initialize: false })
		const before = await service.readUnit(`document.json`)
		expect(await readFile(documentPath, `utf8`)).toBe(compactDocument)

		const updated = await service.writeUnit({
			expectedRevision: before.revision,
			idempotencyKey: `format-one-unit`,
			path: before.path,
			value: {
				...(before.value as Record<string, unknown>),
				title: `Formatted`,
			},
		})
		const finalText = await readFile(documentPath, `utf8`)
		expect(finalText).toMatch(/^\{\n\t"format":/u)
		expect(finalText.endsWith(`\n`)).toBe(true)
		expect(finalText.endsWith(`\n\n`)).toBe(false)
		expect(updated.revision).toBe(
			`sha256:${createHash(`sha256`).update(finalText).digest(`hex`)}`,
		)
		expect(await readFile(palettePath, `utf8`)).toBe(compactPalette)
	})
})
