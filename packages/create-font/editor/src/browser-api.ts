import type {
	AdmissionRequest,
	CollaborationParticipant,
	CollaborationPresence,
	CollaborationRole,
} from "@create-art/realtime"
import type { EditorFontSource, FontDocumentCommand } from "@create-font/states"

import type { EditorVersionControl } from "./version-control.ts"

export type EditorBrowserOptions = Readonly<{
	collaboration?: EditorCollaboration
	featureSubstitutions?: readonly EditorFeatureSubstitution[]
	onSourceChange?: (source: EditorFontSource) => Promise<void> | void
	onSourceDirty?: (source: EditorFontSource) => void
	source: EditorFontSource
	validation?: Readonly<{ ok: boolean; issueCount: number }>
	versionControl?: EditorVersionControl
	workspaceProject?: EditorWorkspaceProject
}>

export type EditorWorkspaceProject = Readonly<{
	id: string
	onChange: (
		projectId: string,
		source: EditorFontSource,
	) => boolean | Promise<boolean>
	projects: readonly Readonly<{ id: string; name: string; path: string }>[]
}>

export interface EditorCollaborationSession {
	readonly deviceId: string
	readonly error?: string
	readonly participants: readonly CollaborationParticipant[]
	readonly pending: readonly AdmissionRequest[]
	readonly presence: readonly CollaborationPresence[]
	readonly role: CollaborationRole
	readonly status: `connected` | `error` | `reconnecting` | `saving`
}

export interface EditorCollaborationReceiver {
	readonly apply: (command: FontDocumentCommand) => void
	readonly load: (
		base: EditorFontSource,
		actions: readonly FontDocumentCommand[],
	) => void
}

export interface EditorCollaboration {
	readonly decide: (
		requestId: string,
		decision: `approve` | `reject`,
		role?: `editor` | `viewer`,
	) => Promise<void>
	readonly publish: (command: FontDocumentCommand) => void
	readonly publishPresence: (
		presence: Omit<CollaborationPresence, `deviceId`>,
	) => void
	readonly revoke: (deviceId: string) => Promise<void>
	readonly session: () => EditorCollaborationSession
	readonly subscribe: (receiver: EditorCollaborationReceiver) => () => void
	readonly subscribeSession: (
		listener: (session: EditorCollaborationSession) => void,
	) => () => void
}

export interface EditorFeatureSubstitution {
	readonly feature: string
	readonly from: readonly string[]
	readonly to: string
	readonly contextIndex?: number
}

export type MountedEditor = Readonly<{
	update: (options: EditorBrowserOptions) => void
	unmount: () => void
}>

export declare function mountEditor(
	host: HTMLElement,
	options: EditorBrowserOptions,
): MountedEditor

export type { EditorFontSource }
