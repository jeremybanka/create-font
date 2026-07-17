export interface StepModifierEvent {
	readonly metaKey: boolean
	readonly ctrlKey: boolean
	readonly shiftKey: boolean
}

/** Resolves the editor's 1/10/100 unit precision ladder. */
export function keyboardStepMultiplier(
	event: StepModifierEvent,
	macLike: boolean,
): 1 | 10 | 100 {
	const mod = macLike ? event.metaKey : event.ctrlKey
	if (mod) return 100
	return event.shiftKey ? 10 : 1
}
