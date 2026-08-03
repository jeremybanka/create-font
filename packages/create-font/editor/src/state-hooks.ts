import type { Silo, TimelineFamilyToken, TimelineToken } from "atom.io"
import type { Canonical } from "atom.io/foundations/canonical"
import { useI, useO, useTL as useAtomTimeline } from "atom.io/react"
import { useMemo } from "react"

export { useI, useO }

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
 * Keep hook order stable for an optional family key by observing a standalone
 * inert timeline. No family member is found or recreated while the key is null.
 */
export function useOptionalTL<K extends Canonical>(
	silo: Silo,
	family: TimelineFamilyToken<K, any>,
	key: K | null,
	inactiveTimeline: TimelineToken<any>,
	onChange?: () => void,
): TimelineMeta {
	const token = useMemo(
		() => (key === null ? inactiveTimeline : silo.findTimeline(family, key)),
		[family, inactiveTimeline, key, silo],
	)
	const timeline = useAtomTimeline(token)
	return useMemo(
		() =>
			key === null
				? EMPTY_TIMELINE
				: withChangeNotification(timeline, onChange),
		[key, onChange, timeline],
	)
}
