import type { ReadableToken, Silo } from "atom.io"
import { traceRootSelectorAtoms } from "atom.io/internal"

let nextSubscriptionId = 0

type SelectorObserver = Readonly<{
	listeners: Set<() => void>
	destroy: () => void
}>

const selectorObservers = new WeakMap<Silo, Map<string, SelectorObserver>>()

function createSelectorObserver<T>(
	silo: Silo,
	token: ReadableToken<T>,
): SelectorObserver {
	const subscriptionId = nextSubscriptionId++
	const transactionSubscriptionKey = `create-font/settled-state/${subscriptionId}`
	const rootSubscriptionKey = `create-font/settled-state-root/${subscriptionId}`
	const listeners = new Set<() => void>()
	const rootSubscriptions = new Map<string, () => void>()
	let pendingTransaction = false
	let scheduled = false
	let destroyed = false

	const refreshRootSubscriptions = () => {
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
				root.subject.subscribe(rootSubscriptionKey, handleRootUpdate),
			)
		}
	}

	const settle = () => {
		if (destroyed) return
		pendingTransaction = false
		scheduled = false
		silo.getState(token)
		refreshRootSubscriptions()
		for (const listener of listeners) listener()
	}

	function handleRootUpdate(): void {
		if (silo.store.on.transactionApplying.state !== null) {
			pendingTransaction = true
			return
		}
		if (scheduled) return
		scheduled = true
		queueMicrotask(() => {
			if (!scheduled || destroyed) return
			if (silo.store.on.transactionApplying.state !== null) {
				scheduled = false
				pendingTransaction = true
				return
			}
			settle()
		})
	}

	silo.getState(token)
	refreshRootSubscriptions()
	const unsubscribeTransaction = silo.store.on.transactionApplying.subscribe(
		transactionSubscriptionKey,
		(transaction) => {
			if (transaction !== null || !pendingTransaction) return
			settle()
		},
	)

	return {
		listeners,
		destroy: () => {
			destroyed = true
			scheduled = false
			listeners.clear()
			unsubscribeTransaction()
			for (const unsubscribeRoot of rootSubscriptions.values()) {
				unsubscribeRoot()
			}
			rootSubscriptions.clear()
		},
	}
}

/**
 * Observe a state once after an atom.io transaction has finished applying.
 *
 * atom.io commits a transaction atomically, but applies its recorded atom updates
 * to the root store one at a time. Pure-selector observers are shared so their
 * dependency graph is recomputed once per settled update, regardless of how many
 * components consume the selector. Same-turn timeline updates are coalesced too.
 */
export function subscribeToSettledState<T>(
	silo: Silo,
	token: ReadableToken<T>,
	notify: () => void,
): () => void {
	const isPureSelector =
		token.type === "readonly_pure_selector" ||
		token.type === "writable_pure_selector"
	if (isPureSelector) {
		let observers = selectorObservers.get(silo)
		if (observers === undefined) {
			observers = new Map()
			selectorObservers.set(silo, observers)
		}
		let observer = observers.get(token.key)
		if (observer === undefined) {
			observer = createSelectorObserver(silo, token)
			observers.set(token.key, observer)
		}
		observer.listeners.add(notify)
		return () => {
			observer.listeners.delete(notify)
			if (observer.listeners.size !== 0) return
			observer.destroy()
			observers.delete(token.key)
			if (observers.size === 0) selectorObservers.delete(silo)
		}
	}

	let pending = false
	const transactionSubscriptionKey = `create-font/settled-state/${nextSubscriptionId++}`
	const unsubscribeTransaction = silo.store.on.transactionApplying.subscribe(
		transactionSubscriptionKey,
		(transaction) => {
			if (transaction !== null || !pending) return
			pending = false
			notify()
		},
	)
	const unsubscribeState = silo.subscribe(token, () => {
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
	}
}
