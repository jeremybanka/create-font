import {
	parseDesignDocumentText,
	type DesignSourceDiagnostic,
} from "@create-design/source"

import type { DesignDocument } from "./types.ts"

export { createInitialDocument } from "@create-design/source"

export const DESIGN_STORAGE_KEY = "create-design:document:v5"
export const PREVIOUS_DESIGN_STORAGE_KEY = "create-design:document:v4"
export const VERSION_THREE_DESIGN_STORAGE_KEY = "create-design:document:v3"
export const VERSION_TWO_DESIGN_STORAGE_KEY = "create-design:document:v2"
export const LEGACY_DESIGN_STORAGE_KEY = "create-design:document:v1"

export function parseDesignDocument(
	value: string | null,
): DesignDocument | null {
	if (value === null) return null
	const parsed = parseDesignDocumentText(value)
	return parsed.ok ? parsed.value : null
}

export type StoredDesignDocumentResult =
	| Readonly<{ status: "empty" }>
	| Readonly<{
			status: "loaded"
			document: DesignDocument
			migrated: boolean
	  }>
	| Readonly<{
			status: "invalid"
			errors: readonly DesignSourceDiagnostic[]
	  }>

type DesignStorage = Pick<Storage, "getItem" | "removeItem" | "setItem">

/**
 * Reads the current key before the legacy key and only writes after a
 * successful decode. Invalid input is left byte-for-byte intact for recovery.
 */
export function readStoredDesignDocument(
	storage: DesignStorage,
): StoredDesignDocumentResult {
	let current: string | null
	try {
		current = storage.getItem(DESIGN_STORAGE_KEY)
	} catch {
		return { status: "empty" }
	}
	if (current !== null) {
		const decoded = parseDesignDocumentText(current)
		return decoded.ok
			? { status: "loaded", document: decoded.value, migrated: false }
			: { status: "invalid", errors: decoded.errors }
	}
	for (const priorKey of [
		PREVIOUS_DESIGN_STORAGE_KEY,
		VERSION_THREE_DESIGN_STORAGE_KEY,
		VERSION_TWO_DESIGN_STORAGE_KEY,
		LEGACY_DESIGN_STORAGE_KEY,
	]) {
		let prior: string | null
		try {
			prior = storage.getItem(priorKey)
		} catch {
			return { status: "empty" }
		}
		if (prior === null) continue
		const decoded = parseDesignDocumentText(prior)
		if (!decoded.ok) return { status: "invalid", errors: decoded.errors }
		try {
			storage.setItem(DESIGN_STORAGE_KEY, JSON.stringify(decoded.value))
			storage.removeItem(priorKey)
		} catch {
			// A decoded document can still hydrate when migration persistence is blocked.
		}
		return { status: "loaded", document: decoded.value, migrated: true }
	}
	return { status: "empty" }
}
