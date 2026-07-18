import type { JSX } from "preact"
import { useEffect, useRef, useState } from "preact/hooks"

import { IS_MAC_LIKE } from "./editor-tools-and-hotkeys.ts"
import { keyboardStepMultiplier } from "./keyboard-step.ts"
import { parseNumericInput, stepNumericInput } from "./numeric-input.ts"

export interface NumericInputProps {
	readonly "aria-label": string
	readonly value: number
	readonly min: number
	readonly max: number
	readonly step?: number | "any"
	readonly disabled?: boolean
	readonly onCommit: (value: number) => void
}

export function NumericInput(props: NumericInputProps) {
	const [draft, setDraft] = useState(String(props.value))
	const editing = useRef(false)
	useEffect(() => {
		if (!editing.current) setDraft(String(props.value))
	}, [props.value])
	const commit = (): void => {
		if (!editing.current) return
		const value = parseNumericInput(draft, props.min, props.max, props.step)
		editing.current = false
		if (value === null) {
			setDraft(String(props.value))
			return
		}
		setDraft(String(value))
		if (value !== props.value) props.onCommit(value)
	}
	return (
		<numeric-input>
			<input
				type="number"
				step={props.step ?? 1}
				disabled={props.disabled}
				aria-label={props["aria-label"]}
				min={props.min}
				max={props.max}
				value={draft}
				onFocus={() => {
					editing.current = true
				}}
				onInput={(event) => setDraft(event.currentTarget.value)}
				onBlur={commit}
				onKeyDown={(event: JSX.TargetedKeyboardEvent<HTMLInputElement>) => {
					if (event.key === "ArrowUp" || event.key === "ArrowDown") {
						event.preventDefault()
						const value = stepNumericInput(
							draft,
							props.value,
							event.key === "ArrowUp" ? 1 : -1,
							keyboardStepMultiplier(event, IS_MAC_LIKE),
							props.min,
							props.max,
							props.step,
						)
						setDraft(String(value))
						if (value !== props.value) props.onCommit(value)
					} else if (event.key === "Enter") {
						event.preventDefault()
						commit()
						event.currentTarget.blur()
					} else if (event.key === "Escape") {
						event.preventDefault()
						editing.current = false
						setDraft(String(props.value))
						event.currentTarget.blur()
					}
				}}
			/>
		</numeric-input>
	)
}
