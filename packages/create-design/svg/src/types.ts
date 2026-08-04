import type {
	DesignArtboard,
	DesignDocument,
	DesignGroup,
	DesignObject,
	DesignSwatch,
} from "@create-design/source"

export type SvgDiagnosticSeverity = "error" | "warning" | "info"
export type SvgDiagnosticStage =
	| "import"
	| "preflight"
	| "projection"
	| "serialization"
	| "activation"

export interface SvgDiagnostic {
	readonly code: string
	readonly message: string
	readonly severity: SvgDiagnosticSeverity
	readonly stage: SvgDiagnosticStage
	readonly element?: string
	readonly entityId?: string
}

export type SvgExportTarget =
	| DesignArtboard
	| Readonly<{ readonly artboardId: string }>

export interface SvgPreflightResult {
	readonly decision: "blocked" | "ready"
	readonly diagnostics: readonly SvgDiagnostic[]
	readonly artboard: DesignArtboard | null
	readonly summary: Readonly<{
		errors: number
		warnings: number
		infos: number
	}>
	readonly target: "svg"
}

export interface SvgObjectProjection {
	readonly kind: "object"
	readonly object: DesignObject
	readonly swatches: Readonly<{
		fill?: DesignSwatch
		stroke?: DesignSwatch
	}>
}

export interface SvgGroupProjection {
	readonly kind: "group"
	readonly group: DesignGroup
	readonly children: readonly SvgProjectionNode[]
}

export type SvgProjectionNode = SvgObjectProjection | SvgGroupProjection

export interface SvgDocumentProjection {
	readonly artboard: DesignArtboard
	readonly children: readonly SvgProjectionNode[]
	readonly title: string
}

export interface SvgProjectionGraph {
	project(
		document: DesignDocument,
		target?: SvgExportTarget,
	): SvgDocumentProjection
}

export interface SvgImportOptions {
	readonly artboardId?: string
	/** Supplies globally unique suffixes. The editor passes its document ID source. */
	readonly nextId?: () => string
}

export interface SvgImportResult {
	readonly diagnostics: readonly SvgDiagnostic[]
	readonly document: DesignDocument
	readonly importedObjectIds: readonly string[]
	readonly ok: boolean
}
