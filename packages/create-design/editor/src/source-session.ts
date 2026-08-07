import type {
	DesignDocument,
	DesignFontReference,
	DesignImageResource,
	DesignLinkedArtboardResource,
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
			images?: readonly DesignImageResource[]
			imageDiagnostics?: readonly string[]
			linkedArtboards?: readonly DesignLinkedArtboardResource[]
			revision: string
	  }>
	| Readonly<{
			ok: false
			diagnostics: readonly DesignSourceDiagnostic[]
			revision: string
	  }>

export interface DesignSourceSession {
	readonly allowLegacyRecovery?: boolean
	readonly projectId?: string
	readonly workspaceId?: string
	readonly workspaceProjects?: readonly Readonly<{ id: string; name: string }>[]
	readonly displayName?: string
	readonly initialDocument: DesignDocument
	readonly initialRevision: string
	readonly fonts?: readonly DesignSourceFontResource[]
	readonly images?: readonly DesignImageResource[]
	readonly imageDiagnostics?: readonly string[]
	readonly linkedArtboards?: readonly DesignLinkedArtboardResource[]
	dispose?(): void
	installImage?(
		id: string,
		bytes: Uint8Array,
		fileName: string,
		mediaType: "image/jpeg" | "image/png",
	): Promise<DesignImageResource>
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
	subscribeLinkedArtboards?(
		listener: (resources: readonly DesignLinkedArtboardResource[]) => void,
	): () => void
	subscribeStatus(listener: (status: DesignSourceStatus) => void): () => void
}
