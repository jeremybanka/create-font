import type { JSX } from "preact"

import type { Pathname } from "./routing.ts"

export type AppAnchorProps = Omit<
	JSX.HTMLAttributes<HTMLAnchorElement>,
	"href"
> & {
	readonly href: Pathname
}

export function AppAnchor(props: AppAnchorProps) {
	return (
		<app-anchor>
			<a {...props} />
		</app-anchor>
	)
}
