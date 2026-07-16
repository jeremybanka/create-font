export type JsonPrimitive = boolean | null | number | string
export type JsonValue =
	| JsonPrimitive
	| readonly JsonValue[]
	| { readonly [key: string]: JsonValue }

export type BuildDiagnostic = Readonly<{
	code: `build.not_implemented` | `workspace.not_directory`
	message: string
	path: string
	severity: `error`
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

export type WriteSourceUnitInput = Readonly<{
	/**
	 * `null` means the caller expects to create the unit. A string means the
	 * caller expects to replace exactly that revision.
	 */
	expectedRevision: string | null
	/** Stable across retries of one logical write. */
	idempotencyKey: string
	path: SourceUnitPath
	value: JsonValue
}>

export interface TrigraphSourceService {
	readManifest(): Promise<SourceManifest>
	readUnit(path: SourceUnitPath): Promise<SourceUnitSnapshot>
	writeUnit(input: WriteSourceUnitInput): Promise<SourceUnitSnapshot>
}

export type SourceServiceUnavailable = Readonly<{
	code: `source.not_ready`
	message: string
}>

export type SourceInvalidRequest = Readonly<{
	code: `source.invalid_request`
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
