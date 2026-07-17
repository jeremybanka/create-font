interface TextareaSelectionState {
	readonly value: string
	readonly selectionStart: number | null
	readonly selectionEnd: number | null
	readonly selectionDirection: SelectionDirection | null
}

type TextareaSelectionTarget = TextareaSelectionState &
	Pick<EventTarget, "addEventListener" | "removeEventListener">

const clampTextOffset = (offset: number | null, textLength: number): number => {
	if (offset === null || !Number.isFinite(offset)) return 0
	return Math.min(textLength, Math.max(0, Math.trunc(offset)))
}

/** Returns the native selection's focus edge as a UTF-16 text offset. */
export function activeTextareaSelectionIndex(
	textarea: TextareaSelectionState,
): number {
	const start = clampTextOffset(textarea.selectionStart, textarea.value.length)
	const end = clampTextOffset(textarea.selectionEnd, textarea.value.length)
	// Browsers expose the focus edge through selectionDirection. When direction
	// is unavailable/none, use the end edge as the deterministic fallback.
	return textarea.selectionDirection === "backward" ? start : end
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
