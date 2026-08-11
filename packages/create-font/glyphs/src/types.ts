import type { EditorFontSource } from "@create-font/states"

import type {
	GlyphsSourceDiagnostic,
	GlyphsSourceDiagnosticCode,
} from "./glyphs-source-types.ts"

export type GlyphsImportDiagnosticCode =
	| GlyphsSourceDiagnosticCode
	| "glyphs.component_cycle"
	| "glyphs.invalid_node"
	| "glyphs.missing_component"
	| "glyphs.missing_layer"
	| "glyphs.unsupported_curve"
	| "glyphs.unsupported_data"
	| "glyphs.unsupported_feature"
	| "glyphs.unsupported_kerning"

export interface GlyphsImportDiagnostic {
	readonly severity: "error" | "warning"
	readonly code: GlyphsImportDiagnosticCode
	/** Property path in the parsed Glyphs source. */
	readonly path: string
	readonly message: string
	readonly line?: number
	readonly column?: number
}

export interface ImportedGlyphsSource {
	readonly source: EditorFontSource
	/** A best-effort Adobe feature source assembled from Glyphs classes and features. */
	readonly featureSource?: string
	readonly warnings: readonly GlyphsImportDiagnostic[]
}

export type GlyphsImportResult =
	| { readonly ok: true; readonly value: ImportedGlyphsSource }
	| {
			readonly ok: false
			readonly errors: readonly [
				GlyphsImportDiagnostic,
				...GlyphsImportDiagnostic[],
			]
	  }

export function importDiagnosticFromSource(
	diagnostic: GlyphsSourceDiagnostic,
): GlyphsImportDiagnostic {
	return {
		severity: diagnostic.severity,
		code: diagnostic.code,
		path: diagnostic.path,
		message: diagnostic.message,
		...(diagnostic.span === undefined
			? {}
			: {
					line: diagnostic.span.line,
					column: diagnostic.span.column,
				}),
	}
}
