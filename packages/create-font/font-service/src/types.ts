export type FontDiagnosticCode =
	| "font.malformed"
	| "font.missing"
	| "font.unsupported-table"
	| "glyph.missing"
	| "variation.out-of-range"
	| "variation.unsupported-axis"

export interface FontDiagnostic {
	readonly code: FontDiagnosticCode
	readonly message: string
	readonly severity: "error" | "warning"
	readonly font?: FontIdentity
	readonly glyphId?: number
	readonly textIndex?: number
	readonly table?: string
}

export interface FontIdentityDescriptor {
	/** Stable application-owned source identifier, not a path. */
	readonly source: string
	readonly family: string
	readonly faceIndex?: number
	readonly revision: string | number
}

export interface FontIdentity extends FontIdentityDescriptor {
	readonly faceIndex: number
	readonly binaryHash: string
	readonly key: string
}

export interface RegisteredFont {
	readonly identity: FontIdentity
	readonly byteLength: number
}

export type TextDirection = "auto" | "ltr" | "rtl" | "ttb" | "btt"

export interface FontFeature {
	readonly tag: string
	readonly value?: number
	readonly start?: number
	readonly end?: number
}

export type VariationCoordinates = Readonly<Record<string, number>>

export interface ShapeTextRequest {
	readonly font: FontIdentity
	readonly text: string
	readonly direction?: TextDirection
	readonly script?: string
	readonly language?: string
	readonly features?: readonly FontFeature[]
	readonly variations?: VariationCoordinates
	/** Baseline-to-baseline distance in font units. */
	readonly lineHeight?: number
}

export interface FontAxis {
	readonly tag: string
	readonly min: number
	readonly default: number
	readonly max: number
}

export interface FontMetrics {
	readonly unitsPerEm: number
	readonly ascender: number
	readonly descender: number
	readonly lineGap: number
	readonly axes: readonly FontAxis[]
}

export interface GlyphBounds {
	readonly x: number
	readonly y: number
	readonly width: number
	readonly height: number
}

export interface PositionedGlyph {
	readonly glyphId: number
	readonly cluster: number
	readonly clusterEnd: number
	readonly lineIndex: number
	readonly x: number
	readonly y: number
	readonly xAdvance: number
	readonly yAdvance: number
	readonly xOffset: number
	readonly yOffset: number
	readonly bounds?: GlyphBounds
}

export interface ShapedLine {
	readonly textStart: number
	readonly textEnd: number
	readonly breakEnd: number
	readonly baseline: number
	readonly advanceX: number
	readonly advanceY: number
	readonly glyphStart: number
	readonly glyphEnd: number
}

export interface ShapedText {
	readonly font: FontIdentity
	readonly text: string
	readonly direction: Exclude<TextDirection, "auto">
	readonly metrics: FontMetrics
	readonly lineHeight: number
	readonly glyphs: readonly PositionedGlyph[]
	readonly lines: readonly ShapedLine[]
	readonly diagnostics: readonly FontDiagnostic[]
}

export type OutlineCommand =
	| Readonly<{ type: "M" | "L"; x: number; y: number }>
	| Readonly<{ type: "Q"; cx: number; cy: number; x: number; y: number }>
	| Readonly<{
			type: "C"
			c1x: number
			c1y: number
			c2x: number
			c2y: number
			x: number
			y: number
	  }>
	| Readonly<{ type: "Z" }>

export interface GlyphOutlineRequest {
	readonly font: FontIdentity
	readonly glyphId: number
	readonly variations?: VariationCoordinates
}

export interface GlyphOutline {
	readonly font: FontIdentity
	readonly glyphId: number
	readonly commands: readonly OutlineCommand[]
	readonly bounds?: GlyphBounds
	readonly diagnostics: readonly FontDiagnostic[]
}

export interface FontResult<T> {
	readonly value?: T
	readonly diagnostics: readonly FontDiagnostic[]
}

export interface FontServiceCacheStats {
	readonly parsing: Readonly<{ entries: number; hits: number; misses: number }>
	readonly shaping: Readonly<{ entries: number; hits: number; misses: number }>
	readonly metrics: Readonly<{ entries: number; hits: number; misses: number }>
	readonly outlines: Readonly<{ entries: number; hits: number; misses: number }>
}

export interface FontService {
	registerFont(
		descriptor: FontIdentityDescriptor,
		bytes: Uint8Array | ArrayBuffer,
	): FontResult<RegisteredFont>
	unregisterFont(font: FontIdentity): boolean
	metrics(
		font: FontIdentity,
		variations?: VariationCoordinates,
	): FontResult<FontMetrics>
	shape(request: ShapeTextRequest): FontResult<ShapedText>
	outline(request: GlyphOutlineRequest): FontResult<GlyphOutline>
	cacheStats(): FontServiceCacheStats
	clearCaches(): void
}

/** Canvas, workers, and exporters deliberately share this exact projection. */
export type TextProjection = ShapedText
