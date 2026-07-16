import { describe, expect, it, vi } from "vitest"
import { treaty } from "@elysiajs/eden"

import {
	createTrigraphRpc,
	SourceUnitConflictError,
	SourceUnitNotFoundError,
	type TrigraphSourceService,
} from "../src/index.ts"

describe(`Trigraph workspace RPC`, () => {
	it(`serves individual source units through the typed contract`, async () => {
		const source: TrigraphSourceService = {
			readManifest: vi.fn(async () => ({
				revision: `manifest-1`,
				units: [{ path: `glyphs/a.json`, revision: `glyph-a-1` }],
			})),
			readUnit: vi.fn(async (path) => ({
				path,
				revision: `glyph-a-1`,
				value: { id: `glyph:a` },
			})),
			writeUnit: vi.fn(async (input) => ({
				path: input.path,
				revision: `glyph-a-2`,
				value: input.value,
			})),
		}
		const app = createTrigraphRpc({
			build: async () => ({
				ok: true,
				outputs: [],
				root: import.meta.dirname,
			}),
			root: import.meta.dirname,
			source,
		})
		const rpc = treaty(app)

		const manifest = await rpc.api.source.get()
		expect(manifest.error).toBeNull()
		expect(manifest.data).toEqual({
			revision: `manifest-1`,
			units: [{ path: `glyphs/a.json`, revision: `glyph-a-1` }],
		})

		const unit = await rpc.api.source.unit.get({
			query: { path: `glyphs/a.json` },
		})
		expect(unit.error).toBeNull()
		expect(unit.data).toEqual({
			path: `glyphs/a.json`,
			revision: `glyph-a-1`,
			value: { id: `glyph:a` },
		})
		expect(source.readUnit).toHaveBeenCalledExactlyOnceWith(`glyphs/a.json`)
	})

	it(`returns a typed revision conflict for a stale idempotent write`, async () => {
		const source: TrigraphSourceService = {
			readManifest: vi.fn(),
			readUnit: vi.fn(),
			writeUnit: vi.fn(async (input) => {
				throw new SourceUnitConflictError(
					input.path,
					input.expectedRevision,
					`glyph-a-2`,
				)
			}),
		}
		const app = createTrigraphRpc({
			build: vi.fn(),
			source,
		})
		const response = await app.handle(
			new Request(`http://localhost/api/source/unit`, {
				body: JSON.stringify({
					expectedRevision: `glyph-a-1`,
					idempotencyKey: `write-a-1`,
					path: `glyphs/a.json`,
					value: { id: `glyph:a` },
				}),
				headers: { "content-type": `application/json` },
				method: `PUT`,
			}),
		)

		expect(response.status).toBe(409)
		expect(await response.json()).toEqual({
			actualRevision: `glyph-a-2`,
			code: `source.revision_conflict`,
			expectedRevision: `glyph-a-1`,
			message: `Source unit glyphs/a.json changed since it was read.`,
			path: `glyphs/a.json`,
		})
		expect(source.writeUnit).toHaveBeenCalledWith(
			expect.objectContaining({
				idempotencyKey: `write-a-1`,
			}),
		)
	})

	it(`returns a typed not-found response for a missing unit`, async () => {
		const source: TrigraphSourceService = {
			readManifest: vi.fn(),
			readUnit: vi.fn(async (path) => {
				throw new SourceUnitNotFoundError(path)
			}),
			writeUnit: vi.fn(),
		}
		const app = createTrigraphRpc({
			build: vi.fn(),
			source,
		})
		const response = await app.handle(
			new Request(`http://localhost/api/source/unit?path=glyphs/missing.json`),
		)

		expect(response.status).toBe(404)
		expect(await response.json()).toEqual({
			code: `source.unit_not_found`,
			message: `Source unit glyphs/missing.json does not exist.`,
			path: `glyphs/missing.json`,
		})
	})

	it(`keeps the source routes explicit while the directory service is absent`, async () => {
		const app = createTrigraphRpc({
			build: async () => ({
				ok: true,
				outputs: [],
				root: import.meta.dirname,
			}),
		})
		const response = await app.handle(
			new Request(`http://localhost/api/source/unit?path=font.json`),
		)

		expect(response.status).toBe(501)
		expect(await response.json()).toEqual({
			code: `source.not_ready`,
			message: `The font source service has not been configured yet.`,
		})
	})
})
