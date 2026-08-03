import { afterEach, describe, expect, it, vi } from "vitest"

import {
	createSourcePersistenceScheduler,
	SOURCE_SAVE_QUIET_MS,
} from "../src/source-persistence.ts"

describe("source persistence scheduling", () => {
	afterEach(() => vi.useRealTimers())

	it("projects once after a settled edit burst, not after each gesture", () => {
		vi.useFakeTimers()
		const flush = vi.fn()
		const persistence = createSourcePersistenceScheduler(flush)

		persistence.request()
		vi.advanceTimersByTime(SOURCE_SAVE_QUIET_MS - 1)
		persistence.request()
		vi.advanceTimersByTime(SOURCE_SAVE_QUIET_MS - 1)
		persistence.request()
		expect(flush).not.toHaveBeenCalled()

		vi.advanceTimersByTime(SOURCE_SAVE_QUIET_MS)
		expect(flush).toHaveBeenCalledTimes(1)
	})

	it("cancels a pending projection during teardown", () => {
		vi.useFakeTimers()
		const flush = vi.fn()
		const persistence = createSourcePersistenceScheduler(flush)

		persistence.request()
		persistence.cancel()
		vi.runAllTimers()

		expect(flush).not.toHaveBeenCalled()
	})
})
