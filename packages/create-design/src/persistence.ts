import {
	decodeDesignDocument,
	type DesignDocument,
	type DesignSourceDiagnostic,
} from "@create-design/source"

export const DESIGN_RECOVERY_STORAGE_KEY = "create-design:recovery-draft:v1"

export type DesignPersistenceStatus =
	| "saved"
	| "dirty"
	| "queued"
	| "saving"
	| "conflicted"
	| "invalid-external-source"
	| "recoverable-draft"

export type DesignRecoveryDraft = Readonly<{
	version: 1
	baseRevision: string | null
	document: DesignDocument
	updatedAt: number
}>

function canonicalJson(value: unknown): string {
	if (
		value === null ||
		typeof value === "boolean" ||
		typeof value === "number" ||
		typeof value === "string"
	)
		return JSON.stringify(value)
	if (Array.isArray(value))
		return `[${value.map((item) => canonicalJson(item ?? null)).join(",")}]`
	if (typeof value !== "object") return "null"
	const record = value as Readonly<Record<string, unknown>>
	return `{${Object.keys(record)
		.filter((key) => record[key] !== undefined)
		.toSorted()
		.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
		.join(",")}}`
}

/**
 * Recovery storage is written only for unsaved work, so a divergent document
 * remains recoverable even if its base revision is older than current source.
 * An identical document is a stale crash-window remnant of an already durable
 * write and must not be presented as newer work.
 */
export function isDesignRecoveryDraftNewer(
	draft: DesignRecoveryDraft,
	durableDocument: DesignDocument,
): boolean {
	return canonicalJson(draft.document) !== canonicalJson(durableDocument)
}

export type DesignPersistenceState = Readonly<{
	status: DesignPersistenceStatus
	durableRevision: string | null
	localRevision: number
	persistedLocalRevision: number
	queuedRevision: number | null
	savingRevision: number | null
	recoveryDraft: DesignRecoveryDraft | null
	diagnostics: readonly DesignSourceDiagnostic[]
	message: string | null
}>

export type DesignPersistenceAction =
	| Readonly<{ type: "edit"; recoveryDraft?: DesignRecoveryDraft }>
	| Readonly<{ type: "queue" }>
	| Readonly<{ type: "save-started"; revision: number }>
	| Readonly<{
			type: "save-succeeded"
			revision: number
			durableRevision: string
	  }>
	| Readonly<{ type: "save-failed"; revision: number; message: string }>
	| Readonly<{ type: "external-conflict"; message: string }>
	| Readonly<{
			type: "external-invalid"
			diagnostics: readonly DesignSourceDiagnostic[]
	  }>
	| Readonly<{ type: "external-loaded"; durableRevision: string }>
	| Readonly<{ type: "recovery-found"; draft: DesignRecoveryDraft }>
	| Readonly<{ type: "recover-draft" }>
	| Readonly<{ type: "discard-draft" }>
	| Readonly<{ type: "retry" }>

export function createDesignPersistenceState(
	durableRevision: string | null,
): DesignPersistenceState {
	return {
		status: "saved",
		durableRevision,
		localRevision: 0,
		persistedLocalRevision: 0,
		queuedRevision: null,
		savingRevision: null,
		recoveryDraft: null,
		diagnostics: [],
		message: null,
	}
}

