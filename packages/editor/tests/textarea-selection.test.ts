import { describe, expect, it } from "vitest"

import {
	activeTextareaSelectionIndex,
	moveTextareaSelectionVertically,
	observeTextareaSelection,
} from "../src/textarea-selection.ts"

class TestTextarea extends EventTarget {
	value = ""
	selectionStart: number | null = 0
	selectionEnd: number | null = 0
	selectionDirection: SelectionDirection = "none"
}

describe("textarea selection synchronization", () => {
	const carets = [
		{ textIndex: 0, x: 0, baseline: 100 },
		{ textIndex: 1, x: 80, baseline: 100 },
		{ textIndex: 2, x: 200, baseline: 100 },
		{ textIndex: 3, x: 0, baseline: 200 },
		{ textIndex: 4, x: 70, baseline: 200 },
		{ textIndex: 5, x: 0, baseline: 300 },
		{ textIndex: 6, x: 90, baseline: 300 },
		{ textIndex: 7, x: 210, baseline: 300 },
	]

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

	it("moves between layout lines and retains a preferred horizontal position", () => {
		const textarea = new TestTextarea()
		textarea.value = "ab\nc\ndef"
		textarea.selectionStart = 2
		textarea.selectionEnd = 2

		const first = moveTextareaSelectionVertically(textarea, carets, 1, {
			extend: false,
			preferredX: null,
		})
		expect(first).toMatchObject({
			focus: 4,
			preferredX: 200,
			selectionStart: 4,
			selectionEnd: 4,
		})
		textarea.selectionStart = 4
		textarea.selectionEnd = 4
		const second = moveTextareaSelectionVertically(textarea, carets, 1, {
			extend: false,
			preferredX: first?.preferredX ?? null,
		})
		expect(second).toMatchObject({ focus: 7, preferredX: 200 })
	})

	it("extends and reverses a selection from its native anchor", () => {
		const textarea = new TestTextarea()
		textarea.value = "ab\nc\ndef"
		textarea.selectionStart = 1
		textarea.selectionEnd = 1

		const down = moveTextareaSelectionVertically(textarea, carets, 1, {
			extend: true,
			preferredX: null,
		})
		expect(down).toMatchObject({
			focus: 4,
			selectionStart: 1,
			selectionEnd: 4,
			selectionDirection: "forward",
		})
		textarea.selectionStart = down?.selectionStart ?? 0
		textarea.selectionEnd = down?.selectionEnd ?? 0
		textarea.selectionDirection = "forward"
		const up = moveTextareaSelectionVertically(textarea, carets, -1, {
			extend: true,
			preferredX: down?.preferredX ?? null,
		})
		expect(up).toMatchObject({
			focus: 1,
			selectionStart: 1,
			selectionEnd: 1,
			selectionDirection: "none",
		})
		textarea.selectionDirection = "backward"
		textarea.selectionStart = 1
		textarea.selectionEnd = 4
		const fartherUp = moveTextareaSelectionVertically(textarea, carets, -1, {
			extend: true,
			preferredX: 80,
		})
		expect(fartherUp).toMatchObject({
			focus: 1,
			selectionStart: 1,
			selectionEnd: 4,
			selectionDirection: "backward",
		})
	})

	it("does not wrap at the first or last layout line", () => {
		const textarea = new TestTextarea()
		textarea.value = "ab\nc\ndef"
		textarea.selectionStart = 1
		textarea.selectionEnd = 1
		expect(
			moveTextareaSelectionVertically(textarea, carets, -1, {
				extend: false,
				preferredX: null,
			}),
		).toMatchObject({ focus: 1, selectionStart: 1, selectionEnd: 1 })
		textarea.selectionStart = 7
		textarea.selectionEnd = 7
		expect(
			moveTextareaSelectionVertically(textarea, carets, 1, {
				extend: false,
				preferredX: null,
			}),
		).toMatchObject({ focus: 7, selectionStart: 7, selectionEnd: 7 })
	})

	it("keeps UTF-16 caret stops valid while crossing empty lines", () => {
		const textarea = new TestTextarea()
		textarea.value = "😀\n\nB"
		textarea.selectionStart = 2
		textarea.selectionEnd = 2
		const unicodeCarets = [
			{ textIndex: 0, x: 0, baseline: 100 },
			{ textIndex: 2, x: 100, baseline: 100 },
			{ textIndex: 3, x: 0, baseline: 200 },
			{ textIndex: 4, x: 0, baseline: 300 },
			{ textIndex: 5, x: 80, baseline: 300 },
		]
		const emptyLine = moveTextareaSelectionVertically(
			textarea,
			unicodeCarets,
			1,
			{ extend: false, preferredX: null },
		)
		expect(emptyLine).toMatchObject({ focus: 3, preferredX: 100 })
		textarea.selectionStart = 3
		textarea.selectionEnd = 3
		const finalLine = moveTextareaSelectionVertically(
			textarea,
			unicodeCarets,
			1,
			{ extend: false, preferredX: emptyLine?.preferredX ?? null },
		)
		expect(finalLine).toMatchObject({ focus: 5, preferredX: 100 })
		textarea.selectionStart = 5
		textarea.selectionEnd = 5
		expect(
			moveTextareaSelectionVertically(textarea, unicodeCarets, -1, {
				extend: false,
				preferredX: finalLine?.preferredX ?? null,
			}),
		).toMatchObject({ focus: 3, preferredX: 100 })
	})
})
