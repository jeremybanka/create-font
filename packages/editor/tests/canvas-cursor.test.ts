import { describe, expect, it } from "vitest"

import { transformHandleCursor } from "../src/canvas-cursor.ts"

describe("transform handle cursors", () => {
	it("maps visible handle directions to conventional resize cursors", () => {
		expect(transformHandleCursor("north")).toBe("ns-resize")
		expect(transformHandleCursor("south")).toBe("ns-resize")
		expect(transformHandleCursor("east")).toBe("ew-resize")
		expect(transformHandleCursor("west")).toBe("ew-resize")
		expect(transformHandleCursor("north-west")).toBe("nwse-resize")
		expect(transformHandleCursor("south-east")).toBe("nwse-resize")
		expect(transformHandleCursor("north-east")).toBe("nesw-resize")
		expect(transformHandleCursor("south-west")).toBe("nesw-resize")
		expect(transformHandleCursor("inside")).toBe("default")
	})
})
