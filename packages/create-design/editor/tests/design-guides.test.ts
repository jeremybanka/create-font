import { describe, expect, it } from "vitest"

import {
	addDesignGuide,
	deleteDesignGuide,
	designRulerTicks,
	guideScreenPosition,
	setDesignGuidesLocked,
	updateDesignGuide,
} from "../src/design-guides.ts"
import { createInitialDocument } from "../src/document.ts"

describe("design rulers and guides", () => {
	it("creates readable deterministic ruler ticks at every zoom", () => {
		const one = designRulerTicks(-20, 80, 1)
		const four = designRulerTicks(-20, 80, 4)
		expect(one).toEqual(designRulerTicks(-20, 80, 1))
		expect(one.length).toBeLessThan(four.length)
		expect(one.some(({ major }) => major)).toBe(true)
	})

	it("keeps guide geometry stable through pan and zoom", () => {
		const guide = { id: "guide:x", axis: "x" as const, value: 42 }
		expect(guideScreenPosition(guide, { x: 10, y: 20, zoom: 1 }, 2)).toBe(94)
		expect(guideScreenPosition(guide, { x: -30, y: 999, zoom: 4 }, 8)).toBe(306)
		expect(guide.value).toBe(42)
	})

	it("creates, moves, locks, unlocks, and deletes guides separately from artwork", () => {
		const original = createInitialDocument()
		const guide = { id: "guide:test", axis: "y" as const, value: 120 }
		const added = addDesignGuide(original, guide)
		expect(added.objects).toBe(original.objects)
		const moved = updateDesignGuide(added, guide.id, { value: 140 })
		expect(moved.guides[0]?.value).toBe(140)
		const locked = updateDesignGuide(moved, guide.id, { locked: true })
		expect(updateDesignGuide(locked, guide.id, { value: 160 })).toBeTruthy()
		expect(
			updateDesignGuide(locked, guide.id, { value: 160 }).guides[0]?.value,
		).toBe(140)
		expect(deleteDesignGuide(locked, guide.id)).toBe(locked)
		const unlocked = updateDesignGuide(locked, guide.id, { locked: false })
		expect(deleteDesignGuide(unlocked, guide.id).guides).toHaveLength(0)
	})

	it("locks and unlocks every guide with canonical no-op behavior", () => {
		const source = {
			...createInitialDocument(),
			guides: [
				{ id: "guide:x", axis: "x" as const, value: 10, locked: true },
				{ id: "guide:y", axis: "y" as const, value: 20 },
			],
		}
		const locked = setDesignGuidesLocked(source, true)
		expect(locked.guides.every((guide) => guide.locked)).toBe(true)
		expect(setDesignGuidesLocked(locked, true)).toBe(locked)
		const unlocked = setDesignGuidesLocked(locked, false)
		expect(unlocked.guides).toEqual([
			{ id: "guide:x", axis: "x", value: 10 },
			{ id: "guide:y", axis: "y", value: 20 },
		])
	})
})
