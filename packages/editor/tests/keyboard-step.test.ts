import { describe, expect, it } from "vitest"

import {
	keyboardStepMultiplier,
	stepBoundedNumber,
} from "../src/keyboard-step.ts"
import { stepNumericInput } from "../src/numeric-input.ts"

const modifiers = (
	overrides: Partial<{
		metaKey: boolean
		ctrlKey: boolean
		shiftKey: boolean
	}> = {},
) => ({ metaKey: false, ctrlKey: false, shiftKey: false, ...overrides })

describe("keyboard stepping", () => {
	it("uses platform Mod for 100 and lets Mod win over Shift", () => {
		expect(keyboardStepMultiplier(modifiers(), false)).toBe(1)
		expect(keyboardStepMultiplier(modifiers({ shiftKey: true }), false)).toBe(
			10,
		)
		expect(keyboardStepMultiplier(modifiers({ ctrlKey: true }), false)).toBe(
			100,
		)
		expect(
			keyboardStepMultiplier(
				modifiers({ metaKey: true, shiftKey: true }),
				true,
			),
		).toBe(100)
	})

	it("does not treat the foreign platform modifier as Mod", () => {
		expect(keyboardStepMultiplier(modifiers({ metaKey: true }), false)).toBe(1)
		expect(keyboardStepMultiplier(modifiers({ ctrlKey: true }), true)).toBe(1)
	})

	it("steps valid drafts, falls back to the committed value, and clamps", () => {
		expect(stepNumericInput("12", 5, 1, 10, -100, 100)).toBe(22)
		expect(stepNumericInput("", 5, -1, 100, -20, 20)).toBe(-20)
		expect(stepNumericInput("invalid", 5, 1, 100, -20, 20)).toBe(20)
	})

	it("steps and clamps decimal-valued Font Info fields by editor units", () => {
		expect(
			stepBoundedNumber(1.125, 1, modifiers({ shiftKey: true }), false),
		).toBe(11.125)
		expect(
			stepBoundedNumber(12, -1, modifiers({ ctrlKey: true }), false, 0, 20),
		).toBe(0)
	})
})
