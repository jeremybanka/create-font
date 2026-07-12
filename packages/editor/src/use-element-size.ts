import { useLayoutEffect, useRef, useState } from "preact/hooks"

export interface ElementSize {
	readonly width: number
	readonly height: number
}

export function useElementSize<Element extends HTMLElement>() {
	const ref = useRef<Element>(null)
	const [size, setSize] = useState<ElementSize>({ width: 1, height: 1 })
	useLayoutEffect(() => {
		const element = ref.current
		if (element === null) return
		const update = (): void => {
			const bounds = element.getBoundingClientRect()
			setSize({
				width: Math.max(1, Math.round(bounds.width)),
				height: Math.max(1, Math.round(bounds.height)),
			})
		}
		update()
		const observer = new ResizeObserver(update)
		observer.observe(element)
		return () => observer.disconnect()
	}, [])
	return { ref, ...size }
}
