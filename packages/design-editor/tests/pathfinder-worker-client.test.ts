import { describe, expect, it, vi } from "vitest"

import { createPathfinderWorkerClient } from "../src/pathfinder-worker-client.ts"
import type {
	PathfinderWorkerRequest,
	PathfinderWorkerResponse,
} from "../src/pathfinder-worker-protocol.ts"
import type { DesignDocument } from "../src/types.ts"

class FakeWorker {
	readonly messages: PathfinderWorkerRequest[] = []
	readonly terminate = vi.fn()
	readonly listeners = {
		error: [] as ((event: ErrorEvent) => void)[],
		message: [] as ((event: MessageEvent<PathfinderWorkerResponse>) => void)[],
	}

	addEventListener(type: "error" | "message", listener: EventListener): void {
		this.listeners[type].push(listener as never)
	}

	postMessage(message: PathfinderWorkerRequest): void {
		this.messages.push(message)
	}

	respond(response: PathfinderWorkerResponse): void {
		for (const listener of this.listeners.message)
			listener(new MessageEvent("message", { data: response }))
	}
}

const input = () => {
	const document = {
		format: "create-design.document" as const,
		objects: [],
	} as unknown as DesignDocument
	return {
		command: "pathfinder-divide" as const,
		context: {
			document,
			directSelection: [],
			objectSelection: [],
			scopeGroupId: "group:editing",
		},
		idSeed: "pathfinder:test",
	}
}

describe("Pathfinder worker client", () => {
	it("streams correlated progress and resolves the worker result", async () => {
		const worker = new FakeWorker()
		const client = createPathfinderWorkerClient({
			createWorker: () => worker as unknown as Worker,
		})
		const progress = vi.fn()
		const task = client.run(input(), progress)
		expect(worker.messages).toEqual([{ ...input(), id: 0 }])

		worker.respond({
			id: 0,
			kind: "progress",
			progress: {
				completedRegions: 1,
				phase: "partitioning",
				pieceCount: 3,
				totalRegions: 2,
			},
		})
		worker.respond({
			id: 0,
			kind: "progress",
			progress: {
				completedRegions: 2,
				phase: "materializing",
				pieceCount: 4,
				totalRegions: 2,
			},
		})
		expect(progress.mock.calls.map(([update]) => update)).toEqual([
			{
				completedRegions: 1,
				phase: "partitioning",
				pieceCount: 3,
				totalRegions: 2,
			},
			{
				completedRegions: 2,
				phase: "materializing",
				pieceCount: 4,
				totalRegions: 2,
			},
		])

		const completed = {
			directSelection: [],
			document: input().context.document,
			message: "Divided 3 paths.",
			objectSelection: [],
			ok: true as const,
		}
		worker.respond({ id: 0, kind: "result", result: completed })
		await expect(task.result).resolves.toEqual({
			result: completed,
			status: "completed",
		})
		expect(worker.terminate).toHaveBeenCalledOnce()
	})

	it("terminates active computation and ignores late worker messages", async () => {
		const worker = new FakeWorker()
		const client = createPathfinderWorkerClient({
			createWorker: () => worker as unknown as Worker,
		})
		const progress = vi.fn()
		const task = client.run(input(), progress)
		task.cancel()
		await expect(task.result).resolves.toEqual({ status: "cancelled" })
		expect(worker.terminate).toHaveBeenCalledOnce()

		worker.respond({
			id: 0,
			kind: "progress",
			progress: {
				completedRegions: 2,
				phase: "materializing",
				pieceCount: 4,
				totalRegions: 2,
			},
		})
		worker.respond({
			id: 0,
			kind: "result",
			result: { error: "Late result.", ok: false },
		})
		expect(progress).not.toHaveBeenCalled()
	})

	it("contains worker startup and runtime failures", async () => {
		const startup = createPathfinderWorkerClient({
			createWorker: () => {
				throw new Error("Worker unavailable.")
			},
		})
		expect(() => startup.run(input(), vi.fn())).toThrow("Worker unavailable")

		const worker = new FakeWorker()
		const runtime = createPathfinderWorkerClient({
			createWorker: () => worker as unknown as Worker,
		})
		const task = runtime.run(input(), vi.fn())
		for (const listener of worker.listeners.error)
			listener(new ErrorEvent("error", { message: "Worker crashed." }))
		await expect(task.result).resolves.toEqual({
			error: "Worker crashed.",
			status: "failed",
		})
		expect(worker.terminate).toHaveBeenCalledOnce()

		const reportedWorker = new FakeWorker()
		const reported = createPathfinderWorkerClient({
			createWorker: () => reportedWorker as unknown as Worker,
		}).run(input(), vi.fn())
		reportedWorker.respond({
			error: "Topology failed.",
			id: 0,
			kind: "failed",
		})
		await expect(reported.result).resolves.toEqual({
			error: "Topology failed.",
			status: "failed",
		})
		expect(reportedWorker.terminate).toHaveBeenCalledOnce()
	})
})
