import type { ReadableToken, Silo } from "atom.io"
import { traceRootSelectorAtoms } from "atom.io/internal"

let nextSubscriptionId = 0

/**
 * Observe a state once after an atom.io transaction has finished applying.
 *
 * atom.io commits a transaction atomically, but applies its recorded atom updates
 * to the root store one at a time. A selector can therefore notify subscribers
 * many times while the transaction is being committed. React external-store
 * subscribers must only see the settled snapshot.
 */
export function subscribeToSettledState<T>(
	silo: Silo,
	token: ReadableToken<T>,
	notify: () => void,
): () => void {
	let pending = false
	const subscriptionId = nextSubscriptionId++
	const transactionSubscriptionKey = `create-font/settled-state/${subscriptionId}`
	const rootSubscriptionKey = `create-font/settled-state-root/${subscriptionId}`
	const isPureSelector =
		token.type === "readonly_pure_selector" ||
		token.type === "writable_pure_selector"
	const rootSubscriptions = new Map<string, () => void>()

	const refreshRootSubscriptions = () => {
		if (!isPureSelector) return
		const roots = traceRootSelectorAtoms(silo.store, token.key)
		for (const [rootKey, unsubscribe] of rootSubscriptions) {
			if (roots.has(rootKey)) continue
			unsubscribe()
			rootSubscriptions.delete(rootKey)
		}
		for (const [rootKey, root] of roots) {
			if (rootSubscriptions.has(rootKey)) continue
			rootSubscriptions.set(
				rootKey,
				root.subject.subscribe(rootSubscriptionKey, () => {
					if (silo.store.on.transactionApplying.state !== null) {
						pending = true
						return
					}
					silo.getState(token)
					refreshRootSubscriptions()
					notify()
				}),
			)
		}
	}

	if (isPureSelector) {
		silo.getState(token)
		refreshRootSubscriptions()
	}
	const unsubscribeTransaction = silo.store.on.transactionApplying.subscribe(
		transactionSubscriptionKey,
		(transaction) => {
			if (transaction !== null || !pending) return
			pending = false
			if (isPureSelector) {
				silo.getState(token)
				refreshRootSubscriptions()
			}
			notify()
		},
	)
	const unsubscribeState = isPureSelector
		? () => undefined
		: silo.subscribe(token, () => {
				if (silo.store.on.transactionApplying.state !== null) {
					pending = true
					return
				}
				notify()
			})

	return () => {
		pending = false
		unsubscribeState()
		unsubscribeTransaction()
		for (const unsubscribeRoot of rootSubscriptions.values()) unsubscribeRoot()
		rootSubscriptions.clear()
	}
}
