export type NumericStep = number | "any"

export interface NumericInputContract {
	readonly min?: number
	readonly max?: number
	readonly step?: NumericStep
}

export type NumericInputValidation =
	| { readonly ok: true; readonly value: number; readonly normalized: string }
	| { readonly ok: false; readonly error: string }

const MAX_EXPRESSION_LENGTH = 1_000
const MAX_EXPRESSION_DEPTH = 100
const DECIMAL_LITERAL = /^(?:\d+(?:\.\d*)?|\.\d+)/

class ArithmeticParser {
	#index = 0
	#depth = 0
	#error: string | null = null
	readonly text: string

	constructor(text: string) {
		this.text = text
	}

	parse(): NumericInputValidation {
		if (this.text.trim() === "") return invalid("Enter a number or expression.")
		if (this.text.length > MAX_EXPRESSION_LENGTH)
			return invalid("Expression is too long.")
		const value = this.#expression()
		this.#whitespace()
		if (this.#error !== null) return invalid(this.#error)
		if (value === null || this.#index !== this.text.length)
			return invalid("Enter a complete arithmetic expression.")
		if (!Number.isFinite(value)) return invalid("Result must be finite.")
		const stableValue = stableNumericValue(value)
		return {
			ok: true,
			value: stableValue,
			normalized: formatNumericInput(stableValue),
		}
	}

	#expression(): number | null {
		let value = this.#term()
		while (value !== null) {
			const operator = this.#operator("+-")
			if (operator === null) return value
			const right = this.#term()
			if (right === null) return null
			value = operator === "+" ? value + right : value - right
			if (!Number.isFinite(value)) {
				this.#error = "Result must be finite."
				return null
			}
		}
		return null
	}

	#term(): number | null {
		let value = this.#unary()
		while (value !== null) {
			const operator = this.#operator("*/")
			if (operator === null) return value
			const right = this.#unary()
			if (right === null) return null
			if (operator === "/" && right === 0) {
				this.#error = "Cannot divide by zero."
				return null
			}
			value = operator === "*" ? value * right : value / right
			if (!Number.isFinite(value)) {
				this.#error = "Result must be finite."
				return null
			}
		}
		return null
	}

	#unary(): number | null {
		this.#whitespace()
		const operator = this.text[this.#index]
		if (operator !== "+" && operator !== "-") return this.#primary()
		this.#index += 1
		if (!this.#enter()) return null
		const value = this.#unary()
		this.#leave()
		return value === null ? null : operator === "-" ? -value : value
	}

	#primary(): number | null {
		this.#whitespace()
		if (this.text[this.#index] === "(") {
			this.#index += 1
			if (!this.#enter()) return null
			const value = this.#expression()
			this.#leave()
			this.#whitespace()
			if (value === null || this.text[this.#index] !== ")") {
				this.#error ??= "Enter a complete arithmetic expression."
				return null
			}
			this.#index += 1
			return value
		}
		const literal = DECIMAL_LITERAL.exec(this.text.slice(this.#index))?.[0]
		if (literal === undefined) {
			this.#error = "Enter a complete arithmetic expression."
			return null
		}
		this.#index += literal.length
		const value = Number(literal)
		if (!Number.isFinite(value)) {
			this.#error = "Result must be finite."
			return null
		}
		return value
	}

	#operator(operators: string): string | null {
		this.#whitespace()
		const operator = this.text[this.#index]
		if (operator === undefined || !operators.includes(operator)) return null
		this.#index += 1
		return operator
	}

	#whitespace(): void {
		while (/\s/.test(this.text[this.#index] ?? "")) this.#index += 1
	}

	#enter(): boolean {
		this.#depth += 1
		if (this.#depth <= MAX_EXPRESSION_DEPTH) return true
		this.#error = "Expression is nested too deeply."
		return false
	}

	#leave(): void {
		this.#depth -= 1
	}
}

function invalid(error: string): NumericInputValidation {
	return { ok: false, error }
}

/** Evaluates the deliberately small arithmetic grammar without executing code. */
export function evaluateNumericExpression(
	text: string,
): NumericInputValidation {
	return new ArithmeticParser(text).parse()
}

/** Evaluates and then checks a result against a field's numeric contract. */
export function validateNumericInput(
	text: string,
	contract: NumericInputContract = {},
): NumericInputValidation {
	const evaluated = evaluateNumericExpression(text)
	if (!evaluated.ok) return evaluated
	const min = contract.min ?? Number.NEGATIVE_INFINITY
	const max = contract.max ?? Number.POSITIVE_INFINITY
	const step = contract.step ?? 1
	if (evaluated.value < min || evaluated.value > max) {
		if (Number.isFinite(min) && Number.isFinite(max))
			return invalid(
				`Result must be between ${formatNumericInput(min)} and ${formatNumericInput(max)}.`,
			)
		if (Number.isFinite(min))
			return invalid(`Result must be at least ${formatNumericInput(min)}.`)
		return invalid(`Result must be at most ${formatNumericInput(max)}.`)
	}
	if (step !== "any") {
		if (!(step > 0) || !Number.isFinite(step))
			return invalid("Numeric field has an invalid step.")
		if (step === 1 && !Number.isInteger(evaluated.value))
			return invalid("Result must be a whole number.")
		const quotient = evaluated.value / step
		if (Math.abs(quotient - Math.round(quotient)) > 1e-9)
			return invalid(
				`Result must use increments of ${formatNumericInput(step)}.`,
			)
	}
	return evaluated
}

export function parseNumericInput(
	text: string,
	min: number,
	max: number,
	step: NumericStep = 1,
): number | null {
	const result = validateNumericInput(text, { min, max, step })
	return result.ok ? result.value : null
}

export function stepNumericInput(
	text: string,
	current: number,
	direction: -1 | 1,
	multiplier: 1 | 10 | 100,
	min: number,
	max: number,
	step: NumericStep = 1,
	arrowStep: number = step === "any" ? 1 : step,
): number {
	const parsed = parseNumericInput(text, min, max, step) ?? current
	return stableNumericValue(
		Math.min(max, Math.max(min, parsed + direction * multiplier * arrowStep)),
	)
}

/** Produces a stable, grammar-compatible decimal without binary-float noise. */
export function formatNumericInput(value: number): string {
	if (!Number.isFinite(value)) return String(value)
	const text = String(stableNumericValue(value))
	if (!/[eE]/.test(text)) return text
	const [coefficient = "0", exponentText = "0"] = text.toLowerCase().split("e")
	const exponent = Number(exponentText)
	const negative = coefficient.startsWith("-")
	const digits = coefficient.replace("-", "").replace(".", "")
	const fractionLength = coefficient.includes(".")
		? coefficient.length - coefficient.indexOf(".") - 1
		: 0
	const decimalIndex = digits.length - fractionLength + exponent
	const expanded =
		decimalIndex <= 0
			? `0.${"0".repeat(-decimalIndex)}${digits}`
			: decimalIndex >= digits.length
				? `${digits}${"0".repeat(decimalIndex - digits.length)}`
				: `${digits.slice(0, decimalIndex)}.${digits.slice(decimalIndex)}`
	return negative ? `-${expanded}` : expanded
}

function stableNumericValue(value: number): number {
	return Number.isFinite(value) ? Number(value.toPrecision(15)) : value
}
