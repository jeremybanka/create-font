import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
	sourceSyncStateFromSnapshot,
	type JsonValue,
} from "@create-art/source-rpc"
import { createSourceRpcClient } from "@create-art/source-rpc/client"
import { preflightPdfExport } from "@create-design/pdf"
import {
	assembleDesignDocument,
	defaultObjectUnitPath,
	defaultTextContentUnitPath,
	formatSourceUnit,
	sourceUnitKindForPath,
	splitDesignDocument,
} from "@create-design/source"
import { createDesignTextService } from "@create-design/text"
import { afterEach, describe, expect, test, vi } from "vitest"

import { createInitialDocument } from "@create-design/source"
import {
	createDesignTextObject,
	DEFAULT_DESIGN_TEXT_TYPOGRAPHY,
	updateDesignText,
} from "../../../packages/create-design/editor/src/design-text.ts"
import { exportDesignPdf } from "../src/pdf-export.ts"
import { createDesignServerApp } from "../src/server.ts"
import {
	designSourceTransaction,
	installDesignSourceFont,
	loadDesignSourceFonts,
} from "../src/source-sync.ts"
import { createTextFontFixtureBytes } from "./fixtures/text-font.ts"

const roots: string[] = []
const outputs: string[] = []

afterEach(async () => {
	vi.unstubAllGlobals()
	await Promise.all(
		roots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
	)
	await Promise.all(outputs.splice(0).map((path) => rm(path, { force: true })))
})

function initialState(document = createInitialDocument()) {
	const split = splitDesignDocument(document)
	if (!split.ok) throw new Error(`Could not split fixture.`)
	return sourceSyncStateFromSnapshot({
		revision: `project`,
		units: Object.entries(split.value).map(([path, value]) => {
			const kind = sourceUnitKindForPath(path)
			if (kind === null) throw new Error(`Unknown fixture unit.`)
			const formatted = formatSourceUnit(kind, value)
			if (!formatted.ok) throw new Error(`Could not format fixture.`)
			return {
				path,
				revision: `revision:${path}`,
				value: value as JsonValue,
			}
		}),
	})
}

