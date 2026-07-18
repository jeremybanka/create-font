import { describe, expect, it } from "bun:test"

import {
	createStartupTimeline,
	startupEpochMilliseconds,
	startupTransitDuration,
} from "../public/startup-profile.ts"

describe(`startup performance timeline`, () => {
	it(`records correlated milestones and idempotent phases`, () => {
		let now = 4
		const timeline = createStartupTimeline(`shared-worker`, {
			now: () => now,
			timeOrigin: 1_000,
		})
		timeline.mark(`module-evaluated`)
		const finish = timeline.startPhase(`source-manifest-rpc`)
		now = 14
		expect(finish()).toEqual({
			duration: 10,
			name: `source-manifest-rpc`,
			start: 4,
		})
		now = 20
		expect(finish()).toBe(timeline.snapshot().phases[0])

		const snapshot = timeline.snapshot()
		expect(snapshot.milestones).toEqual({ "module-evaluated": 4 })
		expect(startupEpochMilliseconds(snapshot, `module-evaluated`)).toBe(1_004)
		expect(startupEpochMilliseconds(snapshot, `missing`)).toBeUndefined()
	})

	it(`clamps cross-context transit measurements at zero`, () => {
		expect(startupTransitDuration(1_000, 1_012.5)).toBe(12.5)
		expect(startupTransitDuration(1_012, 1_000)).toBe(0)
	})
})
