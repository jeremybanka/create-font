declare const scalarBrand: unique symbol

declare class ValidatedFontProof {
	private readonly validatedFontProof: true
}

type Branded<Value, Name extends string> = Value & {
	readonly [scalarBrand]: Name
}

export type AdvanceWidth = Branded<number, "AdvanceWidth">
export type AxisTag = Branded<string, "AxisTag">
export type F2Dot14 = Branded<number, "F2Dot14">
export type Fixed16Dot16 = Branded<number, "Fixed16Dot16">
export type FUnit = Branded<number, "FUnit">
export type GlyphCoordinate = Branded<number, "GlyphCoordinate">
export type GlyphId = Branded<number, "GlyphId">
export type NameId = Branded<number, "NameId">
export type NonEmptyString = Branded<string, "NonEmptyString">
export type OpenTypeTimestamp = Branded<bigint, "OpenTypeTimestamp">
export type PostScriptName = Branded<string, "PostScriptName">
export type SfntTag = Branded<string, "SfntTag">
export type UInt16 = Branded<number, "UInt16">
export type UnicodeScalar = Branded<number, "UnicodeScalar">
export type UnitsPerEm = Branded<number, "UnitsPerEm">
export type UserCoordinate = Branded<number, "UserCoordinate">
export type VariationDelta = Branded<number, "VariationDelta">

export type NonEmptyReadonlyArray<Value> = readonly [Value, ...Value[]]
export type NormalizedLocation = NonEmptyReadonlyArray<F2Dot14>

export const CREATE_FONT_FORMAT = "create-font.variable-truetype" as const
export const CREATE_FONT_IR_VERSION = 1 as const

export interface FontMetadataSource {
	readonly unitsPerEm: number
	readonly fontRevision: number
	readonly vendorId: string
	readonly lowestPpem: number
	readonly createdAt?: bigint
	readonly modifiedAt?: bigint
}

export interface FontNamesSource {
	readonly family: string
	readonly subfamily: string
	readonly uniqueId: string
	readonly fullName: string
	readonly version: string
	readonly postScriptName: string
	readonly typographicFamily: string
	readonly typographicSubfamily: string
}

export interface FontMetricsSource {
	readonly ascender: number
	readonly descender: number
	readonly lineGap: number
	readonly winAscent: number
	readonly winDescent: number
	readonly xHeight: number
	readonly capHeight: number
	readonly underlinePosition: number
	readonly underlineThickness: number
}

export interface FontStyleSource {
	readonly weightClass: number
	readonly widthClass: number
	readonly italic: boolean
	readonly bold: boolean
	readonly oblique: boolean
	readonly italicAngle: number
}

export interface AxisMapEntrySource {
	readonly from: number
	readonly to: number
}

export interface VariationAxisSource {
	readonly tag: string
	readonly name: string
	readonly min: number
	readonly default: number
	readonly max: number
	readonly hidden?: boolean
	readonly map?: readonly AxisMapEntrySource[]
}

export interface NamedInstanceSource {
	readonly name: string
	readonly coordinates: Readonly<Record<string, number>>
	readonly postScriptName?: string
	readonly elidable?: boolean
}

export interface PointSource {
	readonly x: number
	readonly y: number
	readonly onCurve: boolean
}

export interface PointDeltaSource {
	readonly x: number
	readonly y: number
}

export interface PhantomDeltasSource {
	/** X delta for the left-side-bearing phantom point. */
	readonly left: number
	/** X delta for the advance-width phantom point. */
	readonly right: number
	/** Y delta for the top-side-bearing phantom point. */
	readonly top: number
	/** Y delta for the advance-height phantom point. */
	readonly bottom: number
}

export type NonIntermediateRegionSource = {
	readonly peak: Readonly<Record<string, number>>
	readonly start?: never
	readonly end?: never
}

export type IntermediateRegionSource = {
	readonly peak: Readonly<Record<string, number>>
	readonly start: Readonly<Record<string, number>>
	readonly end: Readonly<Record<string, number>>
}

export type VariationRegionSource =
	| NonIntermediateRegionSource
	| IntermediateRegionSource

export interface GlyphVariationSource {
	readonly region: VariationRegionSource
	readonly deltas: {
		readonly points: readonly PointDeltaSource[]
		readonly phantom: PhantomDeltasSource
	}
}

/**
 * Version 1 is intentionally a closed profile: unhinted, simple TrueType
 * glyphs with complete (non-sparse) `gvar` point deltas.
 */
