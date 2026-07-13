import type {
	Diagnostic,
	FontMetadataSource,
	FontMetricsSource,
	FontNamesSource,
	FontStyleSource,
	NonEmptyReadonlyArray,
	VariableFont,
	VariableFontSource,
} from "trigraph"

export const TRIGRAPH_EDITOR_FORMAT = "trigraph.editor" as const
export const TRIGRAPH_EDITOR_VERSION = 3 as const

/** Stable, serialization-safe identifiers scoped by editor entity kind. */
export type AxisId = `axis:${string}`
export type MasterId = `master:${string}`
export type InstanceId = `instance:${string}`
export type GlyphId = `glyph:${string}`
export type ContourId = `contour:${string}`
export type PointId = `point:${string}`

export type EditorEntityId =
	| AxisId
	| MasterId
	| InstanceId
	| GlyphId
	| ContourId
	| PointId

/**
 * A user-space design location keyed by stable axis identity, not by an axis
 * tag or array position. Missing coordinates can be diagnosed during
 * projection without making an in-progress editor document unrepresentable.
 */
export type EditorLocationSource = Readonly<Partial<Record<AxisId, number>>>

export interface EditorAxisMapEntrySource {
	readonly from: number
	readonly to: number
}

export interface EditorAxisSource {
	readonly id: AxisId
	readonly tag: string
	readonly name: string
	readonly min: number
	readonly default: number
	readonly max: number
	readonly hidden?: boolean
	readonly map?: readonly EditorAxisMapEntrySource[]
}

export interface EditorDefaultMasterSource {
	readonly id: MasterId
	readonly kind: "default"
	readonly name: string
}

export interface EditorNonIntermediateSupportSource {
	readonly kind: "non-intermediate"
}

export interface EditorIntermediateSupportSource {
	readonly kind: "intermediate"
	readonly start: EditorLocationSource
	readonly end: EditorLocationSource
}

export type EditorMasterSupportSource =
	| EditorNonIntermediateSupportSource
	| EditorIntermediateSupportSource

/**
 * A source master becomes one `gvar` tuple. Its location is the tuple peak;
 * intermediate start/end locations are present only when the tuple needs an
 * explicitly bounded support region.
 */
export interface EditorSourceMasterSource {
	readonly id: MasterId
	readonly kind: "source"
	readonly name: string
	readonly location: EditorLocationSource
	readonly support: EditorMasterSupportSource
}

export type EditorMasterSource =
	| EditorDefaultMasterSource
	| EditorSourceMasterSource

export interface EditorInstanceSource {
	readonly id: InstanceId
	readonly name: string
	readonly coordinates: EditorLocationSource
	readonly postScriptName?: string
	readonly elidable?: boolean
}

export type EditorNodeMode = "soft" | "hard"
export type EditorHandleKind = "incoming" | "outgoing"

/** A handle endpoint expressed as a vector relative to its owning node. */
export interface EditorHandleVectorSource {
	readonly x: number
	readonly y: number
}

/**
 * Topological node data shared by every master. Coordinates and handle
 * vectors deliberately do not live here: they are supplied by the
 * corresponding glyph layer.
 */
export interface EditorPointSource {
	readonly id: PointId
	/**
	 * Soft nodes keep their two handles collinear when edited. Hard nodes allow
	 * independent or one-sided handles.
	 */
	readonly mode: EditorNodeMode
}

export interface EditorContourSource {
	readonly id: ContourId
	/** Open contours are valid editor state but must be closed before export. */
	readonly closed: boolean
	readonly points: readonly EditorPointSource[]
}

export interface EditorLayerPointSource {
	readonly pointId: PointId
	readonly x: number
	readonly y: number
	/** Relative vector from the node to the preceding cubic control point. */
	readonly incoming?: EditorHandleVectorSource
	/** Relative vector from the node to the following cubic control point. */
	readonly outgoing?: EditorHandleVectorSource
}

