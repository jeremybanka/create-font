import {
	parseDesignDocumentText,
	type DesignSourceDiagnostic,
} from "@create-design/source"

import { IDENTITY_DESIGN_TRANSFORM } from "./geometry.ts"
import type { DesignDocument } from "./types.ts"

export const DESIGN_STORAGE_KEY = "create-design:document:v4"
export const PREVIOUS_DESIGN_STORAGE_KEY = "create-design:document:v3"
export const VERSION_TWO_DESIGN_STORAGE_KEY = "create-design:document:v2"
export const LEGACY_DESIGN_STORAGE_KEY = "create-design:document:v1"

export function createInitialDocument(): DesignDocument {
	return {
		format: "create-design.document",
		version: 4,
		title: "Untitled design",
		page: { x: 0, y: 0, width: 612, height: 792 },
		swatches: [
			{
				id: "swatch:paper",
				name: "Paper",
				source: { space: "rgb", r: 246, g: 242, b: 232 },
			},
			{
				id: "swatch:coral",
				name: "Studio coral",
				source: { space: "rgb", r: 218, g: 94, b: 67 },
				alternate: { space: "cmyk", c: 0, m: 72, y: 68, k: 4 },
			},
			{
				id: "swatch:cyan",
				name: "Process cyan",
				source: { space: "cmyk", c: 100, m: 0, y: 0, k: 0 },
			},
			{
				id: "swatch:ink",
				name: "Rich black",
				source: { space: "cmyk", c: 60, m: 40, y: 40, k: 100 },
			},
		],
		objects: [
			{
				id: "object:coral",
				name: "Coral rectangle",
				geometry: {
					kind: "rectangle",
					x: 82,
					y: 102,
					width: 280,
					height: 240,
				},
				transform: IDENTITY_DESIGN_TRANSFORM,
				appearance: { fill: { swatchId: "swatch:coral" } },
			},
			{
				id: "object:cyan",
				name: "Cyan ellipse",
				geometry: {
					kind: "ellipse",
					centerX: 389,
					centerY: 419,
					radiusX: 141,
					radiusY: 141,
				},
				transform: IDENTITY_DESIGN_TRANSFORM,
				appearance: { fill: { swatchId: "swatch:cyan" } },
			},
		],
		guides: [],
	}
}

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
