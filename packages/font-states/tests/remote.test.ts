import { describe, expect, it, vi } from "vitest"

import {
	createRemoteFontSourceState,
	type FontSourceRemoteClient,
} from "../src/index.ts"

function createClient(): FontSourceRemoteClient {
	return {
		readSnapshot: vi.fn(async () => ({
			revision: `manifest-1`,
			units: [
				{
					path: `glyphs/a.json`,
					revision: `glyph-a-1`,
					value: { path: `glyphs/a.json` },
				},
			],
		})),
		readManifest: vi.fn(async () => ({
			revision: `manifest-1`,
			units: [
				{ path: `glyphs/a.json`, revision: `glyph-a-1` },
				{ path: `glyphs/b.json`, revision: `glyph-b-1` },
			],
		})),
		readUnit: vi.fn(async (path) => ({
			path,
			revision: `${path}-1`,
			value: { path },
		})),
		writeUnit: vi.fn(async (input) => ({
			path: input.path,
			revision: `${input.path}-2`,
			value: input.value,
		})),
		writeUnits: vi.fn(
			async (input: Parameters<FontSourceRemoteClient["writeUnits"]>[0]) => ({
				previousRevision: `manifest-1`,
				revision: `manifest-2`,
				units: input.writes.map((write: (typeof input.writes)[number]) => ({
					path: write.path,
					revision: `${write.path}-2`,
					value: write.value,
				})) as [
					{
						path: string
						revision: string
						value: (typeof input.writes)[number]["value"]
					},
					...{
						path: string
						revision: string
						value: (typeof input.writes)[number]["value"]
					}[],
				],
			}),
		),
	}
}

describe(`remote font source state`, () => {
	it(`uses each source-unit path as an independent loadable cache key`, async () => {
		const client = createClient()
		const localUnits = new Map<string, unknown>()
		const hydrate = vi.fn((snapshot) => {
			localUnits.set(snapshot.path, snapshot.value)
		})
		const remote = createRemoteFontSourceState({
			client,
			hydrate,
			key: `test/remote/cache`,
		})

		const firstA = await remote.read.unit(`glyphs/a.json`)
		const secondA = await remote.read.unit(`glyphs/a.json`)
		const firstB = await remote.read.unit(`glyphs/b.json`)
		if (firstB instanceof Error) throw firstB

		expect(firstA).toEqual(secondA)
		expect(firstB.path).toBe(`glyphs/b.json`)
		expect(client.readUnit).toHaveBeenCalledTimes(2)
		expect(hydrate).toHaveBeenCalledTimes(2)
		expect(hydrate).toHaveBeenCalledWith(firstA, { reason: `read` })
		expect(localUnits.get(`glyphs/a.json`)).toEqual({
			path: `glyphs/a.json`,
		})
		expect(localUnits.get(`glyphs/b.json`)).toEqual({
			path: `glyphs/b.json`,
		})

		remote.actions.refreshUnit(`glyphs/a.json`)
		await remote.read.unit(`glyphs/a.json`)
		expect(client.readUnit).toHaveBeenCalledTimes(3)
		expect(hydrate).toHaveBeenCalledTimes(3)
	})

	it(`stores the canonical write response and refreshes only the manifest`, async () => {
		const client = createClient()
		const hydrate = vi.fn()
		const remote = createRemoteFontSourceState({
			client,
			hydrate,
			key: `test/remote/write`,
		})
		await remote.read.manifest()

		const written = await remote.actions.writeUnit({
			expectedRevision: `glyph-a-1`,
			idempotencyKey: `write-a-1`,
			path: `glyphs/a.json`,
			value: { id: `glyph:a`, name: `A` },
		})

		expect(await remote.read.unit(`glyphs/a.json`)).toEqual(written)
		expect(client.readUnit).not.toHaveBeenCalled()
		expect(client.readManifest).toHaveBeenCalledTimes(2)
		expect(hydrate).toHaveBeenCalledExactlyOnceWith(written, {
			reason: `write`,
		})
	})

	it(`exposes caught request failures as remote loadable errors`, async () => {
		const client = createClient()
		vi.mocked(client.readUnit).mockRejectedValueOnce(
			new Error(`source unavailable`),
		)
		const remote = createRemoteFontSourceState({
			client,
			key: `test/remote/error`,
		})

		const result = await remote.read.unit(`glyphs/a.json`)

		expect(result).toBeInstanceOf(Error)
		expect(result).toEqual(
			expect.objectContaining({ message: `source unavailable` }),
		)
	})
})
