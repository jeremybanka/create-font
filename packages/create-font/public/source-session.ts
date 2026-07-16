import type { EditorFontSource } from "@create-font/states"

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
	  }>
	| Readonly<{
			type: `saved`
			requestId: string
			revision: string
	  }>
	| Readonly<{
			type: `error`
			message: string
			requestId?: string
	  }>
