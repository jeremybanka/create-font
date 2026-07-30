import type { SourceService } from "@create-art/source-rpc"
import {
	SourceValidationError as WorkspaceSourceValidationError,
	type SourceValidationIssue,
} from "@create-art/source-rpc"

export {
	SourceUnitConflictError,
	SourceUnitNotFoundError,
} from "@create-art/source-rpc"
export type {
	JsonPrimitive,
	JsonValue,
	SourceChangedEvent,
	SourceInvalidRequest,
	SourceManifest,
	SourceProjectSnapshot,
	SourceService,
	SourceServiceUnavailable,
	SourceUnitConflict,
	SourceUnitDescriptor,
	SourceUnitNotFound,
	SourceUnitPath,
	SourceUnitRemoval,
	SourceUnitSnapshot,
	SourceUnitWrite,
	SourceValidationFailure,
	WriteSourceUnitInput,
	WriteSourceUnitsInput,
	WriteSourceUnitsResult,
} from "@create-art/source-rpc"

/** Preserves create-font's established validation message over shared errors. */
export class SourceValidationError extends WorkspaceSourceValidationError {
	constructor(
		issues: readonly [SourceValidationIssue, ...SourceValidationIssue[]],
		message = `The proposed font source is not valid.`,
	) {
		super(issues, message)
		this.name = `SourceValidationError`
	}
}

export type { SourceValidationIssue }

export type BuildDiagnostic = Readonly<{
	code: string
	entityId?: string
	message: string
	path: string
	severity: `error`
	table?: string
	unitPath?: string
}>

export type BuildResult =
	| Readonly<{
			ok: true
			root: string
			outputs: readonly string[]
	  }>
	| Readonly<{
			ok: false
			root: string
			errors: readonly [BuildDiagnostic, ...BuildDiagnostic[]]
	  }>

export type SourceComparisonEndpoint = Readonly<{
	/** Immutable commit object ID, or the live source manifest revision. */
	identity: string
	kind: `ref` | `working`
	label: string
	ref?: string
	snapshot: SourceProjectSnapshot
}>

export type SourceChangeKind = `added` | `deleted` | `modified`

export type SourceChangeUnit = Readonly<{
	change: SourceChangeKind
	id: string
	kind: `glyph` | `source`
	label: string
	paths: readonly [SourceUnitPath, ...SourceUnitPath[]]
}>

export type SourceComparison = Readonly<{
	base: SourceComparisonEndpoint
	/** Changes from base to target, grouped into safely committable source units. */
	changes: readonly SourceChangeUnit[]
	/** Changes when either endpoint changes; used as the optimistic commit guard. */
	identity: string
	target: SourceComparisonEndpoint
}>

export type ReadSourceComparisonInput = Readonly<{
	baseRef: string
	/** Omit for the live working source (tracked, staged, and untracked). */
	targetRef?: string
}>

export type CommitSourceUnitsInput = Readonly<{
	expectedComparisonIdentity: string
	message: string
	paths: readonly [SourceUnitPath, ...SourceUnitPath[]]
}>

export type CommitSourceUnitsResult = Readonly<{
	commit: string
	comparison: SourceComparison
}>

export interface CreateFontSourceService extends SourceService {
	commitUnits?(input: CommitSourceUnitsInput): Promise<CommitSourceUnitsResult>
	readComparison?(input: ReadSourceComparisonInput): Promise<SourceComparison>
}

export class SourceVersionControlError extends Error {
	readonly code:
		| `source.git_unavailable`
		| `source.invalid_ref`
		| `source.repository_state`
		| `source.snapshot_too_large`
		| `source.commit_conflict`

	constructor(code: SourceVersionControlError["code"], message: string) {
		super(message)
		this.name = `SourceVersionControlError`
		this.code = code
	}
}
