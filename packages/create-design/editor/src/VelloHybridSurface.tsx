/* eslint-disable lasertag/export-own-component-only -- The lifecycle helpers are deliberately testable without mounting React. */
import { useEffect, useRef } from "react"

export type VelloHybridRuntimeStatus =
	| Readonly<{ state: "idle" | "loading" }>
	| Readonly<{ state: "ready" }>
	| Readonly<{ state: "fallback"; reason: string }>

type VelloRenderer = Readonly<{
	renderScene(packetJson: string): void
	free(): void
}>

export type VelloWasmModule = Readonly<{
	default(): Promise<unknown>
	abiVersion(): number
	VelloHybridCanvasRenderer: new (canvas: HTMLCanvasElement) => VelloRenderer
}>

export type VelloWasmLoader = () => Promise<VelloWasmModule>

const defaultLoader: VelloWasmLoader = () =>
	import("@create-design/vello-hybrid-wasm") as Promise<VelloWasmModule>

export function probeVelloHybridCanvas(
	canvas: HTMLCanvasElement,
): string | null {
	if (typeof WebAssembly === "undefined") return "WebAssembly is unavailable."
	try {
		return canvas.getContext("webgl2", { antialias: false, depth: true }) ===
			null
			? "WebGL2 is unavailable."
			: null
	} catch (error) {
		return error instanceof Error ? error.message : "WebGL2 probing failed."
	}
}

export async function initializeVelloHybridRuntime(
	canvas: HTMLCanvasElement,
	packetJson: string,
	loadWasm: VelloWasmLoader,
): Promise<
	| Readonly<{ ok: true; renderer: VelloRenderer }>
	| Readonly<{ ok: false; reason: string }>
> {
	const unavailable = probeVelloHybridCanvas(canvas)
	if (unavailable !== null) return { ok: false, reason: unavailable }
	try {
		const module = await loadWasm()
		await module.default()
		if (module.abiVersion() !== 1)
			return {
				ok: false,
				reason: "The Vello Wasm scene ABI does not match the editor.",
			}
		const renderer = new module.VelloHybridCanvasRenderer(canvas)
		renderer.renderScene(packetJson)
		return { ok: true, renderer }
	} catch (error) {
		return {
			ok: false,
			reason:
				error instanceof Error
					? error.message
					: "Vello Hybrid initialization failed.",
		}
	}
}

export function VelloHybridSurface({
	width,
	height,
	packetJson,
	fallbackReason,
	onStatusChange,
	loadWasm = defaultLoader,
}: Readonly<{
	width: number
	height: number
	packetJson: string | null
	fallbackReason?: string
	onStatusChange: (status: VelloHybridRuntimeStatus) => void
	loadWasm?: VelloWasmLoader
}>) {
	const canvasRef = useRef<HTMLCanvasElement>(null)
	const rendererRef = useRef<VelloRenderer | null>(null)
	const packetRef = useRef(packetJson)
	packetRef.current = packetJson

	useEffect(() => {
		const canvas = canvasRef.current
		if (canvas === null || packetRef.current === null) {
			onStatusChange({
				state: "fallback",
				reason: fallbackReason ?? "No renderable Vello scene.",
			})
			return
		}
		let cancelled = false
		const contextLost = (event: Event): void => {
			event.preventDefault()
			onStatusChange({
				state: "fallback",
				reason: "The Vello WebGL2 context was lost; Konva remains active.",
			})
		}
		canvas.addEventListener("webglcontextlost", contextLost)
		onStatusChange({ state: "loading" })
		void initializeVelloHybridRuntime(canvas, packetRef.current, loadWasm).then(
			(result) => {
				if (cancelled) {
					if (result.ok) result.renderer.free()
					return
				}
				if (!result.ok) {
					onStatusChange({
						state: "fallback",
						reason: result.reason,
					})
					return
				}
				rendererRef.current = result.renderer
				onStatusChange({ state: "ready" })
			},
		)
		return () => {
			cancelled = true
			canvas.removeEventListener("webglcontextlost", contextLost)
			rendererRef.current?.free()
			rendererRef.current = null
		}
	}, [fallbackReason, loadWasm, onStatusChange])

	useEffect(() => {
		if (packetJson === null || rendererRef.current === null) return
		try {
			rendererRef.current.renderScene(packetJson)
		} catch (error) {
			onStatusChange({
				state: "fallback",
				reason:
					error instanceof Error
						? error.message
						: "Vello Hybrid rendering failed.",
			})
		}
	}, [onStatusChange, packetJson])

	return (
		<vello-hybrid-surface>
			<canvas
				ref={canvasRef}
				width={width}
				height={height}
				aria-hidden="true"
			/>
		</vello-hybrid-surface>
	)
}
