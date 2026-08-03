import type { Join, TreePath } from "treetrunks"
import { isTreePath, optional } from "treetrunks"

export const ROUTES = optional({
	glyphs: null,
	info: null,
})

export type Route = TreePath<typeof ROUTES>
export type Pathname = `/${Join<Route, `/`>}`
export type RouteName = "canvas" | "glyphs" | "info"

export function isRoute(path: unknown[]): path is Route {
	return isTreePath(ROUTES, path)
}

export function routeName(route: Readonly<Route>): RouteName {
	if (route.length === 0) return "canvas"
	return route[0]
}
