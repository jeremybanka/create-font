import { describe, expect, it } from "vitest"

import {
	INITIAL_TOOLTIP_INTENT,
	nextTooltipIntent,
	tooltipWantsToOpen,
} from "../src/tooltip-interaction.ts"

describe(`tooltip interaction intent`, () => {
	it(`tracks pointer and keyboard focus independently`, () => {
		const pointed = nextTooltipIntent(INITIAL_TOOLTIP_INTENT, `pointer-enter`)
		expect(tooltipWantsToOpen(pointed, false)).toBe(true)
		const focused = nextTooltipIntent(pointed, `focus`)
		expect(
			tooltipWantsToOpen(nextTooltipIntent(focused, `pointer-leave`), false),
		).toBe(true)
		expect(tooltipWantsToOpen(nextTooltipIntent(focused, `blur`), false)).toBe(
			true,
		)
	})

	it(`dismisses on Escape and activation until the active trigger exits`, () => {
		const focused = nextTooltipIntent(INITIAL_TOOLTIP_INTENT, `focus`)
		const escaped = nextTooltipIntent(focused, `escape`)
		expect(tooltipWantsToOpen(escaped, false)).toBe(false)
		expect(tooltipWantsToOpen(nextTooltipIntent(escaped, `focus`), false)).toBe(
			true,
		)

		const pointed = nextTooltipIntent(INITIAL_TOOLTIP_INTENT, `pointer-enter`)
		expect(
			tooltipWantsToOpen(nextTooltipIntent(pointed, `activate`), false),
		).toBe(false)
	})

	it(`only suppresses controls without tooltip content and resets intent`, () => {
		const focused = nextTooltipIntent(INITIAL_TOOLTIP_INTENT, `focus`)
		expect(tooltipWantsToOpen(focused, true)).toBe(false)
		expect(tooltipWantsToOpen(focused, false)).toBe(true)
		expect(nextTooltipIntent(focused, `disable`)).toBe(INITIAL_TOOLTIP_INTENT)
	})
})