export interface SimpleGlyphSource {
	readonly kind: "simple"
	/** Unique IR identifier; v1 lowers `post` 3.0 and does not serialize it. */
	readonly name: string
	readonly advanceWidth: number
	readonly leftSideBearing: number
	readonly contours: readonly (readonly PointSource[])[]
	readonly variations: readonly GlyphVariationSource[]
	readonly overlap?: boolean
}

export interface CharacterMapEntrySource {
	readonly codePoint: number
	readonly glyph: number
}

/** One horizontal pair adjustment, addressed by target glyph index. */
export interface KerningPairSource {
	readonly left: number
	readonly right: number
	readonly value: number
}

export interface VariableFontSource {
	readonly format: typeof CREATE_FONT_FORMAT
	readonly irVersion: typeof CREATE_FONT_IR_VERSION
	readonly metadata: FontMetadataSource
	readonly names: FontNamesSource
	readonly metrics: FontMetricsSource
	readonly style: FontStyleSource
	readonly axes: readonly VariationAxisSource[]
	readonly instances: readonly NamedInstanceSource[]
	readonly glyphs: readonly SimpleGlyphSource[]
	readonly cmap: readonly CharacterMapEntrySource[]
	/** Conventional GPOS `kern` pair adjustments. */
	readonly kerning?: readonly KerningPairSource[]
}

export interface FontMetadata {
	readonly unitsPerEm: UnitsPerEm
	readonly fontRevision: Fixed16Dot16
	readonly vendorId: SfntTag
	readonly lowestPpem: UInt16
	readonly createdAt: OpenTypeTimestamp
	readonly modifiedAt: OpenTypeTimestamp
}

export interface FontNames {
	readonly family: NonEmptyString
	readonly subfamily: NonEmptyString
	readonly uniqueId: NonEmptyString
	readonly fullName: NonEmptyString
	readonly version: NonEmptyString
	readonly postScriptName: PostScriptName
	readonly typographicFamily: NonEmptyString
	readonly typographicSubfamily: NonEmptyString
}

export interface FontMetrics {
	readonly ascender: FUnit
	readonly descender: FUnit
	readonly lineGap: FUnit
	readonly winAscent: UInt16
	readonly winDescent: UInt16
	readonly xHeight: FUnit
	readonly capHeight: FUnit
	readonly underlinePosition: FUnit
	readonly underlineThickness: FUnit
}

export interface FontStyle {
	readonly weightClass: UInt16
	readonly widthClass: UInt16
	readonly italic: boolean
	readonly bold: boolean
	readonly oblique: boolean
	readonly italicAngle: Fixed16Dot16
}

export interface AxisMapEntry {
	readonly from: F2Dot14
	readonly to: F2Dot14
}

export interface VariationAxis {
	readonly tag: AxisTag
	readonly name: NonEmptyString
	readonly min: UserCoordinate
	readonly default: UserCoordinate
	readonly max: UserCoordinate
	readonly hidden: boolean
	/** Null means identity normalization and does not require an `avar` table. */
	readonly map: readonly AxisMapEntry[] | null
}

export interface NamedInstance {
	readonly name: NonEmptyString
	/** User coordinates in `font.axes` order. */
	readonly coordinates: readonly UserCoordinate[]
	readonly postScriptName: PostScriptName | null
	readonly elidable: boolean
}

export interface Point {
	readonly x: GlyphCoordinate
	readonly y: GlyphCoordinate
	readonly onCurve: boolean
}

export interface PointDelta {
	readonly x: VariationDelta
	readonly y: VariationDelta
}

export interface PhantomDeltas {
	readonly left: VariationDelta
	readonly right: VariationDelta
	readonly top: VariationDelta
	readonly bottom: VariationDelta
}

export type NonIntermediateRegion = {
	readonly kind: "non-intermediate"
	readonly peak: NormalizedLocation
}

export type IntermediateRegion = {
	readonly kind: "intermediate"
	readonly peak: NormalizedLocation
	readonly start: NormalizedLocation
	readonly end: NormalizedLocation
}

export type VariationRegion = NonIntermediateRegion | IntermediateRegion

export interface GlyphVariation {
	readonly region: VariationRegion
	readonly deltas: {
		readonly points: readonly PointDelta[]
		readonly phantom: PhantomDeltas
	}
}

export interface SimpleGlyph {
	readonly kind: "simple"
	/** Unique IR identifier; v1 lowers `post` 3.0 and does not serialize it. */
	readonly name: NonEmptyString
	readonly advanceWidth: AdvanceWidth
	readonly leftSideBearing: FUnit
	readonly contours: readonly NonEmptyReadonlyArray<Point>[]
	readonly variations: readonly GlyphVariation[]
	readonly overlap: boolean
}

