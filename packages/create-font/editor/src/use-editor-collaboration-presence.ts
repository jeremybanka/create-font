import type { CollaborationPresence } from "@create-art/realtime"
import { useCallback, useEffect, useRef, type RefObject } from "react"

import type { EditorCollaboration } from "./browser-api.ts"

type LocalCollaborationPresence = Omit<CollaborationPresence, "deviceId">
type UiPresence = NonNullable<CollaborationPresence["ui"]>

const EMPTY_LOCAL_PRESENCE: LocalCollaborationPresence = {
	context: { glyph: null, master: null, surface: null, textIndex: null },
	cursor: null,
	gesture: null,
	selection: [],
	selectionBox: null,
}

function clampUnit(value: number): number {
	return Math.max(0, Math.min(1, value))
}

export function measureUiPresence(
	root: HTMLElement,
	pointer: Readonly<{ x: number; y: number; target: Element | null }> | null,
): UiPresence {
	const viewportWidth = Math.max(1, window.innerWidth)
	const viewportHeight = Math.max(1, window.innerHeight)
	const measured = Array.from(
		root.querySelectorAll<HTMLElement>(`tile-column, collapsed-column`),
	).flatMap((element) => {
		const lane = element.closest<HTMLElement>(`tile-lane`)
		const bounds = element.getBoundingClientRect()
		const laneBounds = lane?.getBoundingClientRect()
		const minX = Math.max(0, bounds.left, laneBounds?.left ?? 0)
		const minY = Math.max(0, bounds.top, laneBounds?.top ?? 0)
		const maxX = Math.min(
			viewportWidth,
			bounds.right,
			laneBounds?.right ?? viewportWidth,
		)
		const maxY = Math.min(
			viewportHeight,
			bounds.bottom,
			laneBounds?.bottom ?? viewportHeight,
		)
		if (maxX - minX < 1 || maxY - minY < 1) return []
		return [
			{
				element,
				pixels: { minX, minY, maxX, maxY },
				normalized: {
					minX: clampUnit(minX / viewportWidth),
					minY: clampUnit(minY / viewportHeight),
					maxX: clampUnit(maxX / viewportWidth),
					maxY: clampUnit(maxY / viewportHeight),
				},
			},
		]
	})
	const columns = measured.slice(0, 8)
	const pointerColumn =
		pointer === null
			? undefined
			: columns.find(({ element, pixels }) => {
					return (
						pointer.target !== null &&
						element.contains(pointer.target) &&
						pointer.x >= pixels.minX &&
						pointer.x <= pixels.maxX &&
						pointer.y >= pixels.minY &&
						pointer.y <= pixels.maxY
					)
				})
	const pointerColumnIndex =
		pointerColumn === undefined ? -1 : columns.indexOf(pointerColumn)
	return {
		columns: columns.map(({ normalized }) => normalized),
		cursor:
			pointer === null || pointerColumn === undefined || pointerColumnIndex < 0
				? null
				: {
						column: pointerColumnIndex,
						x: clampUnit(
							(pointer.x - pointerColumn.pixels.minX) /
								(pointerColumn.pixels.maxX - pointerColumn.pixels.minX),
						),
						y: clampUnit(
							(pointer.y - pointerColumn.pixels.minY) /
								(pointerColumn.pixels.maxY - pointerColumn.pixels.minY),
						),
					},
	}
}

export function useEditorCollaborationPresence(options: {
	readonly activeMasterId: string
	readonly collaboration?: EditorCollaboration
	readonly layout: unknown
	readonly routeName: string
}): Readonly<{
	editorWorkspaceRef: RefObject<HTMLElement | null>
	publishPresence: EditorCollaboration["publishPresence"]
}> {
	const editorWorkspaceRef = useRef<HTMLElement>(null)
	const localPresenceRef =
		useRef<LocalCollaborationPresence>(EMPTY_LOCAL_PRESENCE)
	const uiPresenceRef = useRef<UiPresence | null>(null)
	const routeNameRef = useRef(options.routeName)
	routeNameRef.current = options.routeName
	const publishPresence = useCallback(
		(presence: LocalCollaborationPresence): void => {
			const currentRoute = routeNameRef.current
			const nextPresence =
				currentRoute === `canvas`
					? presence
					: {
							...presence,
							context: {
								...presence.context,
								glyph: null,
								surface: currentRoute,
								textIndex: null,
							},
							cursor: null,
							gesture: null,
							selection: [],
							selectionBox: null,
						}
			localPresenceRef.current = nextPresence
			options.collaboration?.publishPresence({
				...nextPresence,
				ui: uiPresenceRef.current,
			})
		},
		[options.collaboration],
	)

	useEffect(() => {
		if (options.collaboration === undefined || options.routeName === `canvas`)
			return
		publishPresence({
			context: {
				glyph: null,
				master: options.activeMasterId,
				surface: options.routeName,
				textIndex: null,
			},
			cursor: null,
			gesture: null,
			selection: [],
			selectionBox: null,
		})
	}, [
		options.activeMasterId,
		options.collaboration,
		options.routeName,
		publishPresence,
	])

	useEffect(() => {
		if (options.collaboration === undefined) return
		let frame: number | null = null
		let publishedUi: string | undefined
		let pointer: Readonly<{
			x: number
			y: number
			target: Element | null
		}> | null = null
		const publishMeasuredPresence = (): void => {
			frame = null
			const root = editorWorkspaceRef.current
			const ui =
				options.routeName === `canvas` && root !== null
					? measureUiPresence(root, pointer)
					: null
			const serializedUi = JSON.stringify(ui)
			if (serializedUi === publishedUi) return
			publishedUi = serializedUi
			uiPresenceRef.current = ui
			options.collaboration?.publishPresence({
				...localPresenceRef.current,
				ui,
			})
		}
		const scheduleMeasurement = (): void => {
			if (frame !== null) return
			frame = requestAnimationFrame(publishMeasuredPresence)
		}
		const handlePointerMove = (event: PointerEvent): void => {
			pointer = {
				x: event.clientX,
				y: event.clientY,
				target: event.target instanceof Element ? event.target : null,
			}
			scheduleMeasurement()
		}
		const clearPointer = (): void => {
			pointer = null
			scheduleMeasurement()
		}
		const root = editorWorkspaceRef.current
		const resizeObserver = new ResizeObserver(scheduleMeasurement)
		if (root !== null) {
			resizeObserver.observe(root)
			root.addEventListener(`transitionend`, scheduleMeasurement, true)
		}
		window.addEventListener(`pointermove`, handlePointerMove, { passive: true })
		window.addEventListener(`blur`, clearPointer)
		window.addEventListener(`resize`, scheduleMeasurement)
		scheduleMeasurement()
		return () => {
			if (frame !== null) cancelAnimationFrame(frame)
			resizeObserver.disconnect()
			root?.removeEventListener(`transitionend`, scheduleMeasurement, true)
			window.removeEventListener(`pointermove`, handlePointerMove)
			window.removeEventListener(`blur`, clearPointer)
			window.removeEventListener(`resize`, scheduleMeasurement)
		}
	}, [options.collaboration, options.layout, options.routeName])

	return { editorWorkspaceRef, publishPresence }
}
