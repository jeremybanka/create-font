import type { PointId } from "@create-font/states"
import { describe, expect, it, vi } from "vitest"

import { editorControlHitRadii } from "../src/canvas-hit-testing.ts"
import {
	DEFAULT_VISUAL_DEBUG_STATE,
	toggleVisualDebug,
	visualDebugControlRegions,
	visualDebugPaletteCommands,
} from "../src/visual-debug.ts"

const pointId = (value: string) => `point:${value}` as PointId

describe("visual debug", () => {
	it("creates palette toggles with an explicit current status", () => {
		const onToggle = vi.fn()
		const off = visualDebugPaletteCommands(
			DEFAULT_VISUAL_DEBUG_STATE,
			onToggle,
		)[0]
		expect(off).toMatchObject({
			id: "visual-debug:hit-targets",
			category: "Visual Debug",
			status: "Off",
			checked: false,
		})

		const enabled = toggleVisualDebug(DEFAULT_VISUAL_DEBUG_STATE, "hit-targets")
		const on = visualDebugPaletteCommands(enabled, onToggle)[0]
		expect(on?.status).toBe("On")
		expect(on?.checked).toBe(true)
		on?.do()
		expect(onToggle).toHaveBeenCalledWith("hit-targets")
	})

	it("describes the exact effective regions, including coincident ownership", () => {
		const candidates = [
			{
				target: { kind: "node" as const, pointId: pointId("z") },
				x: 0,
				y: 0,
			},
			{
				target: { kind: "node" as const, pointId: pointId("a") },
				x: 0,
				y: 0,
			},
			{
				target: { kind: "node" as const, pointId: pointId("nearby") },
				x: 8,
				y: 0,
			},
		]
		const regions = visualDebugControlRegions(
			candidates,
			editorControlHitRadii(candidates, 1),
		)
		expect(regions).toEqual([
			{
				key: "node/point:z",
				x: 0,
				y: 0,
				radiusPx: 0,
				coincidentNonOwner: true,
			},
			{
				key: "node/point:a",
				x: 0,
				y: 0,
				radiusPx: 4,
				coincidentNonOwner: false,
			},
			{
				key: "node/point:nearby",
				x: 8,
				y: 0,
				radiusPx: 4,
				coincidentNonOwner: false,
			},
		])
	})
})