export function reduceDesignPersistence(
	state: DesignPersistenceState,
	action: DesignPersistenceAction,
): DesignPersistenceState {
	switch (action.type) {
		case "edit":
			return {
				...state,
				status:
					state.status === "conflicted" ||
					state.status === "invalid-external-source" ||
					state.status === "recoverable-draft" ||
					state.status === "saving"
						? state.status
						: "dirty",
				localRevision: state.localRevision + 1,
				queuedRevision: null,
				recoveryDraft:
					state.status === "recoverable-draft"
						? (action.recoveryDraft ?? state.recoveryDraft)
						: state.recoveryDraft,
				diagnostics:
					state.status === "invalid-external-source" ? state.diagnostics : [],
				message: null,
			}
		case "queue":
			if (state.status !== "dirty" && state.status !== "conflicted")
				return state
			return {
				...state,
				status: "queued",
				queuedRevision: state.localRevision,
				savingRevision: null,
				diagnostics: [],
				message: null,
			}
		case "save-started":
			if (state.status !== "queued" || action.revision !== state.queuedRevision)
				return state
			return {
				...state,
				status: "saving",
				queuedRevision: null,
				savingRevision: action.revision,
			}
		case "save-succeeded":
			if (state.status !== "saving" || action.revision !== state.savingRevision)
				return state
			return {
				...state,
				status: state.localRevision === action.revision ? "saved" : "dirty",
				durableRevision: action.durableRevision,
				persistedLocalRevision: action.revision,
				queuedRevision: null,
				savingRevision: null,
				recoveryDraft: null,
				diagnostics: [],
				message: null,
			}
		case "save-failed":
			if (state.status !== "saving" || action.revision !== state.savingRevision)
				return state
			return {
				...state,
				status: "conflicted",
				queuedRevision: null,
				savingRevision: null,
				message: action.message,
			}
		case "external-conflict":
			return {
				...state,
				status: "conflicted",
				queuedRevision: null,
				savingRevision: null,
				message: action.message,
			}
		case "external-invalid":
			return {
				...state,
				status: "invalid-external-source",
				queuedRevision: null,
				savingRevision: null,
				diagnostics: action.diagnostics,
				message:
					"External source is invalid; the last valid design is still open.",
			}
		case "external-loaded":
			return {
				...state,
				status: "saved",
				durableRevision: action.durableRevision,
				localRevision: 0,
				persistedLocalRevision: 0,
				queuedRevision: null,
				savingRevision: null,
				recoveryDraft: null,
				diagnostics: [],
				message: null,
			}
		case "recovery-found":
			return {
				...state,
				status: "recoverable-draft",
				recoveryDraft: action.draft,
				message: "A newer recovery draft is available.",
			}
		case "recover-draft":
			if (state.recoveryDraft === null) return state
			return {
				...state,
				status: "dirty",
				localRevision: state.localRevision + 1,
				queuedRevision: null,
				savingRevision: null,
				recoveryDraft: null,
				diagnostics: [],
				message: null,
			}
		case "discard-draft":
			return {
				...state,
				status: "saved",
				recoveryDraft: null,
				diagnostics: [],
				message: null,
			}
		case "retry":
			if (state.status !== "conflicted") return state
			return {
				...state,
				status: "queued",
				queuedRevision: state.localRevision,
				savingRevision: null,
				message: null,
			}
	}
}

export function persistenceNeedsUnloadWarning(
	state: Pick<
		DesignPersistenceState,
		"status" | "localRevision" | "persistedLocalRevision"
	>,
): boolean {
	return (
		state.localRevision !== state.persistedLocalRevision ||
		state.status === "dirty" ||
		state.status === "queued" ||
		state.status === "saving" ||
		state.status === "conflicted"
	)
}

export function readDesignRecoveryDraft(
	storage: Pick<Storage, "getItem">,
): DesignRecoveryDraft | null {
	try {
		const serialized = storage.getItem(DESIGN_RECOVERY_STORAGE_KEY)
		if (serialized === null) return null
		const value = JSON.parse(serialized) as Partial<DesignRecoveryDraft>
		if (
			value.version !== 1 ||
			typeof value.updatedAt !== "number" ||
			!Number.isFinite(value.updatedAt) ||
			!(value.baseRevision === null || typeof value.baseRevision === "string")
		)
			return null
		const document = decodeDesignDocument(value.document)
		if (!document.ok) return null
		return {
			version: 1,
			baseRevision: value.baseRevision,
			document: document.value,
			updatedAt: value.updatedAt,
		}
	} catch {
		return null
	}
}

export function writeDesignRecoveryDraft(
	storage: Pick<Storage, "setItem">,
	draft: DesignRecoveryDraft,
): void {
	try {
		storage.setItem(DESIGN_RECOVERY_STORAGE_KEY, JSON.stringify(draft))
	} catch {
		// Recovery is best-effort in restricted or exhausted storage contexts.
	}
}

export function clearDesignRecoveryDraft(
	storage: Pick<Storage, "removeItem">,
): void {
	try {
		storage.removeItem(DESIGN_RECOVERY_STORAGE_KEY)
	} catch {
		// Restricted storage must not block a user-selected recovery action.
	}
}
