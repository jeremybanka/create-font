import { describe, expect, it, vi } from "vitest"

import {
	initializeVelloHybridRuntime,
	probeVelloHybridCanvas,
	type VelloWasmLoader,
} from "../src/VelloHybridSurface.tsx"

const canvas = (context: object | null): HTMLCanvasElement =>
	({ getContext: vi.fn(() => context) }) as unknown as HTMLCanvasElement

describe("Vello Hybrid lifecycle", () => {
	it("falls back before loading Wasm when WebGL2 is unavailable", async () => {
		const load = vi.fn() as unknown as VelloWasmLoader
		const target = canvas(null)
		expect(probeVelloHybridCanvas(target)).toBe("WebGL2 is unavailable.")
		expect(await initializeVelloHybridRuntime(target, "{}", load)).toEqual({
			ok: false,
			reason: "WebGL2 is unavailable.",
		})
		expect(load).not.toHaveBeenCalled()
	})

	it("initializes once and renders the complete packet in one boundary call", async () => {
		const renderScene = vi.fn()
		const free = vi.fn()
		const load: VelloWasmLoader = async () => ({
			default: async () => undefined,
			abiVersion: () => 1,
			VelloHybridCanvasRenderer: class {
				renderScene = renderScene
				free = free
			},
		})
		const result = await initializeVelloHybridRuntime(
			canvas({}),
			'{"abiVersion":1,"draws":[]}',
			load,
		)
		expect(result.ok).toBe(true)
		expect(renderScene).toHaveBeenCalledOnce()
		expect(renderScene).toHaveBeenCalledWith('{"abiVersion":1,"draws":[]}')
	})

	it("keeps the caller on fallback when the ABI does not match", async () => {
		const result = await initializeVelloHybridRuntime(
			canvas({}),
			"{}",
			async () => ({
				default: async () => undefined,
				abiVersion: () => 2,
				VelloHybridCanvasRenderer: class {
					renderScene(): void {}
					free(): void {}
				},
			}),
		)
		expect(result).toEqual({
			ok: false,
			reason: "The Vello Wasm scene ABI does not match the editor.",
		})
	})
})
