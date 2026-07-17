import type { EditorFontSource } from "@create-font/states"

export type FontValidationStatus = Readonly<{
	ok: boolean
	issueCount: number
}>

export type SourceSessionRequest =
	| Readonly<{
			type: `save`
			baseRevision: string
			requestId: string
			source: EditorFontSource
	  }>
	| Readonly<{
			type: `refresh`
	  }>

export type SourceSessionEvent =
	| Readonly<{
			type: `source`
			revision: string
			source: EditorFontSource
			validation: FontValidationStatus
	  }>
	| Readonly<{
			type: `saved`
			requestId: string
			revision: string
			validation: FontValidationStatus
	  }>
	| Readonly<{
			type: `error`
			message: string
			requestId?: string
	  }>
