export type GlyphsSourceValue =
	| string
	| readonly GlyphsSourceValue[]
	| GlyphsSourceDictionary

export interface GlyphsSourceDictionary {
	readonly [key: string]: GlyphsSourceValue
}

export type GlyphsSourceFormatVersion = 2 | 3

export interface GlyphsSourceSpan {
	readonly start: number
	readonly end: number
	readonly line: number
	readonly column: number
}

export type GlyphsSourceDiagnosticCode =
	| "glyphs.invalid_value"
	| "glyphs.parse"
	| "glyphs.resource_limit"
	| "glyphs.unsupported_version"

export interface GlyphsSourceDiagnostic {
	readonly severity: "error"
	readonly code: GlyphsSourceDiagnosticCode
	readonly path: string
	readonly message: string
	readonly span?: GlyphsSourceSpan
}

/** Complete parsed Glyphs source before any create-font-specific lowering. */
export interface GlyphsSourceDocument {
	readonly format: "glyphs.source"
	readonly formatVersion: GlyphsSourceFormatVersion
	/** Unknown and version-specific properties remain available in this tree. */
	readonly root: GlyphsSourceDictionary
	/** Original source retained for inspection and future round-trip tooling. */
	readonly rawSource: string
}

export type GlyphsSourceParseResult =
	| { readonly ok: true; readonly value: GlyphsSourceDocument }
	| {
			readonly ok: false
			readonly errors: readonly [
				GlyphsSourceDiagnostic,
				...GlyphsSourceDiagnostic[],
			]
	  }
