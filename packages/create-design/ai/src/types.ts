import type { DesignDocument } from "@create-design/source"

export type IllustratorImportDiagnostic = Readonly<{
	code: string
	message: string
	sourceSpan?: Readonly<{
		start: number
		end: number
		line: number
		column: number
	}>
	severity: "error" | "warning" | "info"
	stage: "container" | "content"
}>

export type IllustratorImportOptions = Readonly<{
	/** Used for the document title when Illustrator metadata has no title. */
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
