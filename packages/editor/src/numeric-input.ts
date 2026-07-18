export function parseNumericInput(
	text: string,
	min: number,
	max: number,
	step: number | "any" = 1,
): number | null {
	if (text.trim() === "") return null
	const value = Number(text)
	return Number.isFinite(value) &&
		(step === "any" ||
			(step > 0 && Math.abs(value / step - Math.round(value / step)) < 1e-9)) &&
		value >= min &&
		value <= max
		? value
		: null
}

export function stepNumericInput(
	text: string,
	current: number,
	direction: -1 | 1,
	multiplier: 1 | 10 | 100,
	min: number,
	max: number,
	step: number | "any" = 1,
): number {
	const parsed = parseNumericInput(text, min, max, step) ?? current
	const increment = step === "any" ? 1 : step
	return Math.min(
		max,
		Math.max(min, parsed + direction * multiplier * increment),
	)
}
