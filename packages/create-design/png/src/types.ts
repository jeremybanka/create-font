import type { DesignArtboard } from "@create-design/source"

export type PngBackground =
	| Readonly<{ kind: "transparent" }>
	| Readonly<{ kind: "color"; r: number; g: number; b: number; a?: number }>

export type PngExportScope =
	| Readonly<{ kind: "active"; artboardId: string }>
	| Readonly<{ kind: "all" }>
	| Readonly<{ kind: "selected"; artboardIds: readonly string[] }>
	| Readonly<{
			kind: "range"
			startArtboardId: string
			endArtboardId: string
	  }>

export interface PngExportRequest {
	readonly scope: PngExportScope
	/** Output pixels per document unit. Defaults to 1. */
	readonly scale?: number
	readonly background?: PngBackground
	/** Fixed ordered subpixel grid width. Defaults to 4; 1 disables antialiasing. */
	readonly samples?: 1 | 2 | 4
}

export type PngDiagnosticSeverity = "error" | "warning" | "info"

export interface PngDiagnostic {
	readonly code: string
	readonly message: string
	readonly severity: PngDiagnosticSeverity
	readonly artboardId?: string
	readonly entityId?: string
}

export interface PngPreflightResult {
	readonly decision: "blocked" | "ready"
	readonly diagnostics: readonly PngDiagnostic[]
	readonly artboards: readonly DesignArtboard[]
	readonly summary: Readonly<{
		errors: number
		warnings: number
		infos: number
	}>
	readonly target: "png"
}

export interface PngArtifact {
	readonly artboard: DesignArtboard
	readonly bytes: Uint8Array
	readonly filename: string
	readonly height: number
	readonly width: number
}

export interface PngExportResult {
	readonly artifacts: readonly PngArtifact[]
	readonly preflight: PngPreflightResult
}

export interface PngRasterBackend {
	rasterize(
		request: Readonly<{
			artboard: DesignArtboard
			background: PngBackground
			height: number
			samples: 1 | 2 | 4
			width: number
		}>,
		context: Readonly<{
			document: import("@create-design/source").DesignDocument
			signal?: AbortSignal
			yieldControl: () => Promise<void>
		}>,
	): Promise<Uint8Array>
}
