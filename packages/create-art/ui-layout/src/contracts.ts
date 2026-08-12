import type {
	UiLayoutOrigin,
	UiLayoutProduct,
	UiLayoutRecordV1,
} from "./schema.ts"

export type UiLayoutDiagnostic = Readonly<{
	file: string
	message: string
	path: string
	record?: number
}>
export type UiLayoutSource = Readonly<{
	origin: UiLayoutOrigin
	revision: string | null
	layouts: readonly UiLayoutRecordV1[]
	issues: readonly UiLayoutDiagnostic[]
}>
export type UiLayoutsResponse = Readonly<{ sources: readonly UiLayoutSource[] }>
export type SaveUiLayoutInput = Readonly<{
	expectedRevision: string | null
	layout: UiLayoutRecordV1
	origin: UiLayoutOrigin
	product: UiLayoutProduct
}>
export type UiLayoutError = Readonly<{
	code:
		| "ui.invalid_request"
		| "ui.validation_failed"
		| "ui.write_conflict"
		| "ui.io_error"
	message: string
	issues?: readonly UiLayoutDiagnostic[]
}>
