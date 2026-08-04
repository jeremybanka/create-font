import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
	sourceSyncStateFromSnapshot,
	type JsonValue,
} from "@create-art/source-rpc"
import { createSourceRpcClient } from "@create-art/source-rpc/client"
import {
	formatSourceUnit,
	sourceUnitKindForPath,
	splitDesignDocument,
} from "@create-design/source"
import { afterEach, describe, expect, test, vi } from "vitest"

import { createInitialDocument } from "@create-design/source"
import { createDesignServerApp } from "../src/server.ts"
import {
	designSourceTransaction,
	installDesignSourceFont,
} from "../src/source-sync.ts"

const roots: string[] = []

afterEach(async () => {
	vi.unstubAllGlobals()
	await Promise.all(
		roots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
	)
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

	test(`does not rewrite semantically unchanged canonical units`, () => {
		expect(
			designSourceTransaction(initialState(), createInitialDocument()),
		).toEqual({ removals: [], writes: [] })
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
		})
		expect(transaction.removals).toHaveLength(1)
		expect(transaction.removals[0]?.path).toContain(`scene/objects/`)
		expect(transaction.writes.map(({ path }) => path)).toEqual([
			`scene/layers/artwork.json`,
			`scene/objects/index.json`,
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
