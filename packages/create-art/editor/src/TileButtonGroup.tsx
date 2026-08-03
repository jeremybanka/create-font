import type { ReactNode } from "react"

import css from "./TileButtonGroup.module.css"

export function TileButtonGroup({
	"aria-label": ariaLabel,
	children,
	compact = false,
}: Readonly<{
	"aria-label": string
	children: ReactNode
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
