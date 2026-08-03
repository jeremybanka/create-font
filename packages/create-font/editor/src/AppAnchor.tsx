import type * as React from "react"

import css from "./AppAnchor.module.css"
import type { Pathname } from "./routing.ts"

export type AppAnchorProps = Omit<
	React.HTMLAttributes<HTMLAnchorElement>,
	"href"
> & {
	readonly href: Pathname
}

export function AppAnchor(props: AppAnchorProps) {
	return (
		<app-anchor className={css.class}>
			<a {...props} />
		</app-anchor>
	)
}
