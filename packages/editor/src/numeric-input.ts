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
