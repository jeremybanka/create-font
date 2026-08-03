import type * as React from "react"
import type { ReactNode } from "react"
import { useId } from "react"

import css from "./TileTextField.module.css"

export type TileTextFieldProps = Omit<
	React.InputHTMLAttributes<HTMLInputElement>,
	"children" | "label" | "size"
> &
	Readonly<{
		description?: ReactNode
		error?: ReactNode
		label: ReactNode
	}>

export function TileTextField({
	description,
	disabled,
	error,
	id: providedId,
	label,
	...inputProps
}: TileTextFieldProps) {
	const generatedId = useId()
	const id = providedId ?? generatedId
	const descriptionId = `${id}-description`
	return (
		<tile-text-field
			className={css.class}
			data-disabled={disabled || undefined}
		>
			<label htmlFor={id}>
				<span>{label}</span>
				<input
					{...inputProps}
					id={id}
					disabled={disabled}
					aria-invalid={error === undefined ? undefined : true}
					aria-describedby={
						description === undefined && error === undefined
							? undefined
							: descriptionId
					}
				/>
			</label>
			{description === undefined && error === undefined ? null : (
				<small
					id={descriptionId}
					data-error={error === undefined ? undefined : true}
				>
					{error ?? description}
				</small>
			)}
		</tile-text-field>
	)
}
