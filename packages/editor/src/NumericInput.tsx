import type { JSX } from "preact"
import { useEffect, useRef, useState } from "preact/hooks"

import { parseNumericInput } from "./numeric-input.ts"

export interface NumericInputProps {
	readonly "aria-label": string
	readonly value: number
	readonly min: number
	readonly max: number
	readonly onCommit: (value: number) => void
}

export function NumericInput(props: NumericInputProps) {
	const [draft, setDraft] = useState(String(props.value))
	const editing = useRef(false)
	useEffect(() => {
		if (!editing.current) setDraft(String(props.value))
	}, [props.value])
	const commit = (): void => {
		const value = parseNumericInput(draft, props.min, props.max)
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
				step="1"
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
					if (event.key === "Enter") {
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
