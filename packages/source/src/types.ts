import type { EditorFontSource } from "@trigraph/states"

/** The file is the editor document itself; no additional envelope is added. */
export const TRIGRAPH_EDITOR_FORMAT: EditorFontSource["format"] =
	"trigraph.editor"
export const TRIGRAPH_EDITOR_VERSION: EditorFontSource["editorVersion"] = 3

/**
 * JSON has no bigint scalar. OpenType timestamps therefore use canonical,
 * base-ten strings at the file boundary and map bijectively to bigint in
 * `EditorFontSource`.
 */
export type EditorFontFileMetadata = Omit<
	EditorFontSource["metadata"],
	"createdAt" | "modifiedAt"
> & {
	readonly createdAt?: string
	readonly modifiedAt?: string
}

/**
 * Version 3's on-disk shape. It is exactly `EditorFontSource`, apart from the
 * documented timestamp representation above.
 */
export type EditorFontFile = Omit<EditorFontSource, "metadata"> & {
	readonly metadata: EditorFontFileMetadata
}

export type SourceDiagnosticCode =
	| "json.duplicate_key"
	| "json.inspection"
	| "json.syntax"
	| "json.unsafe_key"
	| "source.array"
	| "source.boolean"
	| "source.cmap_code_point"
	| "source.default_master"
	| "source.duplicate"
	| "source.format"
	| "source.handle"
	| "source.id"
	| "source.missing_property"
	| "source.number"
	| "source.object"
	| "source.reference"
	| "source.string"
	| "source.timestamp"
	| "source.unicode"
	| "source.unknown_property"
	| "source.version"

export interface SourceDiagnostic {
	readonly severity: "error"
	readonly code: SourceDiagnosticCode
	/** Stable JSONPath-like location in the source file. */
	readonly path: string
	readonly message: string
}

export interface SourceSuccess<Value> {
	readonly ok: true
	readonly value: Value
}

export interface SourceFailure {
	readonly ok: false
	readonly errors: readonly [SourceDiagnostic, ...SourceDiagnostic[]]
}

export type SourceResult<Value> = SourceSuccess<Value> | SourceFailure
