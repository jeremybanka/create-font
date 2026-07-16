import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { resolve } from "node:path"

import { afterEach, describe, expect, it } from "bun:test"
import {
	SourceUnitConflictError,
	SourceValidationError,
	type SourceChangedEvent,
} from "@create-font/server"

import { createFileSystemSourceService } from "../src/source-service.ts"
import { discoverFontProjects, selectFontProject } from "../src/workspace.ts"

const temporaryRoots: string[] = []

async function copyDevelopmentFont() {
	const root = await mkdtemp(resolve(tmpdir(), `create-font-source-`))
	temporaryRoots.push(root)
	const fontsRoot = resolve(root, `fonts`)
	await cp(
		resolve(import.meta.dir, `../../../fonts/create-font-sans`),
		resolve(fontsRoot, `create-font-sans`),
		{ recursive: true },
	)
	return {
		projectRoot: resolve(fontsRoot, `create-font-sans`),
		workspaceRoot: root,
	}
}

afterEach(async () => {
	await Promise.all(
		temporaryRoots
			.splice(0)
			.map((root) => rm(root, { force: true, recursive: true })),
	)
})

describe(`font workspace discovery`, () => {
	it(`discovers and selects projects below fonts/`, async () => {
		const { workspaceRoot } = await copyDevelopmentFont()

		expect(await discoverFontProjects(workspaceRoot)).toEqual([
			expect.objectContaining({
				name: `create-font-sans`,
				path: `fonts/create-font-sans`,
			}),
		])
		expect(await selectFontProject(workspaceRoot)).toEqual(
			expect.objectContaining({ name: `create-font-sans` }),
		)
	})
})

describe(`filesystem font source service`, () => {
	it(`reads a validated project and writes one revisioned unit`, async () => {
		const { projectRoot } = await copyDevelopmentFont()
		const source = await createFileSystemSourceService(projectRoot)
		const manifest = await source.readManifest()
		const names = await source.readUnit(`names.json`)

		expect(manifest.units.length).toBeGreaterThan(20)
		expect(names.value).toEqual(
			expect.objectContaining({ family: `Create Font Sans` }),
		)

		const updated = await source.writeUnit({
			expectedRevision: names.revision,
			idempotencyKey: `rename-family`,
			path: `names.json`,
			value: {
				...(names.value as Record<string, string>),
				family: `Create Font Sans Test`,
			},
		})

		expect(updated.revision).not.toBe(names.revision)
		expect(updated.value).toEqual(
			expect.objectContaining({ family: `Create Font Sans Test` }),
		)
		expect(
			await readFile(resolve(projectRoot, `names.json`), `utf8`),
		).toContain(`"family": "Create Font Sans Test"`)
	})

	it(`rejects stale revisions and invalid whole-project updates`, async () => {
		const { projectRoot } = await copyDevelopmentFont()
		const source = await createFileSystemSourceService(projectRoot)
		const names = await source.readUnit(`names.json`)
		const masters = await source.readUnit(`masters/index.json`)

		await source.writeUnit({
			expectedRevision: names.revision,
			idempotencyKey: `first-write`,
			path: names.path,
			value: {
				...(names.value as Record<string, string>),
				family: `Create Font Sans Changed`,
			},
		})
		await expect(
			source.writeUnit({
				expectedRevision: names.revision,
				idempotencyKey: `stale-write`,
				path: names.path,
				value: names.value,
			}),
		).rejects.toBeInstanceOf(SourceUnitConflictError)

		await expect(
			source.writeUnit({
				expectedRevision: masters.revision,
				idempotencyKey: `invalid-default-master`,
				path: masters.path,
				value: {
					...(masters.value as Record<string, unknown>),
					defaultMasterId: `master:missing`,
				},
			}),
		).rejects.toBeInstanceOf(SourceValidationError)
		expect(await source.readUnit(masters.path)).toEqual(masters)
	})

	it(`commits related units through one transaction`, async () => {
		const { projectRoot } = await copyDevelopmentFont()
		const source = await createFileSystemSourceService(projectRoot)
		const names = await source.readUnit(`names.json`)
		const style = await source.readUnit(`style.json`)

		const result = await source.writeUnits({
			idempotencyKey: `coordinated-update`,
			writes: [
				{
					expectedRevision: names.revision,
					path: names.path,
					value: {
						...(names.value as Record<string, string>),
						subfamily: `Black`,
					},
				},
				{
					expectedRevision: style.revision,
					path: style.path,
					value: {
						...(style.value as Record<string, boolean | number>),
						bold: true,
						weightClass: 900,
					},
				},
			],
		})

		expect(result.units).toHaveLength(2)
		expect((await source.readUnit(`names.json`)).value).toEqual(
			expect.objectContaining({ subfamily: `Black` }),
		)
		expect((await source.readUnit(`style.json`)).value).toEqual(
			expect.objectContaining({ bold: true, weightClass: 900 }),
		)
	})

	it(`publishes validated source changes made outside the RPC`, async () => {
		const { projectRoot } = await copyDevelopmentFont()
		const source = await createFileSystemSourceService(projectRoot)
		const before = await source.readManifest()
		let unsubscribe = (): void => undefined
		const changed = new Promise<SourceChangedEvent>((resolveChanged) => {
			unsubscribe =
				source.subscribe?.((event) => {
					unsubscribe()
					resolveChanged(event)
				}) ?? unsubscribe
		})
		const namesPath = resolve(projectRoot, `names.json`)
		const namesText = await readFile(namesPath, `utf8`)
		await writeFile(
			namesPath,
			namesText.replace(
				`"family": "Create Font Sans"`,
				`"family": "Create Font Sans External"`,
			),
		)

		const event = await Promise.race([
			changed,
			new Promise<never>((_resolve, reject) => {
				setTimeout(
					() => reject(new Error(`Timed out waiting for source change.`)),
					2_000,
				)
			}),
		])
		expect(event.type).toBe(`source.changed`)
		expect(event.manifest.revision).not.toBe(before.revision)
		expect((await source.readUnit(`names.json`)).value).toEqual(
			expect.objectContaining({ family: `Create Font Sans External` }),
		)
	})
})
