import {
	type ReadableToken,
	type TimelineManageable,
	type TimelineToken,
	type ViewOf,
	type WritableToken,
} from "atom.io"
import { createContext, createElement, type ComponentChildren } from "preact"
import { useSyncExternalStore } from "preact/compat"
import {
	useCallback,
	useContext,
	useEffect,
	useRef,
	useState,
} from "preact/hooks"

import type { EditorWorkspace } from "./editor-workspace.ts"

type EditorSilo = EditorWorkspace["font"]["silo"]

const SiloContext = createContext<EditorSilo | null>(null)

export interface EditorStateProviderProps {
	readonly children: ComponentChildren
	readonly silo: EditorSilo
}

export function EditorStateProvider({
	children,
	silo,
}: EditorStateProviderProps) {
	return createElement(SiloContext.Provider, { value: silo }, children)
}

function useSilo(): EditorSilo {
	const silo = useContext(SiloContext)
	if (silo === null)
		throw new Error("Editor state hooks require a Silo provider.")
	return silo
}

export function useO<Value>(token: ReadableToken<Value>): ViewOf<Value> {
	const silo = useSilo()
	const getSnapshot = useCallback(() => silo.getState(token), [silo, token.key])
	const subscribe = useCallback(
		(notify: () => void) => silo.subscribe(token, () => notify()),
		[silo, token.key],
	)
	return useSyncExternalStore(subscribe, getSnapshot)
}

export function useI<Value>(
	token: WritableToken<Value>,
): <Next extends Value>(next: Next | ((old: Value) => Next)) => void

export function useI<Value>(
	token: WritableToken<Value>,
): <Next extends Value>(next: Next | ((old: Value) => Next)) => void {
	const silo = useSilo()
	return useCallback(
		<Next extends Value>(next: Next | ((old: Value) => Next)): void => {
			silo.setState(token, next)
		},
		[silo, token.key],
	)
}

export interface TimelinePosition {
	readonly at: number
	readonly length: number
}

export function useTimeline<Manageable extends TimelineManageable>(
	timeline: TimelineToken<Manageable>,
): TimelinePosition {
	const silo = useSilo()
	const positions = useRef(new Map<string, TimelinePosition>())
	const [position, setPosition] = useState<TimelinePosition>({
		at: 0,
		length: 0,
	})
	useEffect(() => {
		setPosition(positions.current.get(timeline.key) ?? { at: 0, length: 0 })
		return silo.subscribe(timeline, (update) => {
			const next = { at: update.at, length: update.length }
			positions.current.set(timeline.key, next)
			setPosition(next)
		})
	}, [silo, timeline.key])
	return position
}
