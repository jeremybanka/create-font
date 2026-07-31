import type {
	CommitSourceUnitsInput,
	ReadSourceComparisonInput,
	SourceChangeGroup,
	SourceComparison,
} from "@create-art/source-rpc"
import { describe, expect, it, vi } from "vitest"

import {
	createDesignVersionControlStore,
	type DesignVersionControlSession,
} from "../src/design-version-control.ts"

const changes: readonly SourceChangeGroup[] = [
	{
		change: "modified",
		id: "object:poster",
		kind: "object",
		label: "Poster",
		paths: ["scene/objects/poster.json"],
	},
]

function comparison(
	input: ReadSourceComparisonInput,
	identity = `${input.baseRef}:${input.targetRef ?? "working"}`,
): SourceComparison {
	const snapshot = { revision: identity, units: [] }
	return {
		base: {
			identity: `base:${input.baseRef}`,
			kind: "ref",
			label: input.baseRef,
			ref: input.baseRef,
			snapshot,
		},
		changes,
		identity,
		target:
			input.targetRef === undefined
				? {
						identity: "working",
						kind: "working",
						label: "Working source",
						snapshot,
					}
				: {
						identity: `target:${input.targetRef}`,
						kind: "ref",
						label: input.targetRef,
						ref: input.targetRef,
						snapshot,
					},
	}
}

function fakeSession(
	overrides: Partial<DesignVersionControlSession> = {},
): DesignVersionControlSession & { emit(): void } {
	let listener = (): void => undefined
	return {
		commitUnits: vi.fn(async (input: CommitSourceUnitsInput) => ({
			commit: "commit",
			comparison: comparison({ baseRef: "HEAD" }, `after:${input.message}`),
		})),
		emit: () => listener(),
		readComparison: vi.fn(async (input) => comparison(input)),
		subscribeSourceChange(next) {
			listener = next
			return () => {
				listener = (): void => undefined
			}
		},
		...overrides,
	}
}

describe("create-design version-control controller", () => {
	it("loads HEAD and refreshes live, but leaves immutable ref comparisons stable", async () => {
		const session = fakeSession()
		const store = createDesignVersionControlStore(session)
		const states = vi.fn()
		store.subscribe(states)
		const stop = store.start()
		await vi.waitFor(() =>
			expect(session.readComparison).toHaveBeenCalledWith({ baseRef: "HEAD" }),
		)

		session.emit()
		await vi.waitFor(() =>
			expect(session.readComparison).toHaveBeenCalledTimes(2),
		)
		await store.controller().onCompare("main", "release")
		expect(store.controller().comparison?.target).toMatchObject({
			kind: "ref",
			label: "release",
		})
		session.emit()
		await Promise.resolve()
		expect(session.readComparison).toHaveBeenCalledTimes(3)
		expect(states).toHaveBeenCalled()
		stop()
	})

	it("commits exactly the complete nominated paths and installs the returned comparison", async () => {
		const session = fakeSession()
		const store = createDesignVersionControlStore(session)
		await store.controller().onCommit({
			expectedComparisonIdentity: "reviewed",
			message: "Commit poster",
			paths: ["assets/index.json", "assets/poster.png"],
		})
		expect(session.commitUnits).toHaveBeenCalledWith({
			expectedComparisonIdentity: "reviewed",
			message: "Commit poster",
			paths: ["assets/index.json", "assets/poster.png"],
		})
		expect(store.controller().comparison?.identity).toBe("after:Commit poster")
	})

	it("refreshes a stale live comparison before returning a recoverable commit error", async () => {
		const session = fakeSession({
			commitUnits: vi.fn(async () => {
				throw new Error("The working source changed after review began.")
			}),
		})
		const store = createDesignVersionControlStore(session)
		await store.controller().onCompare("HEAD")
		await expect(
			store.controller().onCommit({
				expectedComparisonIdentity: "stale",
				message: "Keep this message",
				paths: ["scene/objects/poster.json"],
			}),
		).rejects.toThrow("working source changed")
		expect(session.readComparison).toHaveBeenCalledTimes(2)
		expect(store.controller().comparison?.identity).toBe("HEAD:working")
	})

	it("keeps the prior comparison visible with an actionable ref error", async () => {
		let fail = false
		const session = fakeSession({
			readComparison: vi.fn(async (input) => {
				if (fail) throw new Error('Git ref "missing" does not resolve.')
				return comparison(input)
			}),
		})
		const store = createDesignVersionControlStore(session)
		await store.controller().onCompare("HEAD")
		fail = true
		await store.controller().onCompare("missing")
		expect(store.controller().comparison?.identity).toBe("HEAD:working")
		expect(store.controller().error).toContain(
			"workspace is in a Git repository with an initial commit",
		)
	})
})
