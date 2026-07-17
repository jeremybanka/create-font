import type {
	ReadableToken,
	Silo,
	TimelineFamilyToken,
	ViewOf,
	WritableToken,
} from "atom.io"
import type { Canonical } from "atom.io/foundations/canonical"
import { createContext } from "preact"
import {
	useCallback,
	useContext,
	useMemo,
	useSyncExternalStore,
} from "preact/compat"

import { subscribeToSettledState } from "./settled-subscription.ts"

export const EditorStateContext = createContext<Silo | null>(null)

function useEditorSilo(): Silo {
	const silo = useContext(EditorStateContext)
	if (silo === null) {
		throw new Error(`Editor state hooks require EditorStateContext.`)
	}
	return silo
}

export function useI<T>(token: WritableToken<T, any, any>) {
	const silo = useEditorSilo()
	return useCallback(
		<New extends T>(next: New | ((old: T) => New)) => {
			silo.setState(token, next)
		},
		[silo, token],
	)
}

export function useO<T, E = never>(
	token: ReadableToken<T, any, E>,
): ViewOf<E | T> {
	const silo = useEditorSilo()
	const subscribe = useCallback(
		(notify: () => void) =>
			subscribeToSettledState(silo, token as ReadableToken<T>, notify),
		[silo, token],
	)
	const getSnapshot = useCallback(() => silo.getState(token), [silo, token])
	return useSyncExternalStore(subscribe, getSnapshot)
}

export type TimelineMeta = Readonly<{
	at: number
	length: number
	undo: () => void
	redo: () => void
	clear: () => void
}>

export function useTL<K extends Canonical>(
	family: TimelineFamilyToken<K, any>,
	key: K,
): TimelineMeta {
	const silo = useEditorSilo()
	const token = silo.findTimeline(family, key)
	const subscribe = useCallback(
		(notify: () => void) => silo.subscribe(token, () => notify()),
		[silo, token],
	)
	const getSnapshot = useCallback(() => {
		const { at, length } = silo.inspectTimeline(token)
		return `${at}:${length}`
	}, [silo, token])
	const snapshot = useSyncExternalStore(subscribe, getSnapshot)

	return useMemo(() => {
		const { at, length } = silo.inspectTimeline(token)
		return {
			at,
			length,
			undo: () => silo.undo(token),
			redo: () => silo.redo(token),
			clear: () => silo.clearTimeline(token),
		}
	}, [silo, snapshot, token])
}
