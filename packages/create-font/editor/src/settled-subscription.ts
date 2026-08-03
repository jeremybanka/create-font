import type { ReadableToken, Silo } from "atom.io"

/**
 * Coalesce notifications from one logical edit into one external-store update.
 *
 * This deliberately uses atom.io's public subscription surface only. Selector
 * dependencies remain owned by atom.io; consumers express their desired scope by
 * subscribing to an appropriately granular token.
 */
export function subscribeToSettledState<T>(
	silo: Silo,
	token: ReadableToken<T>,
	notify: () => void,
): () => void {
	let scheduled = false
	let active = true
	const unsubscribe = silo.subscribe(token, () => {
		if (scheduled) return
		scheduled = true
		queueMicrotask(() => {
			scheduled = false
			if (active) notify()
		})
	})
	return () => {
		active = false
		scheduled = false
		unsubscribe()
	}
}