describe(`create-design source synchronization`, () => {
	test(`installs a font through the real RPC as one atomic transaction`, async () => {
		const root = await mkdtemp(join(tmpdir(), `create-design-font-install-`))
		roots.push(root)
		const app = await createDesignServerApp({ root })
		vi.stubGlobal(`fetch`, (input: RequestInfo | URL, init?: RequestInit) =>
			app.handle(input instanceof Request ? input : new Request(input, init)),
		)
		const client = createSourceRpcClient(`http://localhost`)
		const state = sourceSyncStateFromSnapshot(await client.readSnapshot())
		const bytes = new Uint8Array([79, 84, 84, 79, 0, 1, 2, 3])

		const installed = await installDesignSourceFont(
			client,
			state,
			{ id: `font:fixture`, family: `Fixture`, revision: 1 },
			bytes,
			`Fixture.otf`,
		)

		expect(installed.reference.revision).toMatch(/^sha256:/u)
		expect(
			new Uint8Array(await readFile(join(root, `fonts/fixture.otf`))),
		).toEqual(bytes)
		expect(
			JSON.parse(await readFile(join(root, `fonts/index.json`), `utf8`)),
		).toMatchObject({
			entries: [
				{
					byteLength: bytes.byteLength,
					id: `font:fixture`,
					mediaType: `font/otf`,
					path: `fonts/fixture.otf`,
				},
			],
			format: `create-design.font-index`,
			version: 1,
		})
		expect(
			await readdir(join(root, `.create-design`, `asset-staging`)),
		).toEqual([])
	})

	test(`leaves no staged or canonical font behind after a rejected promotion`, async () => {
		const root = await mkdtemp(join(tmpdir(), `create-design-font-reject-`))
		roots.push(root)
		const app = await createDesignServerApp({ root })
		vi.stubGlobal(`fetch`, (input: RequestInfo | URL, init?: RequestInit) =>
			app.handle(input instanceof Request ? input : new Request(input, init)),
		)
		const client = createSourceRpcClient(`http://localhost`)
		const state = sourceSyncStateFromSnapshot(await client.readSnapshot())
		const indexPath = join(root, `fonts/index.json`)
		await writeFile(indexPath, `${await readFile(indexPath, `utf8`)}\n`)

		await expect(
			installDesignSourceFont(
				client,
				state,
				{ id: `font:rejected`, family: `Rejected`, revision: 1 },
				new Uint8Array([79, 84, 84, 79]),
				`Rejected.otf`,
			),
		).rejects.toThrow(`changed since it was read`)
		expect(JSON.parse(await readFile(indexPath, `utf8`))).toMatchObject({
			entries: [],
		})
		await expect(
			readFile(join(root, `fonts/rejected.otf`)),
		).rejects.toMatchObject({ code: `ENOENT` })
		expect(
			await readdir(join(root, `.create-design`, `asset-staging`)),
		).toEqual([])
	})

	test(`persists shaped point and area text through restart and PDF export`, async () => {
		const root = await mkdtemp(join(tmpdir(), `create-design-text-workflow-`))
		roots.push(root)
		let app = await createDesignServerApp({ root })
		const routeFetch = (input: RequestInfo | URL, init?: RequestInit) =>
			app.handle(input instanceof Request ? input : new Request(input, init))
		vi.stubGlobal(`fetch`, routeFetch)
		let client = createSourceRpcClient(`http://localhost`)
		let state = sourceSyncStateFromSnapshot(await client.readSnapshot())
		const bytes = createTextFontFixtureBytes()
		const installed = await installDesignSourceFont(
			client,
			state,
			{
				id: `font:workspace-fixture`,
				family: `Workspace Fixture`,
				revision: 1,
			},
			bytes,
			`Workspace Fixture.otf`,
		)
		state = sourceSyncStateFromSnapshot(await client.readSnapshot())
		const assembled = assembleDesignDocument(
			Object.fromEntries(
				[...state.units].map(([path, unit]) => [path, unit.value]),
			),
		)
		if (!assembled.ok) throw new Error(JSON.stringify(assembled.errors))
		const appearance = { fill: { swatchId: assembled.value.swatches[1]!.id } }
		const typography = {
			...DEFAULT_DESIGN_TEXT_TYPOGRAPHY,
			font: installed.reference,
		}
		const point = updateDesignText(
			createDesignTextObject({
				id: `object:point-fixture`,
				name: `Point text`,
				mode: `point`,
				x: 100,
				y: 150,
				appearance,
				text: `Hello world`,
				typography,
			}),
			`Hello world point edited`,
		)
		const area = updateDesignText(
			createDesignTextObject({
				id: `object:area-fixture`,
				name: `Area text`,
				mode: `area`,
				x: 100,
				y: 250,
				width: 300,
				height: 100,
				appearance,
				text: `Hello world`,
				typography,
			}),
			`Hello world area edited`,
		)
		const transaction = designSourceTransaction(state, {
			...assembled.value,
			objects: [...assembled.value.objects, point, area],
			layers: assembled.value.layers.map((layer, index, layers) =>
				index === layers.length - 1
					? {
							...layer,
							children: [
								...layer.children,
								{ kind: `object`, id: point.id },
								{ kind: `object`, id: area.id },
							],
						}
					: layer,
			),
		})
		await expect(
			client.writeUnits({
				idempotencyKey: crypto.randomUUID(),
				...transaction,
			}),
		).resolves.toMatchObject({ removedPaths: [] })
		expect(
			await readFile(
				join(root, defaultTextContentUnitPath(`object:point-fixture`)),
				`utf8`,
			),
		).toBe(`Hello world point edited`)
		const storedPoint = JSON.parse(
			await readFile(
				join(root, defaultObjectUnitPath(`object:point-fixture`)),
				`utf8`,
			),
		) as { geometry: Record<string, unknown> }
		expect(storedPoint.geometry).not.toHaveProperty(`text`)
		expect(storedPoint.geometry).toMatchObject({
			contentPath: defaultTextContentUnitPath(`object:point-fixture`),
		})

		app = await createDesignServerApp({ root })
		client = createSourceRpcClient(`http://localhost`)
		state = sourceSyncStateFromSnapshot(await client.readSnapshot())
		const restarted = assembleDesignDocument(
			Object.fromEntries(
				[...state.units].map(([path, unit]) => [path, unit.value]),
			),
		)
		if (!restarted.ok) throw new Error(JSON.stringify(restarted.errors))
		const textObjects = restarted.value.objects.filter(
			(object) => object.geometry.kind === `text`,
		)
		expect(
			textObjects.map((object) =>
				object.geometry.kind === `text`
					? [object.geometry.text, object.geometry.typography.font]
					: null,
			),
		).toEqual([
			[`Hello world point edited`, installed.reference],
			[`Hello world area edited`, installed.reference],
		])
		const textService = createDesignTextService()
		const reloadedFonts = await loadDesignSourceFonts(client, state)
		expect(reloadedFonts).toHaveLength(1)
		expect(reloadedFonts[0]?.reference).toEqual(installed.reference)
		expect(reloadedFonts[0]?.bytes).toEqual(bytes)
		expect(
			textService.registerFont(
				reloadedFonts[0]!.reference,
				reloadedFonts[0]!.bytes,
			),
		).toEqual([])
		const layouts = textObjects.map((object) => textService.layout(object))
		expect(layouts.every((layout) => layout?.diagnostics.length === 0)).toBe(
			true,
		)
		expect(
			layouts.some((layout) =>
				layout?.glyphs.some(
					(glyph) => glyph.contours.length === 0 && glyph.advanceX > 0,
				),
			),
		).toBe(true)
		const preflight = preflightPdfExport(
			restarted.value,
			{ scope: { kind: `all` } },
			{},
			textService,
		)
		expect(preflight).toMatchObject({
			decision: `ready`,
			diagnostics: [],
			summary: { errors: 0 },
		})
		const output = join(
			tmpdir(),
			`create-design-text-${crypto.randomUUID()}.pdf`,
		)
		outputs.push(output)
		await expect(exportDesignPdf({ output, root })).resolves.toMatchObject({
			pages: 1,
			preflight: { decision: `ready`, diagnostics: [] },
		})
		expect(
			JSON.parse(await readFile(join(root, `fonts/index.json`), `utf8`))
				.entries,
		).toHaveLength(1)
		expect(
			await readdir(join(root, `.create-design`, `asset-staging`)),
		).toEqual([])
	})

	test(`does not rewrite semantically unchanged canonical units`, () => {
		expect(
			designSourceTransaction(initialState(), createInitialDocument()),
		).toEqual({ removals: [], writes: [] })
	})

	test(`atomically adds, edits, copies, renames, and deletes raw text units`, () => {
		const initial = createInitialDocument()
		const appearance = { fill: { swatchId: initial.swatches[1]!.id } }
		const first = createDesignTextObject({
			id: `object:raw-first`,
			name: `Raw first`,
			mode: `point`,
			x: 30,
			y: 40,
			appearance,
			text: `A😀\r\nterminal\n`,
		})
		const withFirst = {
			...initial,
			objects: [...initial.objects, first],
			layers: initial.layers.map((layer) => ({
				...layer,
				children: [
					...layer.children,
					{ kind: `object` as const, id: first.id },
				],
			})),
		}
		const added = designSourceTransaction(initialState(), withFirst)
		const firstJson = defaultObjectUnitPath(first.id)
		const firstText = defaultTextContentUnitPath(first.id)
		expect(added.writes.map(({ path }) => path)).toEqual(
			expect.arrayContaining([firstJson, firstText]),
		)
		expect(added.writes.find(({ path }) => path === firstText)?.value).toBe(
			`A😀\r\nterminal\n`,
		)
		expect(
			added.writes.find(({ path }) => path === firstJson)?.value,
		).not.toHaveProperty(`geometry.text`)

		const firstState = initialState(withFirst)
		const contentOnly = designSourceTransaction(firstState, {
			...withFirst,
			objects: withFirst.objects.map((object) =>
				object.id === first.id
					? updateDesignText(first, `changed only`)
					: object,
			),
		})
		expect(contentOnly).toMatchObject({ removals: [] })
		expect(contentOnly.writes.map(({ path }) => path)).toEqual([firstText])

		const renamedAndEdited = designSourceTransaction(firstState, {
			...withFirst,
			objects: withFirst.objects.map((object) =>
				object.id === first.id
					? { ...updateDesignText(first, `renamed edit`), name: `Renamed` }
					: object,
			),
		})
		expect(renamedAndEdited.writes.map(({ path }) => path).toSorted()).toEqual(
			[firstJson, firstText].toSorted(),
		)

		const copy = { ...first, id: `object:raw-copy`, name: `Raw copy` }
		const copied = designSourceTransaction(firstState, {
			...withFirst,
			objects: [...withFirst.objects, copy],
			layers: withFirst.layers.map((layer) => ({
				...layer,
				children: [...layer.children, { kind: `object` as const, id: copy.id }],
			})),
		})
		expect(copied.writes.map(({ path }) => path)).toEqual(
			expect.arrayContaining([
				defaultObjectUnitPath(copy.id),
				defaultTextContentUnitPath(copy.id),
			]),
		)
		expect(defaultTextContentUnitPath(copy.id)).not.toBe(firstText)

		const deleted = designSourceTransaction(firstState, initial)
		expect(deleted.removals.map(({ path }) => path).toSorted()).toEqual(
			[firstJson, firstText].toSorted(),
		)
		expect(deleted.writes.map(({ path }) => path)).toEqual([
			`scene/objects/index.json`,
			`scene/layers/artwork.json`,
		])
	})

	test(`writes only the changed metadata unit`, () => {
		const document = createInitialDocument()
		const transaction = designSourceTransaction(initialState(), {
			...document,
			title: `Renamed`,
		})
		expect(transaction.removals).toEqual([])
		expect(transaction.writes.map(({ path }) => path)).toEqual([
			`document.json`,
		])
	})

	test(`removes an object and updates only its inventories`, () => {
		const document = createInitialDocument()
		const transaction = designSourceTransaction(initialState(), {
			...document,
			objects: document.objects.slice(1),
			layers: document.layers.map((layer) => ({
				...layer,
				children: layer.children.filter(
					(child) =>
						child.kind !== `object` || child.id !== document.objects[0]!.id,
				),
			})),
		})
		expect(transaction.removals).toHaveLength(1)
		expect(transaction.removals[0]?.path).toContain(`scene/objects/`)
		expect(transaction.writes.map(({ path }) => path)).toEqual([
			`scene/objects/index.json`,
			`scene/layers/artwork.json`,
		])
	})

	test(`persists artboard edits and order without rewriting object units`, () => {
		const document = createInitialDocument()
		const first = document.artboards[0]!
		const withTwo = {
			...document,
			artboards: [
				first,
				{
					id: `artboard:social`,
					name: `Social square`,
					x: 700,
					y: 20,
					width: 500,
					height: 500,
				},
			],
		}
		const state = initialState(withTwo)
		const renamed = designSourceTransaction(state, {
			...withTwo,
			artboards: [first, { ...withTwo.artboards[1]!, name: `Feed square` }],
		})
		expect(renamed.removals).toEqual([])
		expect(renamed.writes.map(({ path }) => path)).toEqual([
			expect.stringMatching(/^artboards\/(?!index\.json)/u),
		])

		const reordered = designSourceTransaction(state, {
			...withTwo,
			artboards: withTwo.artboards.toReversed(),
		})
		expect(reordered.removals).toEqual([])
		expect(reordered.writes.map(({ path }) => path)).toEqual([
			`artboards/index.json`,
		])
	})
})
