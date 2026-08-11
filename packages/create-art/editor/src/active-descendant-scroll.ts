export function scrollActiveDescendantIntoView(
	container: HTMLElement | null,
	active: HTMLElement | null,
): void {
	if (container === null || active === null || !container.contains(active))
		return
	const containerBounds = container.getBoundingClientRect()
	const activeBounds = active.getBoundingClientRect()
	if (activeBounds.top < containerBounds.top) {
		container.scrollTop = Math.max(
			0,
			container.scrollTop - (containerBounds.top - activeBounds.top),
		)
	} else if (activeBounds.bottom > containerBounds.bottom) {
		container.scrollTop += activeBounds.bottom - containerBounds.bottom
	}
}
