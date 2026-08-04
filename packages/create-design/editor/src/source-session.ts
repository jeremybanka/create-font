import type {
	DesignDocument,
	DesignFontReference,
	DesignSourceDiagnostic,
} from "@create-design/source"

import type { DesignVersionControlSession } from "./design-version-control.ts"

export type DesignSourceStatus =
	| "connected"
	| "saving"
	| "saved"
	| "recovering"
	| "conflict"

export type DesignSourceFontResource = Readonly<{
	reference: DesignFontReference
	bytes: Uint8Array
}>

export type DesignExternalSourceUpdate =
	| Readonly<{
			ok: true
			document: DesignDocument
			fonts: readonly DesignSourceFontResource[]
			revision: string
	  }>
	| Readonly<{
			ok: false
			diagnostics: readonly DesignSourceDiagnostic[]
			revision: string
	  }>

export interface DesignSourceSession {
	readonly displayName?: string
	readonly initialDocument: DesignDocument
	readonly initialRevision: string
	readonly fonts?: readonly DesignSourceFontResource[]
	installFont?(
		reference: DesignFontReference,
		bytes: Uint8Array,
		fileName: string,
		mediaType: string,
	): Promise<DesignFontReference>
	readonly versionControl?: DesignVersionControlSession
	reload(): Promise<DesignExternalSourceUpdate>
	save(document: DesignDocument): Promise<Readonly<{ revision: string }>>
	subscribeDocument(
		listener: (update: DesignExternalSourceUpdate) => void,
	): () => void
	subscribeStatus(listener: (status: DesignSourceStatus) => void): () => void
}
