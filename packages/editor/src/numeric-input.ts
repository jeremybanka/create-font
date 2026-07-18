export type NumericStep = number | "any"

export interface NumericInputContract {
	readonly min?: number
	readonly max?: number
	readonly step?: NumericStep
}

export type NumericInputValidation =
	| { readonly ok: true; readonly value: number; readonly normalized: string }
	| { readonly ok: false; readonly error: string }

interface Rational {
	readonly numerator: bigint
	readonly denominator: bigint
}

type RationalResult =
	| { readonly ok: true; readonly value: Rational }
	| { readonly ok: false; readonly error: string }

const MAX_EXPRESSION_LENGTH = 1_000
const MAX_EXPRESSION_DEPTH = 100
const REPEATING_SIGNIFICANT_DIGITS = 15
const DECIMAL_LITERAL = /^(?:\d+(?:\.\d*)?|\.\d+)/

class ArithmeticParser {
	#index = 0
	#depth = 0
	#error: string | null = null
	readonly text: string

	constructor(text: string) {
		this.text = text
	}

	parse(): RationalResult {
		if (this.text.trim() === "")
			return rationalInvalid("Enter a number or expression.")
		if (this.text.length > MAX_EXPRESSION_LENGTH)
			return rationalInvalid("Expression is too long.")
		const value = this.#expression()
		this.#whitespace()
		if (this.#error !== null) return rationalInvalid(this.#error)
		if (value === null || this.#index !== this.text.length)
			return rationalInvalid("Enter a complete arithmetic expression.")
		return { ok: true, value }
	}

	#expression(): Rational | null {
		let value = this.#term()
		while (value !== null) {
			const operator = this.#operator("+-")
			if (operator === null) return value
			const right = this.#term()
			if (right === null) return null
			value =
				operator === "+"
					? addRational(value, right)
					: subtractRational(value, right)
		}
		return null
	}

	#term(): Rational | null {
		let value = this.#unary()
		while (value !== null) {
			const operator = this.#operator("*/")
			if (operator === null) return value
			const right = this.#unary()
			if (right === null) return null
			if (operator === "/" && right.numerator === 0n) {
				this.#error = "Cannot divide by zero."
				return null
			}
			value =
				operator === "*"
					? multiplyRational(value, right)
					: divideRational(value, right)
		}
		return null
	}

