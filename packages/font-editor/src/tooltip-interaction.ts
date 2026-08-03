export interface TooltipIntentState {
	readonly dismissed: boolean
	readonly focused: boolean
	readonly pointed: boolean
}

export type TooltipIntentEvent =
	| "pointer-enter"
	| "pointer-leave"
	| "focus"
	| "blur"
	| "escape"
	| "activate"
	| "disable"

export const INITIAL_TOOLTIP_INTENT: TooltipIntentState = Object.freeze({
	dismissed: false,
	focused: false,
	pointed: false,
})

export function nextTooltipIntent(
	state: TooltipIntentState,
	event: TooltipIntentEvent,
): TooltipIntentState {
	switch (event) {
		case "pointer-enter":
			return { ...state, dismissed: false, pointed: true }
		case "pointer-leave": {
			const focused = state.focused
			return { ...state, dismissed: focused && state.dismissed, pointed: false }
		}
		case "focus":
			return { ...state, dismissed: false, focused: true }
		case "blur": {
			const pointed = state.pointed
			return { ...state, dismissed: pointed && state.dismissed, focused: false }
		}
		case "escape":
		case "activate":
			return { ...state, dismissed: true }
		case "disable":
			return INITIAL_TOOLTIP_INTENT
	}
}

export function tooltipWantsToOpen(
	state: TooltipIntentState,
	disabled: boolean,
): boolean {
	return !disabled && !state.dismissed && (state.focused || state.pointed)
}
