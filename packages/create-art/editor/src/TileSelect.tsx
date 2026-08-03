import type * as React from "react"
import type { ReactNode } from "react"
import { useId } from "react"

import css from "./TileSelect.module.css"

export type TileSelectProps = Omit<
	React.SelectHTMLAttributes<HTMLSelectElement>,
	"label" | "size"
> &
	Readonly<{
		description?: ReactNode
		error?: ReactNode
		label: ReactNode
	}>

export function TileSelect({
	children,
	description,
	disabled,
	error,
	id: providedId,
	label,
	...selectProps
}: TileSelectProps) {
	const generatedId = useId()
	const id = providedId ?? generatedId
	const descriptionId = `${id}-description`
	return (
		<tile-select className={css.class} data-disabled={disabled || undefined}>
			<label htmlFor={id}>
				<span>{label}</span>
				<select
					{...selectProps}
					id={id}
					disabled={disabled}
					aria-invalid={error === undefined ? undefined : true}
					aria-describedby={
						description === undefined && error === undefined
							? undefined
							: descriptionId
					}
				>
					{children}
				</select>
			</label>
			{description === undefined && error === undefined ? null : (
				<small
					id={descriptionId}
					data-error={error === undefined ? undefined : true}
				>
					{error ?? description}
				</small>
			)}
		</tile-select>
	)
}
