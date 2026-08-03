import { describe, expect, test, vi } from "vitest"

import {
	applySourceSyncDelta,
	refreshWorkingComparison,
	sourceSyncStateFromSnapshot,
} from "../src/index.ts"

describe(`source synchronization`, () => {
	test(`applies ordered changes and detects gaps`, () => {
		const state = sourceSyncStateFromSnapshot({
			revision: `one`,
			units: [{ path: `a.json`, revision: `a1`, value: { value: 1 } }],
		})
		expect(state).not.toHaveProperty(`assets`)
		const applied = applySourceSyncDelta(state, {
			type: `source.changed`,
			previousRevision: `one`,
			removedPaths: [`a.json`],
			revision: `two`,
			units: [{ path: `b.json`, revision: `b1`, value: { value: 2 } }],
		})
		expect(applied.kind).toBe(`applied`)
		expect(applied.state.units.has(`a.json`)).toBe(false)
		expect(applied.state.units.has(`b.json`)).toBe(true)
		expect(
			applySourceSyncDelta(applied.state, {
				type: `source.changed`,
				previousRevision: `missing`,
				removedPaths: [],
				revision: `three`,
				units: [],
			}).kind,
		).toBe(`gap`)
	})

	test(`tracks optional asset deltas without changing JSON-only state`, () => {
		const asset = {
			byteLength: 3,
			digest: `sha256:${`0`.repeat(64)}` as const,
			id: `asset:test`,
			mediaType: `application/octet-stream`,
			path: `assets/test.bin`,
		}
		const state = sourceSyncStateFromSnapshot({
			assets: [asset],
			revision: `one`,
			units: [],
		})
		expect(state.assets?.get(asset.path)).toEqual(asset)
		const removed = applySourceSyncDelta(state, {
			previousRevision: `one`,
			removedAssetPaths: [asset.path],
			removedPaths: [],
			revision: `two`,
			type: `source.changed`,
			units: [],
		})
		expect(removed.state.assets?.size).toBe(0)
	})

	test(`refreshes only comparisons against live source after a source event`, async () => {
		const load = vi.fn(async () => undefined)
		await refreshWorkingComparison({ baseRef: `HEAD` }, load)
		await refreshWorkingComparison(
			{ baseRef: `main`, targetRef: `release` },
			load,
		)
		expect(load).toHaveBeenCalledExactlyOnceWith(`HEAD`)
	})
})
