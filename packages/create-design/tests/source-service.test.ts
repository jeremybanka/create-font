import { createHash } from "node:crypto"
import { mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { assembleDesignDocument } from "@create-design/source"
import { describe, expect, test } from "vitest"

import {
	createDesignSourceService,
	initializeDesignSourceWorkspace,
} from "../src/source-service.ts"

describe(`create-design source service`, () => {
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
