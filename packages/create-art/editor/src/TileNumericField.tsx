import type { ComponentChildren } from "preact"
import { useId } from "preact/hooks"

import { NumericInput, type NumericInputProps } from "./NumericInput.tsx"
import css from "./TileNumericField.module.css"

export type TileNumericFieldProps = Omit<NumericInputProps, "aria-label"> &
	Readonly<{
		description?: ComponentChildren
		disabled?: boolean
		error?: ComponentChildren
		id?: string
		label: ComponentChildren
	}>

export function TileNumericField({
	description,
	disabled,
	error,
	id: providedId,
	label,
	...numericProps
}: TileNumericFieldProps) {
	const generatedId = useId()
	const id = providedId ?? generatedId
	const descriptionId = `${id}-description`
	return (
		<tile-numeric-field
			className={css.class}
			data-disabled={disabled || undefined}
		>
			<label for={id}>
				<span>{label}</span>
				<NumericInput
					{...numericProps}
					id={id}
					{...(disabled === undefined ? {} : { disabled })}
					aria-label={typeof label === "string" ? label : "Numeric value"}
					{...(description === undefined && error === undefined
						? {}
						: { "aria-describedby": descriptionId })}
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
		</tile-numeric-field>
	)
}
