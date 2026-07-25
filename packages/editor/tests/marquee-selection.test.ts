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
	it("resolves replace, add, and Shift-first toggle modes", () => {
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
		).toBe("toggle")
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

	it("inverts every enclosed target without changing uncovered targets", () => {
		const first = node("point:first")
		const second = node("point:second")
		const incoming = handle("point:first", "incoming")
		const outgoing = handle("point:first", "outgoing")
		expect(
			combineMarqueeSelection(
				[first, incoming, outgoing, second],
				[incoming, node("point:unselected")],
				"toggle",
			),
		).toEqual([first, outgoing, second, node("point:unselected")])
		expect(combineMarqueeSelection([first, incoming], [], "toggle")).toEqual([
			first,
			incoming,
		])
		expect(
			combineMarqueeSelection(
				[first, incoming],
				[node("point:unselected")],
				"toggle",
			),
		).toEqual([first, incoming, node("point:unselected")])
	})

	it("swaps selected and unselected nodes covered by the same Shift marquee", () => {
		const selectedInside = node("point:selected-inside")
		const selectedOutside = node("point:selected-outside")
		const unselectedInside = node("point:unselected-inside")

		expect(
			combineMarqueeSelection(
				[selectedInside, selectedOutside],
				[selectedInside, unselectedInside],
				"toggle",
			),
		).toEqual([selectedOutside, unselectedInside])
	})
})
