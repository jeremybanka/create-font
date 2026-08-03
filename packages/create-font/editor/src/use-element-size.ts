import { useLayoutEffect, useRef, useState } from "react"

export interface ElementSize {
	readonly width: number
	readonly height: number
	readonly usable: boolean
}

export function useElementSize<Element extends HTMLElement>() {
	const ref = useRef<Element>(null)
	const [size, setSize] = useState<ElementSize>({
		width: 1,
		height: 1,
		usable: false,
	})
	useLayoutEffect(() => {
		const element = ref.current
		if (element === null) return
		const update = (): void => {
			const bounds = element.getBoundingClientRect()
			setSize({
				width: Math.max(1, Math.round(bounds.width)),
				height: Math.max(1, Math.round(bounds.height)),
				usable:
					Number.isFinite(bounds.width) &&
					bounds.width > 0 &&
					Number.isFinite(bounds.height) &&
					bounds.height > 0,
			})
		}
		update()
		const observer = new ResizeObserver(update)
		observer.observe(element)
		return () => observer.disconnect()
	}, [])
	return { ref, ...size }
}
