export interface MomentaryPreviewKeyboardEvent {
	readonly key: string
	readonly metaKey: boolean
	readonly ctrlKey: boolean
	readonly altKey: boolean
	readonly isComposing: boolean
}

export function isMomentaryPreviewKey(
	event: Pick<MomentaryPreviewKeyboardEvent, "key">,
) {
	return event.key.toLowerCase() === "e"
}

export function shouldStartMomentaryPreview(
	event: MomentaryPreviewKeyboardEvent,
): boolean {
	return (
		isMomentaryPreviewKey(event) &&
		!event.metaKey &&
		!event.ctrlKey &&
		!event.altKey &&
		!event.isComposing
	)
}

export function isEditablePreviewTarget(target: EventTarget | null): boolean {
	return (
		target instanceof HTMLInputElement ||
		target instanceof HTMLTextAreaElement ||
		target instanceof HTMLSelectElement ||
		(target instanceof HTMLElement && target.isContentEditable)
	)
}
