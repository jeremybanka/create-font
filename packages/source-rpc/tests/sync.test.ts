import { describe, expect, test } from "vitest"

import {
	applySourceSyncDelta,
	sourceSyncStateFromSnapshot,
} from "../src/index.ts"

describe(`source synchronization`, () => {
	test(`applies ordered changes and detects gaps`, () => {
		const state = sourceSyncStateFromSnapshot({
			revision: `one`,
			units: [{ path: `a.json`, revision: `a1`, value: { value: 1 } }],
		})
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
})
