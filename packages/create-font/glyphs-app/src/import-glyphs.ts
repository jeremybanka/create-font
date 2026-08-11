import { parseGlyphsSource } from "./glyphs-source-parser.ts"
import { lowerGlyphsSource } from "./lower-glyphs-source.ts"
import type { GlyphsImportResult } from "./types.ts"
import { importDiagnosticFromSource } from "./types.ts"

/** Parse and lower an editable Glyphs.app `.glyphs` text source. */
export function importGlyphsSource(text: string): GlyphsImportResult {
	const parsed = parseGlyphsSource(text)
	if (!parsed.ok) {
		const [first, ...rest] = parsed.errors
		return {
			ok: false,
			errors: [
				importDiagnosticFromSource(first),
				...rest.map(importDiagnosticFromSource),
			],
		}
	}
	return lowerGlyphsSource(parsed.value)
}
