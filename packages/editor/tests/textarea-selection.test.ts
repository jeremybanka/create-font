import { describe, expect, it } from "vitest"

import {
	activeTextareaSelectionIndex,
	observeTextareaSelection,
} from "../src/textarea-selection.ts"

class TestTextarea extends EventTarget {
	value = ""
	selectionStart: number | null = 0
	selectionEnd: number | null = 0
	selectionDirection: SelectionDirection = "none"
}

describe("textarea selection synchronization", () => {
	it("uses the focus edge for forward and backward native selections", () => {
		const textarea = new TestTextarea()
		textarea.value = "first\nsecond"
		textarea.selectionStart = 2
		textarea.selectionEnd = 9

		textarea.selectionDirection = "forward"
		expect(activeTextareaSelectionIndex(textarea)).toBe(9)

		textarea.selectionDirection = "backward"
		expect(activeTextareaSelectionIndex(textarea)).toBe(2)

		textarea.selectionDirection = "none"
		expect(activeTextareaSelectionIndex(textarea)).toBe(9)
	})

	it("preserves UTF-16 offsets and clamps malformed selection state", () => {
		const textarea = new TestTextarea()
		textarea.value = "A😀é\nB"
		textarea.selectionStart = 3
		textarea.selectionEnd = 3
		expect(activeTextareaSelectionIndex(textarea)).toBe(3)

		textarea.selectionDirection = "backward"
		textarea.selectionStart = -10
		textarea.selectionEnd = 100
		expect(activeTextareaSelectionIndex(textarea)).toBe(0)

		textarea.selectionDirection = "forward"
		expect(activeTextareaSelectionIndex(textarea)).toBe(textarea.value.length)
	})

	it("reacts to this textarea's selectionchange events and cleans up", () => {
		const textarea = new TestTextarea()
		textarea.value = "one\ntwo"
		const indices: number[] = []
		const stop = observeTextareaSelection(textarea, (index) => {
			indices.push(index)
		})

		textarea.selectionStart = 1
		textarea.selectionEnd = 1
		textarea.dispatchEvent(new Event("selectionchange"))
		textarea.selectionStart = 1
		textarea.selectionEnd = 6
		textarea.selectionDirection = "forward"
		textarea.dispatchEvent(new Event("selectionchange"))
		textarea.selectionDirection = "backward"
		textarea.dispatchEvent(new Event("selectionchange"))

		expect(indices).toEqual([1, 6, 1])

		stop()
		textarea.selectionStart = 4
		textarea.selectionEnd = 4
		textarea.dispatchEvent(new Event("selectionchange"))
		expect(indices).toEqual([1, 6, 1])
	})
})
