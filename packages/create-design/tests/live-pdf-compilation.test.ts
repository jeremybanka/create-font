import { PdfValidationError } from "mondrian.pdf"
import { describe, expect, it, vi } from "vitest"

import { createInitialDocument } from "../src/document.ts"
import { createLivePdfCompiler } from "../src/live-pdf-compilation.ts"
import { createPdfProjectionGraph } from "../src/pdf.ts"

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

describe("live PDF compilation", () => {
	it("coalesces queued edits and publishes only the newest generation", async () => {
		const queue = scheduler()
		const graph = createPdfProjectionGraph()
		const project = vi.spyOn(graph, "project")
		const compiler = createLivePdfCompiler({
			graph,
			schedule: queue.schedule,
		})
		const document = createInitialDocument()
		compiler.start()
		compiler.request(document)
		compiler.request({ ...document, title: "Newest" })
		expect(queue.work[0]?.cancelled).toBe(true)
		queue.work[0]?.run()
		queue.work[1]?.run()
		await flush()
		expect(project).toHaveBeenCalledTimes(1)
		expect(compiler.getState()).toMatchObject({
			status: "ready",
			generation: 2,
			revision: 2,
		})
	})

	it("ignores serialization that resolves out of order", async () => {
		const queue = scheduler()
		const resolvers: ((bytes: Uint8Array) => void)[] = []
		const compiler = createLivePdfCompiler({
			schedule: queue.schedule,
			serialize: () =>
				new Promise((resolve) => {
					resolvers.push(resolve)
				}),
		})
		const document = createInitialDocument()
		compiler.start()
		compiler.request(document)
		queue.work[0]?.run()
		await Promise.resolve()
		compiler.request({ ...document, title: "Second" })
		queue.work[1]?.run()
		await Promise.resolve()
		resolvers[1]?.(new Uint8Array([2]))
		await flush()
		expect(compiler.getState()).toMatchObject({
			status: "ready",
			generation: 2,
		})
		resolvers[0]?.(new Uint8Array([1]))
		await flush()
		expect(compiler.getState()).toMatchObject({
			status: "ready",
			generation: 2,
		})
	})

	it("preserves the last good artifact through failure and recovery", async () => {
		const queue = scheduler()
		const compiler = createLivePdfCompiler({ schedule: queue.schedule })
		const document = createInitialDocument()
		compiler.start()
		compiler.request(document)
		queue.work[0]?.run()
		await flush()
		const first = compiler.getState()
		expect(first.status).toBe("ready")
		const invalid = {
			...document,
			objects: [
				{
					...document.objects[0]!,
					appearance: { fill: { swatchId: "swatch:missing" } },
				},
			],
		}
		compiler.request(invalid)
		queue.work[1]?.run()
		expect(compiler.getState()).toMatchObject({
			status: "failed",
			lastGood: first.status === "ready" ? first.artifact : null,
		})
		compiler.request({ ...document, title: "Recovered" })
		queue.work[2]?.run()
		await flush()
		expect(compiler.getState()).toMatchObject({
			status: "ready",
			generation: 3,
		})
	})

	it("preserves the last good artifact after serialization failure", async () => {
		const queue = scheduler()
		let call = 0
		const compiler = createLivePdfCompiler({
			schedule: queue.schedule,
			serialize: () => {
				call++
				if (call === 2) throw new Error("writer unavailable")
				return new Uint8Array([call])
			},
		})
		const document = createInitialDocument()
		compiler.start()
		compiler.request(document)
		queue.work[0]?.run()
		await flush()
		const first = compiler.getState()
		compiler.request({ ...document, title: "Serialization failure" })
		queue.work[1]?.run()
		await flush()
		expect(compiler.getState()).toMatchObject({
			status: "failed",
			diagnostics: [{ message: "writer unavailable", stage: "serialization" }],
			lastGood: first.status === "ready" ? first.artifact : null,
		})
	})

	it("reports Mondrian validation separately from serialization", async () => {
		const queue = scheduler()
		const compiler = createLivePdfCompiler({
			schedule: queue.schedule,
			serialize: () => {
				throw new PdfValidationError([
					{
						code: "invalid-stream",
						message: "Invalid object stream",
						path: "$.objects[1]",
						severity: "error",
					},
				])
			},
		})
		compiler.start()
		compiler.request(createInitialDocument())
		queue.work[0]?.run()
		await flush()
		expect(compiler.getState()).toMatchObject({
			status: "failed",
			diagnostics: [{ message: "Invalid object stream", stage: "validation" }],
		})
	})

	it("does not reserialize an unchanged semantic projection", async () => {
		const queue = scheduler()
		const serialize = vi.fn(() => new Uint8Array([1]))
		const compiler = createLivePdfCompiler({
			schedule: queue.schedule,
			serialize,
		})
		const document = createInitialDocument()
		compiler.start()
		compiler.request(document)
		queue.work[0]?.run()
		await flush()
		const first = compiler.getState()
		compiler.request({
			...document,
			guides: [{ id: "guide:1", axis: "y", value: 30 }],
		})
		queue.work[1]?.run()
		await flush()
		expect(serialize).toHaveBeenCalledTimes(1)
		expect(compiler.getState()).toEqual(first)
	})
})
