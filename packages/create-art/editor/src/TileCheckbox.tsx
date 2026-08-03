import type { ComponentChildren, JSX } from "preact"
import { useId } from "preact/hooks"

import css from "./TileCheckbox.module.css"

export type TileCheckboxProps = Omit<
	JSX.InputHTMLAttributes<HTMLInputElement>,
	"children" | "label" | "size" | "type"
> &
	Readonly<{
		description?: ComponentChildren
		label: ComponentChildren
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
			<label for={id}>
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