export interface CharacterMapEntry {
	readonly codePoint: UnicodeScalar
	readonly glyph: GlyphId
}

export interface KerningPair {
	readonly left: GlyphId
	readonly right: GlyphId
	readonly value: FUnit
}

export type VariableFont = {
	readonly format: typeof CREATE_FONT_FORMAT
	readonly irVersion: typeof CREATE_FONT_IR_VERSION
	readonly metadata: FontMetadata
	readonly names: FontNames
	readonly metrics: FontMetrics
	readonly style: FontStyle
	readonly axes: NonEmptyReadonlyArray<VariationAxis>
	readonly instances: readonly NamedInstance[]
	readonly glyphs: NonEmptyReadonlyArray<SimpleGlyph>
	readonly cmap: NonEmptyReadonlyArray<CharacterMapEntry>
	readonly kerning: readonly KerningPair[]
} & ValidatedFontProof

export type DiagnosticSeverity = "error" | "warning"

export type DiagnosticCode =
	| "axis.avar.anchor"
	| "axis.avar.coordinate"
	| "axis.avar.from_order"
	| "axis.avar.to_order"
	| "axis.count"
	| "axis.default_range"
	| "axis.duplicate_tag"
	| "axis.fixed"
	| "axis.range"
	| "axis.registered_range"
	| "axis.tag"
	| "cmap.code_point"
	| "cmap.duplicate"
	| "cmap.glyph"
	| "font.format"
	| "font.ir_version"
	| "font.object"
	| "font.table_size"
	| "font.unknown_property"
	| "glyph.contour_count"
	| "glyph.count"
	| "glyph.coordinate"
	| "glyph.empty_contour"
	| "glyph.glyf_delta"
	| "glyph.gvar_count"
	| "glyph.gvar_data_size"
	| "glyph.lsb"
	| "glyph.metric_variation"
	| "glyph.name"
	| "glyph.notdef"
	| "glyph.overlap"
	| "glyph.point_count"
	| "glyph.relative_coordinate"
	| "glyph.table_metric"
	| "instance.coordinate"
	| "instance.duplicate"
	| "instance.name"
	| "instance.postscript_name"
	| "kerning.duplicate"
	| "kerning.glyph"
	| "metadata.fixed"
	| "metadata.modified_before_created"
	| "metadata.timestamp"
	| "metadata.units_per_em"
	| "metadata.vendor_id"
	| "name.empty"
	| "name.postscript"
	| "name.unicode"
	| "name.version"
	| "recommendation.axis_pair"
	| "recommendation.default_instance_names"
	| "recommendation.notdef_outline"
	| "recommendation.units_per_em_power_of_two"
	| "region.axis_set"
	| "region.intermediate"
	| "region.normalized"
	| "region.zero_peak"
	| "scalar.boolean"
	| "scalar.integer"
	| "scalar.range"
	| "scalar.type"
	| "style.axis_mismatch"
	| "style.italic_oblique"
	| "style.range"
	| "win_metrics.coverage"

export interface Diagnostic {
	readonly severity: DiagnosticSeverity
	readonly code: DiagnosticCode
	/** Stable JSONPath-like location in the source value. */
	readonly path: string
	readonly message: string
	/** OpenType table or logical profile section associated with the rule. */
	readonly table: string
}

export type IngestSuccess = {
	readonly ok: true
	readonly value: VariableFont
	readonly warnings: readonly Diagnostic[]
}

export type IngestFailure = {
	readonly ok: false
	readonly errors: NonEmptyReadonlyArray<Diagnostic>
	readonly warnings: readonly Diagnostic[]
}

export type IngestResult = IngestSuccess | IngestFailure

export type LocationSuccess = {
	readonly ok: true
	/** Normalized coordinates in `font.axes` order, after `avar`. */
	readonly value: NormalizedLocation
}

export type LocationFailure = {
	readonly ok: false
	readonly errors: NonEmptyReadonlyArray<Diagnostic>
}

export type LocationResult = LocationSuccess | LocationFailure

export type MasterDeltaSuccess = {
	readonly ok: true
	readonly value: readonly PointDeltaSource[]
}

export type MasterDeltaFailure = {
	readonly ok: false
	readonly errors: NonEmptyReadonlyArray<Diagnostic>
}

export type MasterDeltaResult = MasterDeltaSuccess | MasterDeltaFailure
