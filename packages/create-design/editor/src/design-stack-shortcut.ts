import type { DesignStackCommand } from "./design-hierarchy.ts"

export interface DesignStackShortcutEvent {
	readonly altKey: boolean
	readonly code: string
	readonly ctrlKey: boolean
	readonly key: string
	readonly metaKey: boolean
	readonly shiftKey: boolean
}

/** Resolves conventional, platform-specific stacking shortcuts. */
export function designStackShortcutCommand(
	event: DesignStackShortcutEvent,
	macLike: boolean,
): DesignStackCommand | null {
	const platformMod = macLike ? event.metaKey : event.ctrlKey
	const otherMod = macLike ? event.ctrlKey : event.metaKey
	if (!platformMod || otherMod || event.shiftKey) return null
	if (event.code === "BracketRight" || event.key === "]" || event.key === "}")
		return event.altKey ? "front" : "forward"
	if (event.code === "BracketLeft" || event.key === "[" || event.key === "{")
		return event.altKey ? "back" : "backward"
	return null
}