	#unary(): Rational | null {
		this.#whitespace()
		const operator = this.text[this.#index]
		if (operator !== "+" && operator !== "-") return this.#primary()
		this.#index += 1
		if (!this.#enter()) return null
		const value = this.#unary()
		this.#leave()
		return value === null || operator === "+"
			? value
			: { numerator: -value.numerator, denominator: value.denominator }
	}

	#primary(): Rational | null {
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
		return decimalToRational(literal)
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

function rationalInvalid(error: string): RationalResult {
	return { ok: false, error }
}

/** Evaluates the deliberately small arithmetic grammar without executing code. */
export function evaluateNumericExpression(
	text: string,
): NumericInputValidation {
	const result = new ArithmeticParser(text).parse()
	return result.ok ? finalizeRational(result.value) : result
}

/** Evaluates and then checks a result against a field's numeric contract. */
export function validateNumericInput(
	text: string,
	contract: NumericInputContract = {},
): NumericInputValidation {
	const parsed = new ArithmeticParser(text).parse()
	if (!parsed.ok) return parsed
	const value = parsed.value
	const min = contract.min ?? Number.NEGATIVE_INFINITY
	const max = contract.max ?? Number.POSITIVE_INFINITY
	const step = contract.step ?? 1
	const belowMin =
		Number.isFinite(min) && compareRational(value, numberToRational(min)) < 0
	const aboveMax =
		Number.isFinite(max) && compareRational(value, numberToRational(max)) > 0
	if (belowMin || aboveMax) {
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
		if (step === 1 && value.numerator % value.denominator !== 0n)
			return invalid("Result must be a whole number.")
		const stepValue = numberToRational(step)
		const ratioNumerator = value.numerator * stepValue.denominator
		const ratioDenominator = value.denominator * stepValue.numerator
		if (ratioNumerator % ratioDenominator !== 0n)
			return invalid(
				`Result must use increments of ${formatNumericInput(step)}.`,
			)
	}
	return finalizeRational(value)
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
	arrowStep = 1,
): number {
	const parsed = parseNumericInput(text, min, max, step) ?? current
	const stepped = addRational(
		numberToRational(parsed),
		numberToRational(direction * multiplier * arrowStep),
	)
	if (
		Number.isFinite(min) &&
		compareRational(stepped, numberToRational(min)) < 0
	)
		return min
	if (
		Number.isFinite(max) &&
		compareRational(stepped, numberToRational(max)) > 0
	)
		return max
	const result = finalizeRational(stepped)
	return result.ok ? result.value : parsed
}

/** Produces a grammar-compatible decimal without altering the supplied number. */
export function formatNumericInput(value: number): string {
	const text = String(value)
	if (!Number.isFinite(value) || !/[eE]/.test(text)) return text
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

function finalizeRational(value: Rational): NumericInputValidation {
	const terminating = isTerminatingRational(value)
	const rationalText = terminating
		? formatTerminatingRational(value)
		: formatRepeatingRational(value)
	const numberValue = Number(rationalText)
	if (!Number.isFinite(numberValue)) return invalid("Result must be finite.")
	const exactNumber = equalRational(numberToRational(numberValue), value)
	return {
		ok: true,
		value: numberValue,
		normalized:
			terminating && !exactNumber
				? formatNumericInput(numberValue)
				: rationalText,
	}
}

function decimalToRational(text: string): Rational {
	const [integer = "0", fraction = ""] = text.split(".")
	const digits = `${integer === "" ? "0" : integer}${fraction}`
	return normalizeRational(BigInt(digits), 10n ** BigInt(fraction.length))
}

function numberToRational(value: number): Rational {
	const match = /^(-?)(\d+)(?:\.(\d*))?(?:e([+-]?\d+))?$/i.exec(String(value))
	if (match === null)
		throw new Error(`Cannot convert non-finite number to rational.`)
	const [, sign = "", integer = "0", fraction = "", exponentText = "0"] = match
	const exponent = Number(exponentText) - fraction.length
	let numerator = BigInt(`${integer}${fraction}`)
	let denominator = 1n
	if (exponent >= 0) numerator *= 10n ** BigInt(exponent)
	else denominator = 10n ** BigInt(-exponent)
	if (sign === "-") numerator = -numerator
	return normalizeRational(numerator, denominator)
}

function normalizeRational(numerator: bigint, denominator: bigint): Rational {
	if (denominator < 0n) {
		numerator = -numerator
		denominator = -denominator
	}
	if (numerator === 0n) return { numerator: 0n, denominator: 1n }
	const divisor = greatestCommonDivisor(numerator, denominator)
	return { numerator: numerator / divisor, denominator: denominator / divisor }
}

function greatestCommonDivisor(left: bigint, right: bigint): bigint {
	let a = left < 0n ? -left : left
	let b = right
	while (b !== 0n) [a, b] = [b, a % b]
	return a
}

function addRational(left: Rational, right: Rational): Rational {
	return normalizeRational(
		left.numerator * right.denominator + right.numerator * left.denominator,
		left.denominator * right.denominator,
	)
}

function subtractRational(left: Rational, right: Rational): Rational {
	return normalizeRational(
		left.numerator * right.denominator - right.numerator * left.denominator,
		left.denominator * right.denominator,
	)
}

function multiplyRational(left: Rational, right: Rational): Rational {
	return normalizeRational(
		left.numerator * right.numerator,
		left.denominator * right.denominator,
	)
}

function divideRational(left: Rational, right: Rational): Rational {
	return normalizeRational(
		left.numerator * right.denominator,
		left.denominator * right.numerator,
	)
}

function compareRational(left: Rational, right: Rational): number {
	const difference =
		left.numerator * right.denominator - right.numerator * left.denominator
	return difference < 0n ? -1 : difference > 0n ? 1 : 0
}

function equalRational(left: Rational, right: Rational): boolean {
	return (
		left.numerator === right.numerator && left.denominator === right.denominator
	)
}

function isTerminatingRational(value: Rational): boolean {
	let denominator = value.denominator
	while (denominator % 2n === 0n) denominator /= 2n
	while (denominator % 5n === 0n) denominator /= 5n
	return denominator === 1n
}

function formatTerminatingRational(value: Rational): string {
	const negative = value.numerator < 0n
	let numerator = negative ? -value.numerator : value.numerator
	let denominator = value.denominator
	let twos = 0
	let fives = 0
	while (denominator % 2n === 0n) {
		denominator /= 2n
		twos += 1
	}
	while (denominator % 5n === 0n) {
		denominator /= 5n
		fives += 1
	}
	const scale = Math.max(twos, fives)
	numerator *= 2n ** BigInt(scale - twos)
	numerator *= 5n ** BigInt(scale - fives)
	const digits = numerator.toString().padStart(scale + 1, "0")
	const unsigned =
		scale === 0 ? digits : `${digits.slice(0, -scale)}.${digits.slice(-scale)}`
	return negative ? `-${unsigned}` : unsigned
}

function formatRepeatingRational(value: Rational): string {
	const negative = value.numerator < 0n
	const numerator = negative ? -value.numerator : value.numerator
	const integer = numerator / value.denominator
	let remainder = numerator % value.denominator
	const integerText = integer.toString()
	const fraction: string[] = []
	if (integer !== 0n) {
		const count = Math.max(0, REPEATING_SIGNIFICANT_DIGITS - integerText.length)
		for (let index = 0; index < count; index += 1) {
			remainder *= 10n
			fraction.push((remainder / value.denominator).toString())
			remainder %= value.denominator
		}
	} else {
		let significant = 0
		let started = false
		while (significant < REPEATING_SIGNIFICANT_DIGITS) {
			remainder *= 10n
			const digit = remainder / value.denominator
			fraction.push(digit.toString())
			remainder %= value.denominator
			if (digit !== 0n) started = true
			if (started) significant += 1
		}
	}
	const unsigned =
		fraction.length === 0 ? integerText : `${integerText}.${fraction.join("")}`
	return negative ? `-${unsigned}` : unsigned
}
