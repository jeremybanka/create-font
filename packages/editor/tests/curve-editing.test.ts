import { describe, expect, it } from "vitest"

import {
	segmentPointerAction,
	shouldActivateEditorControl,
	shouldSelectContourOnSegmentDoubleClick,
} from "../src/curve-editing.ts"

describe("curve editing gestures", () => {
	it("reserves Alt/Option segment conversion for the Select tool", () => {
		expect(segmentPointerAction("select", { altKey: true })).toBe("add-handles")
		expect(segmentPointerAction("select", { altKey: false })).toBeNull()
		expect(segmentPointerAction("transform", { altKey: true })).toBeNull()
	})

	it("keeps Pen insertion ahead of the Alt/Option segment gesture", () => {
		expect(segmentPointerAction("pen", { altKey: false })).toBe("split")
		expect(segmentPointerAction("pen", { altKey: true })).toBe("split")
	})

	it("selects contours in Select and Transform without regressing Select Alt", () => {
		expect(
			shouldSelectContourOnSegmentDoubleClick("select", { altKey: false }),
		).toBe(true)
		expect(
			shouldSelectContourOnSegmentDoubleClick("select", { altKey: true }),
		).toBe(false)
		expect(
			shouldSelectContourOnSegmentDoubleClick("transform", { altKey: false }),
		).toBe(true)
		expect(
			shouldSelectContourOnSegmentDoubleClick("transform", { altKey: true }),
		).toBe(true)
		expect(
			shouldSelectContourOnSegmentDoubleClick("pen", { altKey: false }),
		).toBe(false)
	})

	it("makes node and handle activation exclusive to Select", () => {
		expect(shouldActivateEditorControl("select")).toBe(true)
		expect(shouldActivateEditorControl("knife")).toBe(false)
		expect(shouldActivateEditorControl("pen")).toBe(false)
	})
})
