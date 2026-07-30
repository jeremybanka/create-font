import type { EditorFontSource } from "@create-font/states"
import {
	formatSourceJson,
	type SourceJsonValue,
} from "@create-art/source-format"

import { inspectJsonObjectKeys } from "./json.ts"
import { failure, success } from "./result.ts"
import type { EditorFontFile, SourceDiagnostic, SourceResult } from "./types.ts"
import { validateSourceValue } from "./validation.ts"

/** Validate, clone, and deeply freeze an in-memory editor state snapshot. */
export function validateEditorFontSource(
	value: unknown,
): SourceResult<EditorFontSource> {
	return validateSourceValue(value, "state")
}

/**
 * Convert editor state to its JSON-compatible file value. The returned value
 * is detached from and cannot be mutated through the caller's source object.
 */
export function toEditorFontFile(
	source: EditorFontSource,
): SourceResult<EditorFontFile> {
	const validated = validateEditorFontSource(source)
	if (!validated.ok) return failure(validated.errors)
	const { createdAt, modifiedAt, ...numericMetadata } = validated.value.metadata
	return success({
		...validated.value,
		metadata: {
			...numericMetadata,
			...(createdAt === undefined ? {} : { createdAt: createdAt.toString(10) }),
			...(modifiedAt === undefined
				? {}
				: { modifiedAt: modifiedAt.toString(10) }),
		},
	})
}

/** Validate a parsed file value and restore timestamp strings to bigint. */
export function fromEditorFontFile(
	file: unknown,
): SourceResult<EditorFontSource> {
	return validateSourceValue(file, "file")
}

/**
 * Encode one state snapshot as canonical JSON: recursively sorted object keys,
 * preserved array order, no insignificant whitespace, and one trailing LF.
 */
export function encodeEditorFontSource(
	source: EditorFontSource,
): SourceResult<string> {
	const file = toEditorFontFile(source)
	if (!file.ok) return failure(file.errors)
	return success(formatSourceJson(file.value as unknown as SourceJsonValue))
}

/** Parse strict JSON, reject ambiguous keys, and return frozen editor state. */
export function decodeEditorFontSource(
	text: string,
): SourceResult<EditorFontSource> {
	if (typeof text !== "string") {
		return failure([
			{
				severity: "error",
				code: "json.syntax",
				path: "$",
				message: "Expected JSON source text.",
			},
		])
	}
	let parsed: unknown
	try {
		parsed = JSON.parse(text)
	} catch {
		return failure([
			{
				severity: "error",
				code: "json.syntax",
				path: "$",
				message: "Invalid JSON syntax.",
			},
		])
	}
	let lexicalDiagnostics: readonly SourceDiagnostic[]
	try {
		lexicalDiagnostics = inspectJsonObjectKeys(text)
	} catch {
		return failure([
			{
				severity: "error",
				code: "json.inspection",
				path: "$",
				message: "JSON source could not be inspected safely.",
			},
		])
	}
	if (lexicalDiagnostics.length > 0) return failure(lexicalDiagnostics)
	return fromEditorFontFile(parsed)
}

/** Parse any accepted layout and emit the one canonical representation. */
export function canonicalizeEditorFontSource(
	text: string,
): SourceResult<string> {
	const source = decodeEditorFontSource(text)
	return source.ok
		? encodeEditorFontSource(source.value)
		: failure(source.errors)
}
