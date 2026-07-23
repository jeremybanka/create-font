import { describe, expect, it, vi } from "vitest"

import { refreshWorkingComparison } from "../public/version-control-refresh.ts"

describe(`version-control comparison refresh`, () => {
	it(`reloads the active HEAD-to-working comparison after an editor save`, async () => {
		const load = vi.fn(async () => undefined)

		await refreshWorkingComparison({ baseRef: `HEAD` }, load)

		expect(load).toHaveBeenCalledTimes(1)
		expect(load).toHaveBeenCalledWith(`HEAD`)
	})

	it(`does not replace an explicit immutable ref comparison after a save`, async () => {
		const load = vi.fn(async () => undefined)

		await refreshWorkingComparison(
			{ baseRef: `main`, targetRef: `feature` },
			load,
		)

		expect(load).not.toHaveBeenCalled()
	})
})
