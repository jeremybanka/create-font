import type * as React from "react"

import css from "./TileButton.module.css"

export type TileButtonTone = "default" | "primary" | "danger"

export type TileButtonProps = Omit<
	React.ComponentPropsWithRef<"button">,
	"size"
> &
	Readonly<{
		compact?: boolean
		iconOnly?: boolean
		tone?: TileButtonTone
	}>

export function TileButton({
	compact = false,
	iconOnly = false,
	tone = "default",
	type = "button",
	...props
}: TileButtonProps) {
	return (
		<tile-button className={css.class}>
			<button
				{...props}
				data-compact={compact || undefined}
				data-icon-only={iconOnly || undefined}
				data-tone={tone}
				type={type}
			/>
		</tile-button>
	)
}
