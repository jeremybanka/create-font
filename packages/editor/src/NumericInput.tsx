import type { JSX } from "preact"
import { useEffect, useId, useRef, useState } from "preact/hooks"

import css from "./NumericInput.module.css"
import { IS_MAC_LIKE } from "./editor-tools-and-hotkeys.ts"
import { keyboardStepMultiplier } from "./keyboard-step.ts"
import {
	formatNumericInput,
	type NumericStep,
	stepNumericInput,
	validateNumericInput,
} from "./numeric-input.ts"

export interface NumericInputProps {
	readonly "aria-label": string
	readonly value: number
	readonly min?: number
	readonly max?: number
	readonly step?: NumericStep
	/** The unmodified Arrow key increment. */
	readonly arrowStep?: number
	readonly disabled?: boolean
	readonly onCommit: (value: number) => void
}

export function NumericInput(props: NumericInputProps) {
	const committedText = formatNumericInput(props.value)
	const [draft, setDraft] = useState(committedText)
	const [error, setError] = useState<string | null>(null)
	const [announcement, setAnnouncement] = useState<string | null>(null)
	const editing = useRef(false)
	const errorId = useId()
	const min = props.min ?? Number.NEGATIVE_INFINITY
	const max = props.max ?? Number.POSITIVE_INFINITY
	const step = props.step ?? 1
	useEffect(() => {
		if (editing.current) return
		setDraft(committedText)
		setError(null)
		setAnnouncement(null)
	}, [committedText])

	const reset = (): void => {
		editing.current = false
		setDraft(committedText)
		setError(null)
		setAnnouncement(null)
	}
	const validate = (text: string) =>
		validateNumericInput(text, { min, max, step })
	const commit = (reason: "enter" | "blur"): boolean => {
		if (!editing.current) return true
		const result = validate(draft)
		if (!result.ok) {
			if (reason === "enter") {
				setError(result.error)
				setAnnouncement(result.error)
				return false
			}
			editing.current = false
			setDraft(committedText)
			setError(null)
			setAnnouncement(`Edit rejected. ${result.error}`)
			return false
		}
		editing.current = false
		setDraft(result.normalized)
		setError(null)
		setAnnouncement(null)
		if (result.value !== props.value) props.onCommit(result.value)
		return true
	}

	return (
		<numeric-input className={css.class}>
			<input
				type="text"
				role="spinbutton"
				inputMode="decimal"
				spellcheck={false}
				disabled={props.disabled}
				aria-label={props["aria-label"]}
				aria-valuemin={Number.isFinite(min) ? min : undefined}
				aria-valuemax={Number.isFinite(max) ? max : undefined}
				aria-valuenow={props.value}
				aria-valuetext={draft}
				aria-invalid={error === null ? undefined : true}
				aria-errormessage={error === null ? undefined : errorId}
				aria-describedby={announcement === null ? undefined : errorId}
				value={draft}
				onFocus={() => {
					editing.current = true
					setAnnouncement(null)
				}}
				onInput={(event) => {
					const nextDraft = event.currentTarget.value
					setDraft(nextDraft)
					if (error !== null) {
						const result = validate(nextDraft)
						setError(result.ok ? null : result.error)
						setAnnouncement(result.ok ? null : result.error)
					}
				}}
				onBlur={() => commit("blur")}
				onKeyDown={(event: JSX.TargetedKeyboardEvent<HTMLInputElement>) => {
					if (event.key === "ArrowUp" || event.key === "ArrowDown") {
						event.preventDefault()
						const value = stepNumericInput(
							draft,
							props.value,
							event.key === "ArrowUp" ? 1 : -1,
							keyboardStepMultiplier(event, IS_MAC_LIKE),
							min,
							max,
							step,
							props.arrowStep,
						)
						setDraft(formatNumericInput(value))
						setError(null)
						setAnnouncement(null)
						if (value !== props.value) props.onCommit(value)
					} else if (event.key === "Enter") {
						event.preventDefault()
						if (commit("enter")) event.currentTarget.blur()
					} else if (event.key === "Escape") {
						event.preventDefault()
						reset()
						event.currentTarget.blur()
					}
				}}
			/>
			<output id={errorId} role="status" aria-live="polite">
				{announcement}
			</output>
		</numeric-input>
	)
}
