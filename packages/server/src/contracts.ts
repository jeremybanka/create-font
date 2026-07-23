export type JsonPrimitive = boolean | null | number | string
export type JsonValue =
	| JsonPrimitive
	| readonly JsonValue[]
	| { readonly [key: string]: JsonValue }

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

/**
 * A logical JSON file in the font source directory. Paths are relative to the
 * project root and use forward slashes.
 */
export type SourceUnitPath = string

export type SourceUnitDescriptor = Readonly<{
	path: SourceUnitPath
	revision: string
}>

export type SourceManifest = Readonly<{
	revision: string
	units: readonly SourceUnitDescriptor[]
}>

export type SourceUnitSnapshot = SourceUnitDescriptor &
	Readonly<{
		value: JsonValue
	}>

/**
 * One ordered, validated transition in the live source. Consumers can apply
 * the delta only when `previousRevision` matches their current revision;
 * otherwise they must recover through a coherent project snapshot.
 */
export type SourceChangedEvent = Readonly<{
	type: `source.changed`
	operationId?: string
	previousRevision: string
	removedPaths: readonly SourceUnitPath[]
	revision: string
	units: readonly SourceUnitSnapshot[]
}>

/**
 * One validated, revision-consistent view of every logical source unit.
 * `revision` is derived from the ordered path/unit-revision pairs in `units`.
 */
export type SourceProjectSnapshot = Readonly<{
	revision: string
	units: readonly SourceUnitSnapshot[]
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

export type SourceUnitWrite = Readonly<{
	/**
	 * `null` means the caller expects to create the unit. A string means the
	 * caller expects to replace exactly that revision.
	 */
	expectedRevision: string | null
	path: SourceUnitPath
	value: JsonValue
}>

export type WriteSourceUnitInput = SourceUnitWrite &
	Readonly<{
		/** Stable across retries of one logical write. */
		idempotencyKey: string
	}>

export type WriteSourceUnitsInput = Readonly<{
	/** Stable across retries of the complete logical transaction. */
	idempotencyKey: string
	writes: readonly [SourceUnitWrite, ...SourceUnitWrite[]]
}>

export type WriteSourceUnitsResult = Readonly<{
	previousRevision: string
	revision: string
	units: readonly [SourceUnitSnapshot, ...SourceUnitSnapshot[]]
}>

export interface CreateFontSourceService {
	commitUnits?(input: CommitSourceUnitsInput): Promise<CommitSourceUnitsResult>
	readComparison?(input: ReadSourceComparisonInput): Promise<SourceComparison>
	readManifest(): Promise<SourceManifest>
	readSnapshot(): Promise<SourceProjectSnapshot>
	readUnit(path: SourceUnitPath): Promise<SourceUnitSnapshot>
	writeUnit(input: WriteSourceUnitInput): Promise<SourceUnitSnapshot>
	writeUnits(input: WriteSourceUnitsInput): Promise<WriteSourceUnitsResult>
	/**
	 * Subscribe to validated manifest changes caused by RPC writes or external
	 * filesystem edits. The service remains usable without realtime support.
	 */
	subscribe?(listener: (event: SourceChangedEvent) => void): () => void
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

export type SourceServiceUnavailable = Readonly<{
	code: `source.not_ready`
	message: string
}>

export type SourceInvalidRequest = Readonly<{
	code: `source.invalid_request`
	message: string
}>

export type SourceValidationIssue = Readonly<{
	code: string
	message: string
	path: string
	unitPath?: string
}>

export type SourceValidationFailure = Readonly<{
	code: `source.validation_failed`
	issues: readonly [SourceValidationIssue, ...SourceValidationIssue[]]
	message: string
}>

export type SourceUnitNotFound = Readonly<{
	code: `source.unit_not_found`
	message: string
	path: SourceUnitPath
}>

export type SourceUnitConflict = Readonly<{
	actualRevision: string | null
	code: `source.revision_conflict`
	expectedRevision: string | null
	message: string
	path: SourceUnitPath
}>

export class SourceUnitNotFoundError extends Error {
	readonly path: SourceUnitPath

	constructor(path: SourceUnitPath) {
		super(`Source unit ${path} does not exist.`)
		this.name = `SourceUnitNotFoundError`
		this.path = path
	}
}

export class SourceUnitConflictError extends Error {
	readonly actualRevision: string | null
	readonly expectedRevision: string | null
	readonly path: SourceUnitPath

	constructor(
		path: SourceUnitPath,
		expectedRevision: string | null,
		actualRevision: string | null,
	) {
		super(`Source unit ${path} changed since it was read.`)
		this.name = `SourceUnitConflictError`
		this.actualRevision = actualRevision
		this.expectedRevision = expectedRevision
		this.path = path
	}
}

export class SourceValidationError extends Error {
	readonly issues: readonly [SourceValidationIssue, ...SourceValidationIssue[]]

	constructor(
		issues: readonly [SourceValidationIssue, ...SourceValidationIssue[]],
	) {
		super(`The proposed font source is not valid.`)
		this.name = `SourceValidationError`
		this.issues = issues
	}
}
