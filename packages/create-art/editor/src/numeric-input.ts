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

function invalid(
	error: string,
): Extract<NumericInputValidation, { readonly ok: false }> {
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
	const exactError = validateRationalContract(value, contract)
	if (exactError !== null) return invalid(exactError)
	const finalized = finalizeRational(value)
	if (!finalized.ok) return finalized
	const representedError = validateRationalContract(
		numberToRational(finalized.value),
		contract,
	)
	return representedError === null ? finalized : invalid(representedError)
}

function validateRationalContract(
	value: Rational,
	contract: NumericInputContract,
): string | null {
	const min = contract.min ?? Number.NEGATIVE_INFINITY
	const max = contract.max ?? Number.POSITIVE_INFINITY
	const step = contract.step ?? 1
	const belowMin =
		Number.isFinite(min) && compareRational(value, numberToRational(min)) < 0
	const aboveMax =
		Number.isFinite(max) && compareRational(value, numberToRational(max)) > 0
	if (belowMin || aboveMax) {
		if (Number.isFinite(min) && Number.isFinite(max))
			return `Result must be between ${formatNumericInput(min)} and ${formatNumericInput(max)}.`
		if (Number.isFinite(min))
			return `Result must be at least ${formatNumericInput(min)}.`
		return `Result must be at most ${formatNumericInput(max)}.`
	}
	if (step !== "any") {
		if (!(step > 0) || !Number.isFinite(step))
			return "Numeric field has an invalid step."
		if (step === 1 && value.numerator % value.denominator !== 0n)
			return "Result must be a whole number."
		const stepValue = numberToRational(step)
		const ratioNumerator = value.numerator * stepValue.denominator
		const ratioDenominator = value.denominator * stepValue.numerator
		if (ratioNumerator % ratioDenominator !== 0n)
			return `Result must use increments of ${formatNumericInput(step)}.`
	}
	return null
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
	const quantized = arrowStep === 1 ? roundRationalToInteger(stepped) : stepped
	if (
		Number.isFinite(min) &&
		compareRational(quantized, numberToRational(min)) < 0
	)
		return min
	if (
		Number.isFinite(max) &&
		compareRational(quantized, numberToRational(max)) > 0
	)
		return max
	const result = finalizeRational(quantized)
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
	const converted = rationalToNumber(value)
	if (!converted.ok) return converted
	return {
		ok: true,
		value: converted.value,
		normalized: formatNumericInput(converted.value),
	}
}

function rationalToNumber(
	value: Rational,
):
	| { readonly ok: true; readonly value: number }
	| { readonly ok: false; readonly error: string } {
	if (value.numerator === 0n) return { ok: true, value: 0 }
	const negative = value.numerator < 0n
	const numerator = negative ? -value.numerator : value.numerator
	const denominator = value.denominator
	let exponent = bitLength(numerator) - bitLength(denominator)
	if (
		(exponent >= 0 && numerator < denominator << BigInt(exponent)) ||
		(exponent < 0 && numerator << BigInt(-exponent) < denominator)
	)
		exponent -= 1

	let magnitude: number
	if (exponent >= -1_022) {
		if (exponent > 1_023) return invalid("Result must be finite.")
		const shift = 52 - exponent
		let significand =
			shift >= 0
				? divideRoundToEven(numerator << BigInt(shift), denominator)
				: divideRoundToEven(numerator, denominator << BigInt(-shift))
		if (significand === 2n ** 53n) {
			significand >>= 1n
			exponent += 1
		}
		if (exponent > 1_023) return invalid("Result must be finite.")
		magnitude = Number(significand) * 2 ** (exponent - 52)
	} else {
		const significand = divideRoundToEven(numerator << 1_074n, denominator)
		if (significand === 0n) return invalid("Result is too small to represent.")
		magnitude = Number(significand) * Number.MIN_VALUE
	}
	if (!Number.isFinite(magnitude)) return invalid("Result must be finite.")
	return { ok: true, value: negative ? -magnitude : magnitude }
}

function bitLength(value: bigint): number {
	return value.toString(2).length
}

function divideRoundToEven(numerator: bigint, denominator: bigint): bigint {
	let quotient = numerator / denominator
	const remainder = numerator % denominator
	const comparison = remainder * 2n - denominator
	if (comparison > 0n || (comparison === 0n && quotient % 2n !== 0n))
		quotient += 1n
	return quotient
}

/** Matches Math.round's positive-infinity tie rule without losing precision. */
function roundRationalToInteger(value: Rational): Rational {
	const quotient = value.numerator / value.denominator
	const remainder = value.numerator % value.denominator
	const doubledRemainder = (remainder < 0n ? -remainder : remainder) * 2n
	if (doubledRemainder < value.denominator)
		return { numerator: quotient, denominator: 1n }
	if (remainder > 0n || doubledRemainder > value.denominator)
		return {
			numerator: quotient + (remainder > 0n ? 1n : -1n),
			denominator: 1n,
		}
	return { numerator: quotient, denominator: 1n }
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
