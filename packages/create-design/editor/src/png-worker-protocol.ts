import type {
	PngArtifact,
	PngExportRequest,
	PngPreflightResult,
} from "@create-design/png"
import type { DesignDocument } from "./types.ts"

export type PngWorkerRequest = Readonly<{
	document: DesignDocument
	id: number
	request: PngExportRequest
}>

export type PngWorkerResponse =
	| Readonly<{
			artifacts: readonly PngArtifact[]
			id: number
			ok: true
			preflight: PngPreflightResult
	  }>
	| Readonly<{ error: string; id: number; ok: false }>
