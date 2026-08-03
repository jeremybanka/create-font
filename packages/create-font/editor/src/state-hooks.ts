import type {
	ReadableFamilyToken,
	TimelineFamilyToken,
	TimelineToken,
	ViewOf,
} from "atom.io"
import type { Canonical } from "atom.io/foundations/canonical"
import { useI, useO, useTL as useAtomTimeline } from "atom.io/react"
import { useMemo } from "react"

export { useI, useO }

/**
 * Observe a family through atom.io's standard hook without allocating an
 * invalid family member while the application key is absent.
 */
export function useOptionalOF<T, K extends Canonical>(
	family: ReadableFamilyToken<T, K>,
	key: K | null,
	fallbackKey: K,
): ViewOf<T> | null {
	const value = useO(family, key ?? fallbackKey)
	return key === null ? null : value
}

export type TimelineMeta = Readonly<{
	at: number
	length: number
	undo: () => void
	redo: () => void
	clear: () => void
	undoTransaction?: () => void
	redoTransaction?: () => void
}>

const EMPTY_TIMELINE: TimelineMeta = Object.freeze({
	at: 0,
	length: 0,
	undo: () => {},
	redo: () => {},
	clear: () => {},
})

function withChangeNotification(
	timeline: TimelineMeta,
	onChange?: () => void,
): TimelineMeta {
	return {
		...timeline,
		undo: () => {
			timeline.undo()
			onChange?.()
		},
		redo: () => {
			timeline.redo()
			onChange?.()
		},
		...(timeline.undoTransaction === undefined
			? {}
			: {
					undoTransaction: () => {
						timeline.undoTransaction?.()
						onChange?.()
					},
				}),
		...(timeline.redoTransaction === undefined
			? {}
			: {
					redoTransaction: () => {
						timeline.redoTransaction?.()
						onChange?.()
					},
				}),
	}
}

export function useTimeline(
	token: TimelineToken<any>,
	onChange?: () => void,
): TimelineMeta {
	const timeline = useAtomTimeline(token)
	return useMemo(
		() => withChangeNotification(timeline, onChange),
		[onChange, timeline],
	)
}

/**
 * Keep hook order stable for an optional timeline key by observing a known
 * family member as the inert fallback.
 */
export function useOptionalTL<K extends Canonical>(
	family: TimelineFamilyToken<K, any>,
	key: K | null,
	fallbackKey: K,
	onChange?: () => void,
): TimelineMeta {
	const timeline = useAtomTimeline(family, key ?? fallbackKey)
	return useMemo(
		() =>
			key === null ? EMPTY_TIMELINE : withChangeNotification(timeline, onChange),
		[key, onChange, timeline],
	)
}
