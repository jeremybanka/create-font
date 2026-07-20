import type { PointId } from "@create-font/states"
import { describe, expect, it } from "vitest"

import {
	combineMarqueeSelection,
	marqueeSelectionMode,
	type EditorSelectionTarget,
} from "../src/outline-selection.ts"

const node = (pointId: PointId): EditorSelectionTarget => ({
	kind: "node",
	pointId,
})
const handle = (
	pointId: PointId,
	side: "incoming" | "outgoing",
): EditorSelectionTarget => ({ kind: "handle", pointId, handle: side })

describe("marquee selection", () => {
	it("resolves replace, add, and Shift-first subtract modes", () => {
		expect(
			marqueeSelectionMode({
				shiftKey: false,
				metaKey: false,
				ctrlKey: false,
			}),
		).toBe("replace")
		expect(
			marqueeSelectionMode({
				shiftKey: false,
				metaKey: true,
				ctrlKey: false,
			}),
		).toBe("add")
		expect(
			marqueeSelectionMode({
				shiftKey: false,
				metaKey: false,
				ctrlKey: true,
			}),
		).toBe("add")
		expect(
			marqueeSelectionMode({
				shiftKey: true,
				metaKey: true,
				ctrlKey: true,
			}),
		).toBe("subtract")
	})

	it("replaces or adds independently keyed nodes and handles", () => {
		const first = node("point:first")
		const incoming = handle("point:first", "incoming")
		const outgoing = handle("point:first", "outgoing")
		expect(
			combineMarqueeSelection(
				[first, incoming],
				[outgoing, outgoing],
				"replace",
			),
		).toEqual([outgoing])
		expect(
			combineMarqueeSelection([first, incoming], [incoming, outgoing], "add"),
		).toEqual([first, incoming, outgoing])
	})

	it("subtracts only enclosed existing targets and otherwise is a no-op", () => {
		const first = node("point:first")
		const second = node("point:second")
		const incoming = handle("point:first", "incoming")
		const outgoing = handle("point:first", "outgoing")
		expect(
			combineMarqueeSelection(
				[first, incoming, outgoing, second],
				[incoming, node("point:unselected")],
				"subtract",
			),
		).toEqual([first, outgoing, second])
		expect(combineMarqueeSelection([first, incoming], [], "subtract")).toEqual([
			first,
			incoming,
		])
		expect(
			combineMarqueeSelection(
				[first, incoming],
				[node("point:unselected")],
				"subtract",
			),
		).toEqual([first, incoming])
	})
})
