import { act, createElement, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"

declare global {
	var IS_REACT_ACT_ENVIRONMENT: boolean
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const roots = new WeakMap<Element, Root>()

export { act, createElement as h }

export function render(node: ReactNode, host: Element): void {
	const mounted = roots.get(host)
	if (node === null) {
		if (mounted === undefined) return
		act(() => mounted.unmount())
		roots.delete(host)
		return
	}
	const root = mounted ?? createRoot(host)
	if (mounted === undefined) roots.set(host, root)
	act(() => root.render(node))
}
