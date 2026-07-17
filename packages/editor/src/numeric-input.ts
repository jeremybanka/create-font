export function parseNumericInput(
	text: string,
	min: number,
	max: number,
): number | null {
	if (text.trim() === "") return null
	const value = Number(text)
	return Number.isFinite(value) &&
		Number.isInteger(value) &&
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
): number {
	const parsed = parseNumericInput(text, min, max) ?? current
	return Math.min(max, Math.max(min, parsed + direction * multiplier))
}
