export type CurvatureShortcutEvent = Readonly<{
	altKey: boolean
	ctrlKey: boolean
	defaultPrevented?: boolean
	key: string
	metaKey: boolean
	shiftKey: boolean
}>

/** Product-facing display modes; each product resolves "outside" itself. */
export type CurvatureSide = "outside" | "signed"

/** Matches Speed Punk's original platform-Mod+Shift+X shortcut. */
export function isCurvatureShortcut(
	event: CurvatureShortcutEvent,
	macLike: boolean,
): boolean {
	if (event.defaultPrevented || event.altKey || event.key.toLowerCase() !== "x")
		return false
	return (
		event.shiftKey &&
		(macLike
			? event.metaKey && !event.ctrlKey
			: event.ctrlKey && !event.metaKey)
	)
}
