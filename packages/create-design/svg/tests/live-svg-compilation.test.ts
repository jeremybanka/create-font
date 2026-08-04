import { describe, expect, it, vi } from "vitest"

import { createInitialDocument } from "@create-design/source"
import { createLiveSvgCompiler } from "../src/index.ts"

function scheduler() {
	const work: { cancelled: boolean; run: () => void }[] = []
	return {
		schedule(run: () => void) {
			const item = { cancelled: false, run }
			work.push(item)
			return () => {
				item.cancelled = true
			}
		},
		work,
	}
}

const flush = async () => {
	await Promise.resolve()
	await Promise.resolve()
}

describe("live SVG compilation", () => {
	it("coalesces edits and rejects stale serialization generations", async () => {
		const queue = scheduler()
		const resolvers: ((value: string) => void)[] = []
		const compiler = createLiveSvgCompiler({
			schedule: queue.schedule,
			serialize: () => new Promise((resolve) => resolvers.push(resolve)),
		})
		const document = createInitialDocument()
		compiler.start()
		compiler.request(document)
		compiler.request({ ...document, title: "second" })
		expect(queue.work[0]?.cancelled).toBe(true)
		queue.work[0]?.run()
		queue.work[1]?.run()
		await Promise.resolve()
		compiler.request({ ...document, title: "third" })
		queue.work[2]?.run()
		await Promise.resolve()
		resolvers[0]?.("stale")
		await flush()
		expect(compiler.getState()).toMatchObject({
			status: "compiling",
			generation: 3,
		})
		resolvers[1]?.("newest")
		await flush()
		expect(compiler.getState()).toMatchObject({
			status: "ready",
			generation: 3,
		})
	})

	it("keeps the last good artifact through projection and serialization failures", async () => {
		const queue = scheduler()
		let serialize = 0
		const compiler = createLiveSvgCompiler({
			schedule: queue.schedule,
			serialize: (projection) => {
				serialize++
				if (projection.title === "fail") throw new Error("writer unavailable")
				return "<svg/>"
			},
		})
		const document = createInitialDocument()
		compiler.start()
		compiler.request(document)
		queue.work[0]?.run()
		await flush()
		const first = compiler.getState()
		compiler.request({ ...document, title: "fail" })
		queue.work[1]?.run()
		await flush()
		expect(compiler.getState()).toMatchObject({
			status: "failed",
			diagnostics: [{ stage: "serialization", message: "writer unavailable" }],
			lastGood: first.status === "ready" ? first.artifact : null,
		})
		expect(serialize).toBe(2)
	})

	it("reports queue, projection, serialization, and total timings", async () => {
		const queue = scheduler()
		let time = 0
		const compiler = createLiveSvgCompiler({
			schedule: queue.schedule,
			now: () => time++,
		})
		compiler.start()
		compiler.request(createInitialDocument())
		queue.work[0]?.run()
		await flush()
		expect(compiler.getState()).toMatchObject({
			status: "ready",
			artifact: {
				timings: { queueing: 1, projection: 1, serialization: 1, total: 3 },
			},
		})
	})

	it("releases queued work on stop", () => {
		const queue = scheduler()
		const compiler = createLiveSvgCompiler({ schedule: queue.schedule })
		const subscriber = vi.fn()
		compiler.subscribe(subscriber)
		compiler.start()
		compiler.request(createInitialDocument())
		compiler.stop()
		expect(queue.work[0]?.cancelled).toBe(true)
		queue.work[0]?.run()
		expect(compiler.getState().status).toBe("compiling")
	})
})
