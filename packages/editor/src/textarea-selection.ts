interface TextareaSelectionState {
	readonly value: string
	readonly selectionStart: number | null
	readonly selectionEnd: number | null
	readonly selectionDirection: SelectionDirection | null
}

export interface TextareaSelectionRange {
	readonly selectionStart: number
	readonly selectionEnd: number
	readonly selectionDirection: SelectionDirection
}

export interface TextareaVerticalMovement extends TextareaSelectionRange {
	readonly focus: number
	readonly preferredX: number
}

export interface TextareaCaretPosition {
	readonly textIndex: number
	readonly x: number
	readonly baseline: number
}

type TextareaSelectionTarget = TextareaSelectionState &
	Pick<EventTarget, "addEventListener" | "removeEventListener">

const clampTextOffset = (offset: number | null, textLength: number): number => {
	if (offset === null || !Number.isFinite(offset)) return 0
	return Math.min(textLength, Math.max(0, Math.trunc(offset)))
}

/** Returns a clamped, ordered snapshot of the textarea's native selection. */
export function normalizedTextareaSelection(
	textarea: TextareaSelectionState,
): TextareaSelectionRange {
	const first = clampTextOffset(textarea.selectionStart, textarea.value.length)
	const second = clampTextOffset(textarea.selectionEnd, textarea.value.length)
	return Object.freeze({
		selectionStart: Math.min(first, second),
		selectionEnd: Math.max(first, second),
		selectionDirection: textarea.selectionDirection ?? "none",
	})
}

/** Returns the native selection's focus edge as a UTF-16 text offset. */
export function activeTextareaSelectionIndex(
	textarea: TextareaSelectionState,
): number {
	const { selectionStart: start, selectionEnd: end } =
		normalizedTextareaSelection(textarea)
	// Browsers expose the focus edge through selectionDirection. When direction
	// is unavailable/none, use the end edge as the deterministic fallback.
	return textarea.selectionDirection === "backward" ? start : end
}

/**
 * Resolves native-style vertical movement against the canvas text layout.
 * The retained preferred x lets a caret cross a short line and recover its
 * original horizontal position on a later, longer line.
 */
export function moveTextareaSelectionVertically(
	textarea: TextareaSelectionState,
	carets: readonly TextareaCaretPosition[],
	direction: -1 | 1,
	options: Readonly<{ extend: boolean; preferredX: number | null }>,
): TextareaVerticalMovement | null {
	const focus = activeTextareaSelectionIndex(textarea)
	const current = carets.find((caret) => caret.textIndex === focus)
	if (current === undefined) return null
	const preferredX = options.preferredX ?? current.x
	const baselines = [...new Set(carets.map((caret) => caret.baseline))].sort(
		(a, b) => a - b,
	)
	const lineIndex = baselines.indexOf(current.baseline)
	const targetBaseline = baselines[lineIndex + direction]
	if (targetBaseline === undefined) {
		return {
			focus,
			preferredX,
			selectionStart: clampTextOffset(
				textarea.selectionStart,
				textarea.value.length,
			),
			selectionEnd: clampTextOffset(
				textarea.selectionEnd,
				textarea.value.length,
			),
			selectionDirection: textarea.selectionDirection ?? "none",
		}
	}
	let destination: TextareaCaretPosition | undefined
	let distance = Number.POSITIVE_INFINITY
	for (const caret of carets) {
		if (caret.baseline !== targetBaseline) continue
		const nextDistance = Math.abs(caret.x - preferredX)
		if (
			nextDistance < distance ||
			(nextDistance === distance &&
				(destination === undefined || caret.textIndex < destination.textIndex))
		) {
			destination = caret
			distance = nextDistance
		}
	}
	if (destination === undefined) return null
	if (!options.extend) {
		return {
			focus: destination.textIndex,
			preferredX,
			selectionStart: destination.textIndex,
			selectionEnd: destination.textIndex,
			selectionDirection: "none",
		}
	}
	const start = clampTextOffset(textarea.selectionStart, textarea.value.length)
	const end = clampTextOffset(textarea.selectionEnd, textarea.value.length)
	const anchor = textarea.selectionDirection === "backward" ? end : start
	return {
		focus: destination.textIndex,
		preferredX,
		selectionStart: Math.min(anchor, destination.textIndex),
		selectionEnd: Math.max(anchor, destination.textIndex),
		selectionDirection:
			destination.textIndex < anchor
				? "backward"
				: destination.textIndex > anchor
					? "forward"
					: "none",
	}
}

/** Observes only this textarea's native selection changes. */
export function observeTextareaSelection(
	textarea: TextareaSelectionTarget,
	onChange: (index: number) => void,
): () => void {
	const synchronize = (): void => {
		onChange(activeTextareaSelectionIndex(textarea))
	}
	textarea.addEventListener("selectionchange", synchronize)
	return () => textarea.removeEventListener("selectionchange", synchronize)
}
