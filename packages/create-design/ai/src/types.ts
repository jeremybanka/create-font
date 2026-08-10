import type { DesignDocument } from "@create-design/source"

export type IllustratorImportDiagnostic = Readonly<{
	code: string
	message: string
	page?: number
	severity: "error" | "warning" | "info"
	stage: "container" | "content"
}>

export type IllustratorImportOptions = Readonly<{
	/** Space inserted between imported PDF pages in the global document plane. */
	artboardGap?: number
	/** Used for the document title when PDF metadata does not provide one. */
	title?: string
}>

export type IllustratorImportResult = Readonly<{
	diagnostics: readonly IllustratorImportDiagnostic[]
	document: DesignDocument | null
	ok: boolean
	summary: Readonly<{
		artboards: number
		objects: number
		swatches: number
	}>
}>
