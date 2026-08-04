import { useEffect, useRef } from "react"
import type { CSSProperties, KeyboardEvent } from "react"

import type { DesignObject } from "./types.ts"
import { designTextOverlayStyle } from "./design-text.ts"

export type TextEditingSurfaceProps = Readonly<{
	object: DesignObject
	view: Readonly<{ x: number; y: number }>
	worldScale: number
	onChange: (text: string) => void
	onExit: () => void
	onSelectionChange?: (
		selection: Readonly<{ start: number; end: number }>,
	) => void
	initialSelection?: Readonly<{ start: number; end: number }>
}>

export function TextEditingSurface({
	object,
	view,
	worldScale,
	onChange,
	onExit,
	onSelectionChange,
	initialSelection,
}: TextEditingSurfaceProps) {
	const textareaRef = useRef<HTMLTextAreaElement>(null)
	const composingRef = useRef(false)
	useEffect(() => {
		const textarea = textareaRef.current
		if (textarea === null) return
		textarea.focus()
		const start = initialSelection?.start ?? textarea.value.length
		const end = initialSelection?.end ?? textarea.value.length
		textarea.setSelectionRange(start, end)
		onSelectionChange?.({ start, end })
	}, [object.id])
	if (object.geometry.kind !== "text") return <text-editing-surface />
	const synchronizeSelection = (): void => {
		const textarea = textareaRef.current
		if (textarea === null) return
		onSelectionChange?.({
			start: textarea.selectionStart,
			end: textarea.selectionEnd,
		})
	}
	const isolateKeyboard = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
		event.stopPropagation()
		if (event.key !== "Escape" || composingRef.current) return
		event.preventDefault()
		onExit()
	}
	return (
		<text-editing-surface>
			<textarea
				ref={textareaRef}
				data-design-text-editor
				aria-label={`Edit ${object.name}`}
				aria-description="Native text editor. Escape returns to object selection. Typography controls apply to the complete text object."
				value={object.geometry.text}
				spellCheck
				dir={object.geometry.typography.direction === "rtl" ? "rtl" : "auto"}
				style={
					{
						...designTextOverlayStyle(
							object as DesignObject & {
								readonly geometry: typeof object.geometry
							},
							view,
							worldScale,
						),
					} as CSSProperties
				}
				onChange={(event) => onChange(event.currentTarget.value)}
				onSelect={synchronizeSelection}
				onKeyDown={isolateKeyboard}
				onKeyUp={(event) => {
					event.stopPropagation()
					synchronizeSelection()
				}}
				onCopy={(event) => event.stopPropagation()}
				onCut={(event) => event.stopPropagation()}
				onPaste={(event) => event.stopPropagation()}
				onCompositionStart={(event) => {
					event.stopPropagation()
					composingRef.current = true
				}}
				onCompositionEnd={(event) => {
					event.stopPropagation()
					composingRef.current = false
					onChange(event.currentTarget.value)
				}}
			/>
		</text-editing-surface>
	)
}
