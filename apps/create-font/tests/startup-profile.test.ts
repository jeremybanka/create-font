import { describe, expect, it } from "vitest"

import { createStartupTimeline } from "../public/startup-profile.ts"

describe(`startup performance timeline`, () => {
	it(`records correlated milestones and idempotent phases`, () => {
		let now = 4
		const timeline = createStartupTimeline(`browser-main`, {
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
	})
})
