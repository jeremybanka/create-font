import type { EditorFontSource } from "@create-font/states"

import type {
	StartupResourceTiming,
	StartupTimelineSnapshot,
} from "./startup-profile.ts"

export type FontValidationStatus = Readonly<{
	ok: boolean
	issueCount: number
}>

export type SourceUnitRequestTiming = Readonly<{
	duration: number
	path: string
}>

export type SourceSessionStartupProfile = Readonly<{
	resources: readonly StartupResourceTiming[]
	sourceRequestCount: number
	sourceUnitCount: number
	timeline: StartupTimelineSnapshot
	unitRequests: readonly SourceUnitRequestTiming[]
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

export type SourceSessionEventPayload =
	| Readonly<{
			type: `source`
			featureSources: readonly string[]
			sentAtEpochMilliseconds: number
			revision: string
			source: EditorFontSource
			startup: SourceSessionStartupProfile
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

export type SourceSessionEvent = SourceSessionEventPayload &
	Readonly<{ protocolVersion: number }>
