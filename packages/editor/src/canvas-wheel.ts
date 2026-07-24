import { hasWheelZoomModifier as sharedHasWheelZoomModifier } from "./canvas-foundations.ts"

export interface WheelZoomModifiers {
	readonly altKey: boolean
	readonly ctrlKey: boolean
	readonly metaKey: boolean
}

export function hasWheelZoomModifier(event: WheelZoomModifiers): boolean {
	return sharedHasWheelZoomModifier({
		...event,
		deltaX: 0,
		deltaY: 0,
		shiftKey: false,
	})
}
