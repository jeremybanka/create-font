import type {
	ReadableFamilyToken,
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

export function useOF<T, K extends Canonical>(
	family: ReadableFamilyToken<T, K>,
	key: K,
): ViewOf<T> {
	const silo = useEditorSilo()
	const token = useMemo(() => silo.findState(family, key), [family, key, silo])
	return useO(token)
}

/** Reads a family member without constructing a family token for a null key. */
export function useOptionalOF<T, K extends Canonical>(
	family: ReadableFamilyToken<T, K>,
	key: K | null,
): ViewOf<T> | null {
	const silo = useEditorSilo()
	const token = useMemo(
		() => (key === null ? null : silo.findState(family, key)),
		[family, key, silo],
	)
	const subscribe = useCallback(
		(notify: () => void) =>
			token === null ? () => {} : subscribeToSettledState(silo, token, notify),
		[silo, token],
	)
	const getSnapshot = useCallback(
		() => (token === null ? null : silo.getState(token)),
		[silo, token],
	)
	return useSyncExternalStore(subscribe, getSnapshot)
}

export type TimelineMeta = Readonly<{
	at: number
	length: number
	undo: () => void
	redo: () => void
	clear: () => void
}>

const EMPTY_TIMELINE: TimelineMeta = Object.freeze({
	at: 0,
	length: 0,
	undo: () => {},
	redo: () => {},
	clear: () => {},
})

export function useTL<K extends Canonical>(
	family: TimelineFamilyToken<K, any>,
	key: K,
	onChange?: () => void,
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
			undo: () => {
				silo.undo(token)
				onChange?.()
			},
			redo: () => {
				silo.redo(token)
				onChange?.()
			},
			clear: () => silo.clearTimeline(token),
		}
	}, [onChange, silo, snapshot, token])
}

/** Reads a timeline only when its canonical family key exists. */
export function useOptionalTL<K extends Canonical>(
	family: TimelineFamilyToken<K, any>,
	key: K | null,
	onChange?: () => void,
): TimelineMeta {
	const silo = useEditorSilo()
	const token = useMemo(
		() => (key === null ? null : silo.findTimeline(family, key)),
		[family, key, silo],
	)
	const subscribe = useCallback(
		(notify: () => void) =>
			token === null ? () => {} : silo.subscribe(token, () => notify()),
		[silo, token],
	)
	const getSnapshot = useCallback(() => {
		if (token === null) return "empty"
		const { at, length } = silo.inspectTimeline(token)
		return `${at}:${length}`
	}, [silo, token])
	const snapshot = useSyncExternalStore(subscribe, getSnapshot)

	return useMemo(() => {
		if (token === null) return EMPTY_TIMELINE
		const { at, length } = silo.inspectTimeline(token)
		return {
			at,
			length,
			undo: () => {
				silo.undo(token)
				onChange?.()
			},
			redo: () => {
				silo.redo(token)
				onChange?.()
			},
			clear: () => silo.clearTimeline(token),
		}
	}, [onChange, silo, snapshot, token])
}
