export interface WheelZoomModifiers {
	readonly altKey: boolean
	readonly ctrlKey: boolean
	readonly metaKey: boolean
}

export function hasWheelZoomModifier(event: WheelZoomModifiers): boolean {
	return event.altKey || event.ctrlKey || event.metaKey
}
