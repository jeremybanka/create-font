import { describe, expect, it } from "vitest"

import {
	applySourceSyncDelta,
	sourceSyncStateFromSnapshot,
} from "../public/source-sync.ts"

describe(`direct source synchronization`, () => {
	it(`applies ordered changed and removed units without replacing the snapshot`, () => {
		const names = {
			path: `names.json`,
			revision: `names-1`,
			value: { family: `Workbench Sans` },
		}
		const obsolete = {
			path: `features/obsolete.fea`,
			revision: `obsolete-1`,
			value: `feature liga {} liga;\n`,
		}
		const state = sourceSyncStateFromSnapshot({
			revision: `manifest-1`,
			units: [names, obsolete],
		})

		const result = applySourceSyncDelta(state, {
			type: `source.changed`,
			previousRevision: `manifest-1`,
			removedPaths: [obsolete.path],
			revision: `manifest-2`,
			units: [
				{
					path: names.path,
					revision: `names-2`,
					value: { family: `Workbench Delta Sans` },
				},
			],
		})

		expect(result.status).toBe(`applied`)
		expect(result.state.revision).toBe(`manifest-2`)
		expect(result.state.units.get(names.path)).toEqual(
			expect.objectContaining({
				revision: `names-2`,
				value: { family: `Workbench Delta Sans` },
			}),
		)
		expect(result.state.units.has(obsolete.path)).toBe(false)
		expect(state.units.get(names.path)).toBe(names)
		expect(state.units.has(obsolete.path)).toBe(true)
	})

	it(`ignores duplicate delivery and reports a revision gap`, () => {
		const state = sourceSyncStateFromSnapshot({
			revision: `manifest-2`,
			units: [],
		})
		const duplicate = applySourceSyncDelta(state, {
			type: `source.changed`,
			previousRevision: `manifest-1`,
			removedPaths: [],
			revision: `manifest-2`,
			units: [],
		})
		const gap = applySourceSyncDelta(state, {
			type: `source.changed`,
			previousRevision: `manifest-3`,
			removedPaths: [],
			revision: `manifest-4`,
			units: [],
		})

		expect(duplicate).toEqual({ status: `duplicate`, state })
		expect(gap).toEqual({ status: `gap`, state })
	})
})
