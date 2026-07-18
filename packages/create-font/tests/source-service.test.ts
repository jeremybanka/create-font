import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { createHash } from "node:crypto"
import { tmpdir } from "node:os"
import { resolve } from "node:path"

import { afterEach, describe, expect, it } from "bun:test"
import {
	SourceUnitConflictError,
	SourceValidationError,
	type SourceChangedEvent,
} from "@create-font/server"
import { assembleEditorFontSource } from "@create-font/source"
import { createFontEditorState } from "@create-font/states"

import {
	createFileSystemSourceService,
	type SourceProjectLoadDiagnostic,
} from "../src/source-service.ts"
import { discoverFontProjects, selectFontProject } from "../src/workspace.ts"

const temporaryRoots: string[] = []

function revisionForText(text: string): string {
	return `sha256:${createHash(`sha256`).update(text).digest(`hex`)}`
}

async function copyDevelopmentFont() {
	const root = await mkdtemp(resolve(tmpdir(), `create-font-source-`))
	temporaryRoots.push(root)
	const fontsRoot = resolve(root, `fonts`)
	await cp(
		resolve(import.meta.dir, `../../../fonts/workbench-sans`),
		resolve(fontsRoot, `workbench-sans`),
		{ recursive: true },
	)
	return {
		projectRoot: resolve(fontsRoot, `workbench-sans`),
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
				name: `workbench-sans`,
				path: `fonts/workbench-sans`,
			}),
		])
		expect(await selectFontProject(workspaceRoot)).toEqual(
			expect.objectContaining({ name: `workbench-sans` }),
		)
	})
})

describe(`filesystem font source service`, () => {
	it(`reports project-load phases and their operation triggers`, async () => {
		const { projectRoot } = await copyDevelopmentFont()
		const diagnostics: SourceProjectLoadDiagnostic[] = []
		const source = await createFileSystemSourceService(projectRoot, {
			onProjectLoad: (diagnostic) => diagnostics.push(diagnostic),
		})
		const manifest = await source.readManifest()
		await source.readUnit(`names.json`)

		expect(diagnostics.map(({ trigger }) => trigger)).toEqual([
			`initialization`,
			`read-manifest`,
			`read-unit`,
		])
		for (const diagnostic of diagnostics) {
			expect(diagnostic.unitCount).toBe(manifest.units.length)
			expect(diagnostic.totalDuration).toBeGreaterThanOrEqual(
				diagnostic.collectPathsDuration +
					diagnostic.readParseDuration +
					diagnostic.assembleDuration,
			)
		}
	})

	it(`ignores project-load diagnostic observer failures`, async () => {
		const { projectRoot } = await copyDevelopmentFont()
		const source = await createFileSystemSourceService(projectRoot, {
			onProjectLoad: () => {
				throw new Error(`diagnostic observer failure`)
			},
		})

		await expect(source.readManifest()).resolves.toMatchObject({
			units: expect.any(Array),
		})
	})

	it(`returns one coherent snapshot where legacy fan-out can tear`, async () => {
		const { projectRoot } = await copyDevelopmentFont()
		const diagnostics: SourceProjectLoadDiagnostic[] = []
		const source = await createFileSystemSourceService(projectRoot, {
			onProjectLoad: (diagnostic) => diagnostics.push(diagnostic),
		})
		const legacyManifest = await source.readManifest()
		const oldNames = legacyManifest.units.find(
			({ path }) => path === `names.json`,
		)
		expect(oldNames).toBeDefined()

		const namesPath = resolve(projectRoot, `names.json`)
		const namesText = await readFile(namesPath, `utf8`)
		await writeFile(
			namesPath,
			namesText.replace(
				`"family": "Workbench Sans"`,
				`"family": "Workbench Sans Snapshot"`,
			),
		)
		const legacyNames = await source.readUnit(`names.json`)
		expect(legacyNames.revision).not.toBe(oldNames?.revision)

		const project = await source.readSnapshot()
		const snapshotNames = project.units.find(
			({ path }) => path === `names.json`,
		)
		expect(snapshotNames).toEqual(legacyNames)
		for (const unit of project.units) {
			expect(unit.revision).toBe(
				revisionForText(
					await readFile(resolve(projectRoot, unit.path), `utf8`),
				),
			)
		}
		const assembled = assembleEditorFontSource(
			Object.fromEntries(project.units.map((unit) => [unit.path, unit.value])),
		)
		expect(assembled.ok).toBe(true)
		expect(project.revision).toBe(
			revisionForText(
				project.units
					.map((unit) => `${unit.path}\0${unit.revision}\n`)
					.join(``),
			),
		)
		expect(
			diagnostics.filter(({ trigger }) => trigger === `read-snapshot`),
		).toHaveLength(1)
	})

	it(`reads a validated project and writes one revisioned unit`, async () => {
		const { projectRoot } = await copyDevelopmentFont()
		const source = await createFileSystemSourceService(projectRoot)
		const manifest = await source.readManifest()
		const names = await source.readUnit(`names.json`)

		expect(manifest.units.length).toBeGreaterThan(20)
		expect(names.value).toEqual(
			expect.objectContaining({ family: `Workbench Sans` }),
		)

		const updated = await source.writeUnit({
			expectedRevision: names.revision,
			idempotencyKey: `rename-family`,
			path: `names.json`,
			value: {
				...(names.value as Record<string, string>),
				family: `Workbench Sans Test`,
			},
		})

		expect(updated.revision).not.toBe(names.revision)
		expect(updated.value).toEqual(
			expect.objectContaining({ family: `Workbench Sans Test` }),
		)
		expect(
			await readFile(resolve(projectRoot, `names.json`), `utf8`),
		).toContain(`"family": "Workbench Sans Test"`)
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
				family: `Workbench Sans Changed`,
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
				`"family": "Workbench Sans"`,
				`"family": "Workbench Sans External"`,
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
			expect.objectContaining({ family: `Workbench Sans External` }),
		)
	})

	it(`loads and compiles the complete two-master printable ASCII family`, async () => {
		const { projectRoot } = await copyDevelopmentFont()
		const source = await createFileSystemSourceService(projectRoot)
		const manifest = await source.readManifest()
		const entries = await Promise.all(
			manifest.units.map(
				async ({ path }) =>
					[
						path,
						JSON.parse(
							await readFile(resolve(projectRoot, path), `utf8`),
						) as unknown,
					] as const,
			),
		)
		const assembled = assembleEditorFontSource(Object.fromEntries(entries))
		expect(assembled.ok).toBe(true)
		if (!assembled.ok) return

		expect(assembled.value.names.family).toBe(`Workbench Sans`)
		expect(assembled.value.cmap).toHaveLength(95)
		expect(assembled.value.cmap.map(({ codePoint }) => codePoint)).toEqual(
			Array.from({ length: 95 }, (_, index) => 0x20 + index),
		)
		expect(assembled.value.glyphs).toHaveLength(96)
		expect(
			assembled.value.glyphs.every((glyph) => glyph.layers.length === 2),
		).toBe(true)

		const editor = createFontEditorState({ key: `test/workbench-sans` })
		editor.actions.load(assembled.value)
		const compilation = editor.read.compilation()
		expect(compilation.stage).toBe(`compiled`)
		expect(compilation.ok).toBe(true)
		if (!compilation.ok) return
		expect(compilation.source.cmap).toHaveLength(95)
		expect(compilation.source.glyphs).toHaveLength(96)
	})
})