/** Coordinates and horizontal metrics for one glyph at one master. */
export interface EditorGlyphLayerSource {
	readonly masterId: MasterId
	readonly advanceWidth: number
	readonly leftSideBearing: number
	readonly points: readonly EditorLayerPointSource[]
}

export interface EditorGlyphSource {
	readonly id: GlyphId
	readonly name: string
	/** Whether the glyph participates in projection and export. */
	readonly export: boolean
	/** Editor-only annotation; never projected into the low-level IR. */
	readonly note?: string
	/** Editor-only color label expressed as a CSS color string. */
	readonly color?: string
	readonly overlap?: boolean
	/** Shared contour and node topology, in export order. */
	readonly contours: readonly EditorContourSource[]
	/** At most one layer per master; projection verifies complete coverage. */
	readonly layers: readonly EditorGlyphLayerSource[]
}

export interface EditorCmapEntrySource {
	readonly codePoint: number
	readonly glyphId: GlyphId
}

/**
 * Serializable high-level source for one variable-font editor document.
 * Entity arrays preserve author order while stable IDs allow atom families to
 * address individual entities independently of that order.
 */
export interface EditorFontSource {
	readonly format: typeof TRIGRAPH_EDITOR_FORMAT
	readonly editorVersion: typeof TRIGRAPH_EDITOR_VERSION
	readonly metadata: FontMetadataSource
	readonly names: FontNamesSource
	readonly metrics: FontMetricsSource
	readonly style: FontStyleSource
	readonly axes: readonly EditorAxisSource[]
	readonly masters: readonly EditorMasterSource[]
	readonly defaultMasterId: MasterId
	readonly instances: readonly EditorInstanceSource[]
	/** Array order is glyph ID order in the projected font. */
	readonly glyphs: readonly EditorGlyphSource[]
	readonly cmap: readonly EditorCmapEntrySource[]
}

export type ProjectionIssueSeverity = "error" | "warning"

interface ProjectionIssueBase {
	readonly code: string
	/** Stable JSONPath-like location in the editor source. */
	readonly path: string
	readonly message: string
	/** Stable entity identity for editor selection/highlighting, when known. */
	readonly entityId?: EditorEntityId
}

export interface ProjectionError extends ProjectionIssueBase {
	readonly severity: "error"
}

export interface ProjectionWarning extends ProjectionIssueBase {
	readonly severity: "warning"
}

export type ProjectionIssue = ProjectionError | ProjectionWarning

export interface ProjectionSuccess<Value> {
	readonly ok: true
	readonly value: Value
	readonly warnings: readonly ProjectionWarning[]
}

export interface ProjectionFailure {
	readonly ok: false
	readonly errors: NonEmptyReadonlyArray<ProjectionError>
	readonly warnings: readonly ProjectionWarning[]
}

export type ProjectionResult<Value> =
	| ProjectionSuccess<Value>
	| ProjectionFailure

/** Projection stopped before a complete low-level source could be produced. */
export interface FontProjectionFailure {
	readonly ok: false
	readonly stage: "projection-failed"
	readonly projectionErrors: NonEmptyReadonlyArray<ProjectionError>
	readonly projectionWarnings: readonly ProjectionWarning[]
}

/** Projection succeeded, but the low-level ingestion proof rejected it. */
export interface FontIngestionFailure {
	readonly ok: false
	readonly stage: "ingestion-failed"
	readonly source: VariableFontSource
	readonly projectionWarnings: readonly ProjectionWarning[]
	readonly ingestionErrors: NonEmptyReadonlyArray<Diagnostic>
	readonly ingestionWarnings: readonly Diagnostic[]
}

/** Both editor projection and low-level ingestion proof succeeded. */
export interface FontCompilationSuccess {
	readonly ok: true
	readonly stage: "compiled"
	readonly source: VariableFontSource
	readonly font: VariableFont
	readonly projectionWarnings: readonly ProjectionWarning[]
	readonly ingestionWarnings: readonly Diagnostic[]
}

export type FontCompilation =
	| FontProjectionFailure
	| FontIngestionFailure
	| FontCompilationSuccess
