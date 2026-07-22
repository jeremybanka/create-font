import type { JSX } from "preact"

import css from "./AppAnchor.module.css"
import type { Pathname } from "./routing.ts"

export type AppAnchorProps = Omit<
	JSX.HTMLAttributes<HTMLAnchorElement>,
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
