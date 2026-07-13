import Konva from "konva/lib/Core"
import { Circle, Group, Layer, Line, Path, Rect, Stage } from "../src/index.ts"
import { describe, expect, it } from "vitest"

describe("public Preact-Konva entrypoint", () => {
	it("initializes Konva's shared drag manager", () => {
		expect(Konva.DD).toBeDefined()
		expect(Konva.isDragging()).toBe(false)
	})

	it("exports the supported scene components", () => {
		expect([Stage, Layer, Group, Rect, Circle, Line, Path]).toHaveLength(7)
	})
})
