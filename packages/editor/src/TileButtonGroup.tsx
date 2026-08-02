import type { ComponentChildren } from "preact"

import css from "./TileButtonGroup.module.css"

export function TileButtonGroup({
	"aria-label": ariaLabel,
	children,
	compact = false,
}: Readonly<{
	"aria-label": string
	children: ComponentChildren
	compact?: boolean
}>) {
	return (
		<tile-button-group
			className={css.class}
			role="group"
			aria-label={ariaLabel}
			data-compact={compact || undefined}
		>
			{children}
		</tile-button-group>
	)
}
