import type { SourceService } from "@create-art/source-rpc"
import {
	SourceValidationError as WorkspaceSourceValidationError,
	type CommitSourceUnitsInput,
	type ReadSourceComparisonInput,
	type SourceChangeGroup,
	type SourceComparison as WorkspaceSourceComparison,
	type SourceValidationIssue,
} from "@create-art/source-rpc"

export {
	SourceUnitConflictError,
	SourceUnitNotFoundError,
	SourceVersionControlError,
} from "@create-art/source-rpc"
export type {
	JsonPrimitive,
	JsonValue,
	SourceChangedEvent,
	SourceChangeGroup,
	SourceChangeKind,
	SourceComparisonEndpoint,
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

export type SourceChangeUnit = Omit<SourceChangeGroup, `kind`> &
	Readonly<{ kind: `glyph` | `source` }>

export type SourceComparison = Omit<WorkspaceSourceComparison, `changes`> &
	Readonly<{ changes: readonly SourceChangeUnit[] }>

export type { CommitSourceUnitsInput, ReadSourceComparisonInput }

export type CommitSourceUnitsResult = Readonly<{
	commit: string
	comparison: SourceComparison
}>

export interface CreateFontSourceService extends SourceService {
	commitUnits?(input: CommitSourceUnitsInput): Promise<CommitSourceUnitsResult>
	readComparison?(input: ReadSourceComparisonInput): Promise<SourceComparison>
}
