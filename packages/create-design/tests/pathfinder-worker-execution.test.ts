import { describe, expect, it } from "vitest"

import { createInitialDocument } from "../src/document.ts"
import { executePathfinderWorkerRequest } from "../src/pathfinder-worker-execution.ts"
import type {
	PathfinderWorkerRequest,
	PathfinderWorkerResponse,
} from "../src/pathfinder-worker-protocol.ts"

function request(): PathfinderWorkerRequest {
	const document = createInitialDocument()
	return {
		command: "pathfinder-divide",
		context: {
			document,
			directSelection: [],
			objectSelection: document.objects.map(({ id }) => id),
			scopeGroupId: null,
		},
		id: 17,
		idSeed: "pathfinder:deterministic",
	}
}

describe("Pathfinder worker execution", () => {
	it("orders progress before materialization and derives deterministic IDs from its seed", () => {
		const run = () => {
			const responses: PathfinderWorkerResponse[] = []
			executePathfinderWorkerRequest(request(), (response) =>
				responses.push(response),
			)
			return responses
		}
		const first = run()
		expect(first).toEqual(run())
		expect(first.map(({ kind }) => kind)).toEqual([
			"progress",
			"progress",
			"progress",
			"progress",
			"result",
		])
		const progress = first.flatMap((response) =>
			response.kind === "progress" ? [response.progress] : [],
		)
		expect(progress.map(({ phase }) => phase)).toEqual([
			"partitioning",
			"partitioning",
			"partitioning",
			"materializing",
		])
		expect(progress.map(({ completedRegions }) => completedRegions)).toEqual([
			0, 1, 2, 2,
		])
		const result = first.find((response) => response.kind === "result")
		expect(result?.kind === "result" && result.result.ok).toBe(true)
		if (result?.kind !== "result" || !result.result.ok) return
		expect(
			result.result.document.objects.every(({ id }) =>
				id.includes("pathfinder:deterministic"),
			),
		).toBe(true)
	})
})
