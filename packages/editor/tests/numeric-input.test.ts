import { describe, expect, it } from "vitest"

import {
	evaluateNumericExpression,
	formatNumericInput,
	parseNumericInput,
	stepNumericInput,
	validateNumericInput,
} from "../src/numeric-input.ts"

function valueOf(text: string): number {
	const result = evaluateNumericExpression(text)
	expect(result.ok).toBe(true)
	if (!result.ok) throw new Error(result.error)
	return result.value
}

describe("numeric expressions", () => {
	it.each([
		["500 / 2", 250],
		["20 + 5 * 2", 30],
		["(20 + 5) * 2", 50],
		["  -10 + +2 ", -8],
		["8 / 4 / 2", 1],
		["8 - 4 - 2", 2],
		["10 / -2", -5],
		["-.5 * (2 + 2)", -2],
		["5.", 5],
	])("evaluates %s with precedence and associativity", (text, expected) => {
		expect(valueOf(text)).toBe(expected)
	})

	it("normalizes decimal artifacts and leading zeroes", () => {
		expect(evaluateNumericExpression("0.1 + 0.2")).toEqual({
			ok: true,
			value: 0.3,
			normalized: "0.3",
		})
		expect(evaluateNumericExpression("050 + 10")).toEqual({
			ok: true,
			value: 60,
			normalized: "60",
		})
		expect(formatNumericInput(1e-7)).toBe("0.0000001")
		expect(formatNumericInput(-1e21)).toBe("-1000000000000000000000")
	})

	it.each([
		["", "Enter a number or expression."],
		["1 +", "Enter a complete arithmetic expression."],
		["(1 + 2", "Enter a complete arithmetic expression."],
		["1 / 0", "Cannot divide by zero."],
		["Infinity", "Enter a complete arithmetic expression."],
		["2 ** 3", "Enter a complete arithmetic expression."],
		["2(3)", "Enter a complete arithmetic expression."],
		["Math.random()", "Enter a complete arithmetic expression."],
		["1e3", "Enter a complete arithmetic expression."],
		["9".repeat(309), "Result must be finite."],
	])("rejects out-of-grammar input %j", (text, error) => {
		expect(evaluateNumericExpression(text)).toEqual({ ok: false, error })
	})

	it("bounds expression length and nesting", () => {
		expect(evaluateNumericExpression("1".repeat(1_001))).toEqual({
			ok: false,
			error: "Expression is too long.",
		})
		const result = evaluateNumericExpression(
			`${"(".repeat(101)}1${")".repeat(101)}`,
		)
		expect(result).toEqual({
			ok: false,
			error: "Expression is nested too deeply.",
		})
	})
})

describe("numeric field contracts", () => {
	it("validates integer and decimal fields after evaluation", () => {
		expect(validateNumericInput("5 / 2", { step: 1 })).toEqual({
			ok: false,
			error: "Result must be a whole number.",
		})
		expect(validateNumericInput("1 + .125", { step: 0.001 })).toEqual({
			ok: true,
			value: 1.125,
			normalized: "1.125",
		})
		expect(validateNumericInput("1.23", { step: 0.1 })).toEqual({
			ok: false,
			error: "Result must use increments of 0.1.",
		})
		expect(validateNumericInput("1 / 3", { step: "any" })).toEqual({
			ok: true,
			value: 0.333333333333333,
			normalized: "0.333333333333333",
		})
	})

	it("reports finite and one-sided bounds without clamping", () => {
		expect(validateNumericInput("101", { min: 0, max: 100 })).toEqual({
			ok: false,
			error: "Result must be between 0 and 100.",
		})
		expect(validateNumericInput("-1", { min: 0 })).toEqual({
			ok: false,
			error: "Result must be at least 0.",
		})
		expect(validateNumericInput("11", { max: 10 })).toEqual({
			ok: false,
			error: "Result must be at most 10.",
		})
	})

	it("keeps the compatibility parser and expression-aware stepping", () => {
		expect(parseNumericInput("(20 + 5) * 2", 0, 100)).toBe(50)
		expect(parseNumericInput("5 / 2", 0, 100)).toBeNull()
		expect(stepNumericInput("10 + 2", 5, 1, 10, -100, 100)).toBe(22)
		expect(stepNumericInput("1 +", 5, -1, 100, -20, 20)).toBe(-20)
	})

	it("preserves decimal base steps and absolute 10/100 modified steps", () => {
		expect(stepNumericInput("1.125", 1.125, 1, 1, -1_000, 1_000, 0.001)).toBe(
			1.126,
		)
		expect(
			stepNumericInput(
				"1.125",
				1.125,
				1,
				10,
				-1_000,
				1_000,
				0.001,
				undefined,
				1,
			),
		).toBe(11.125)
		expect(
			stepNumericInput("1.1", 1.1, -1, 100, -1_000, 1_000, 0.1, undefined, 1),
		).toBe(-98.9)
	})
})
