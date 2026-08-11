import { describe, expect, it } from "vitest"

import {
	addDesignGuide,
	clipDesignGuideToBounds,
	constrainGuidePointToAngle,
	deleteDesignGuide,
	designGuideAngle,
	distanceToDesignGuide,
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
		const guide = { id: "guide:x", a: { x: 42, y: 0 }, b: { x: 42, y: 1 } }
		expect(guideScreenPosition(guide, { x: 10, y: 20, zoom: 1 }, 2)).toBe(94)
		expect(guideScreenPosition(guide, { x: -30, y: 999, zoom: 4 }, 8)).toBe(306)
		expect(guide.a.x).toBe(42)
	})

	it("creates, moves, locks, unlocks, and deletes guides separately from artwork", () => {
		const original = createInitialDocument()
		const guide = { id: "guide:test", a: { x: 0, y: 120 }, b: { x: 1, y: 120 } }
		const added = addDesignGuide(original, guide)
		expect(added.objects).toBe(original.objects)
		const moved = updateDesignGuide(added, guide.id, {
			a: { x: 0, y: 140 },
			b: { x: 1, y: 140 },
		})
		expect(moved.guides[0]?.a.y).toBe(140)
		const locked = updateDesignGuide(moved, guide.id, { locked: true })
		expect(
			updateDesignGuide(locked, guide.id, {
				a: { x: 0, y: 160 },
				b: { x: 1, y: 160 },
			}),
		).toBeTruthy()
		expect(
			updateDesignGuide(locked, guide.id, {
				a: { x: 0, y: 160 },
				b: { x: 1, y: 160 },
			}).guides[0]?.a.y,
		).toBe(140)
		expect(deleteDesignGuide(locked, guide.id)).toBe(locked)
		const unlocked = updateDesignGuide(locked, guide.id, { locked: false })
		expect(deleteDesignGuide(unlocked, guide.id).guides).toHaveLength(0)
	})

	it("constrains, clips, and measures arbitrary infinite lines", () => {
		const constrained = constrainGuidePointToAngle(
			{ x: 10, y: 20 },
			{ x: 30, y: 31 },
		)
		expect(designGuideAngle({ a: { x: 10, y: 20 }, b: constrained })).toBe(30)
		const guide = {
			id: "guide:diagonal",
			a: { x: 0, y: 0 },
			b: { x: 10, y: 10 },
		}
		expect(
			clipDesignGuideToBounds(guide, {
				minX: -5,
				minY: 0,
				maxX: 20,
				maxY: 15,
			}),
		).toEqual([0, 0, 15, 15])
		expect(distanceToDesignGuide({ x: 10, y: 0 }, guide)).toBeCloseTo(
			Math.sqrt(50),
		)
	})

	it("locks and unlocks every guide with canonical no-op behavior", () => {
		const source = {
			...createInitialDocument(),
			guides: [
				{
					id: "guide:x",
					a: { x: 10, y: 0 },
					b: { x: 10, y: 1 },
					locked: true,
				},
				{ id: "guide:y", a: { x: 0, y: 20 }, b: { x: 1, y: 20 } },
			],
		}
		const locked = setDesignGuidesLocked(source, true)
		expect(locked.guides.every((guide) => guide.locked)).toBe(true)
		expect(setDesignGuidesLocked(locked, true)).toBe(locked)
		const unlocked = setDesignGuidesLocked(locked, false)
		expect(unlocked.guides).toEqual([
			{ id: "guide:x", a: { x: 10, y: 0 }, b: { x: 10, y: 1 } },
			{ id: "guide:y", a: { x: 0, y: 20 }, b: { x: 1, y: 20 } },
		])
	})
})
