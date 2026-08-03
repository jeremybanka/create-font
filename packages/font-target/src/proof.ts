import type { VariableFont } from "./model.ts"

const validatedFonts = new WeakSet<object>()

export function markVariableFontValidated(font: VariableFont): void {
	validatedFonts.add(font)
}

export function assertVariableFontValidated(
	font: unknown,
): asserts font is VariableFont {
	if (typeof font !== "object" || font === null || !validatedFonts.has(font)) {
		throw new TypeError(
			"Expected a VariableFont returned by ingestVariableFont().",
		)
	}
}
