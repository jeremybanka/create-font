import type * as React from "react"
import type { ReactNode } from "react"
import { useId } from "react"

import css from "./TileCheckbox.module.css"

export type TileCheckboxProps = Omit<
	React.InputHTMLAttributes<HTMLInputElement>,
	"children" | "label" | "size" | "type"
> &
	Readonly<{
		description?: ReactNode
		label: ReactNode
	}>

export function TileCheckbox({
	description,
	disabled,
	id: providedId,
	label,
	...inputProps
}: TileCheckboxProps) {
	const generatedId = useId()
	const id = providedId ?? generatedId
	const descriptionId = `${id}-description`
	return (
		<tile-checkbox className={css.class} data-disabled={disabled || undefined}>
			<label htmlFor={id}>
				<input
					{...inputProps}
					id={id}
					type="checkbox"
					disabled={disabled}
					aria-describedby={
						description === undefined ? undefined : descriptionId
					}
				/>
				<span>{label}</span>
			</label>
			{description === undefined ? null : (
				<small id={descriptionId}>{description}</small>
			)}
		</tile-checkbox>
	)
}
