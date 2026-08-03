import { describe, expect, it, vi } from "vitest"

import { selectionProportionPaletteCommand } from "../src/selection-proportions.ts"

describe("selection proportion command", () => {
	it("exposes one stateful link action to editor command surfaces", () => {
		const onToggle = vi.fn()
		const off = selectionProportionPaletteCommand(false, onToggle)
		expect(off).toMatchObject({
			id: "constrain-proportions",
			displayName: "Constrain Proportions",
			category: "Selection",
			icon: "Link1Icon",
			status: "Off",
			checked: false,
		})

		const active = selectionProportionPaletteCommand(true, onToggle)
		expect(active.status).toBe("Active")
		expect(active.checked).toBe(true)
		active.do()
		expect(onToggle).toHaveBeenCalledOnce()
	})
})
