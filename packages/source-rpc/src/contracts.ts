export type JsonPrimitive = boolean | null | number | string
export type JsonValue =
	| JsonPrimitive
	| readonly JsonValue[]
	| { readonly [key: string]: JsonValue }

/** A logical JSON file, addressed relative to a trusted workspace root. */
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

export type SourceProjectSnapshot = Readonly<{
	revision: string
	units: readonly SourceUnitSnapshot[]
}>

export type SourceChangedEvent = Readonly<{
	type: `source.changed`
	operationId?: string
	previousRevision: string
	removedPaths: readonly SourceUnitPath[]
	revision: string
	units: readonly SourceUnitSnapshot[]
}>

export type SourceUnitWrite = Readonly<{
	/** `null` creates a unit; a revision conditionally replaces it. */
	expectedRevision: string | null
	path: SourceUnitPath
	value: JsonValue
}>

export type SourceUnitRemoval = Readonly<{
	expectedRevision: string
	path: SourceUnitPath
}>

export type WriteSourceUnitInput = SourceUnitWrite &
	Readonly<{
		idempotencyKey: string
	}>

export type WriteSourceUnitsInput = Readonly<{
	idempotencyKey: string
	removals?: readonly SourceUnitRemoval[]
	writes: readonly SourceUnitWrite[]
}>

export type WriteSourceUnitsResult = Readonly<{
	previousRevision: string
	removedPaths: readonly SourceUnitPath[]
	revision: string
	units: readonly SourceUnitSnapshot[]
}>

export interface SourceService {
	readManifest(): Promise<SourceManifest>
	readSnapshot(): Promise<SourceProjectSnapshot>
	readUnit(path: SourceUnitPath): Promise<SourceUnitSnapshot>
	writeUnit(input: WriteSourceUnitInput): Promise<SourceUnitSnapshot>
	writeUnits(input: WriteSourceUnitsInput): Promise<WriteSourceUnitsResult>
	subscribe?(listener: (event: SourceChangedEvent) => void): () => void
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
		message = `The proposed source workspace is not valid.`,
	) {
		super(message)
		this.name = `SourceValidationError`
		this.issues = issues
	}
}
