import {
	createDesignBlend,
	expandDesignBlend,
	reverseDesignBlendEndpoint,
	resolveDesignBlend,
	setDesignBlendFirstPoint,
	updateDesignBlend,
} from "@create-design/model"

import type { DesignBlend, DesignDocument, DesignObject } from "./types.ts"

export {
	expandDesignBlend,
	reverseDesignBlendEndpoint,
	setDesignBlendFirstPoint,
	updateDesignBlend,
}

export const DESIGN_BLEND_MIME =
	"application/vnd.create-design.blend+json" as const

export type DesignBlendEligibility =
	| Readonly<{
			eligible: true
			start: DesignObject
			end: DesignObject
			warnings: readonly string[]
	  }>
	| Readonly<{ eligible: false; reason: string }>

/** Explains whether the current ordinary-object selection can become a blend. */
export function designBlendEligibility(
	document: DesignDocument,
	objectIds: readonly string[],
	steps = 5,
): DesignBlendEligibility {
	if (objectIds.length !== 2)
		return {
			eligible: false,
			reason: "Select exactly two ordinary objects to make a blend.",
		}
	const [start, end] = objectIds.map((id) =>
		document.objects.find((object) => object.id === id),
	)
	if (start === undefined || end === undefined)
		return {
			eligible: false,
			reason: "The complete two-object selection is no longer available.",
		}
	const unavailable = [start, end].find(
		(object) => object.hidden || object.locked,
	)
	if (unavailable !== undefined)
		return {
			eligible: false,
			reason: `${unavailable.hidden ? "Show" : "Unlock"} ${unavailable.name} before making a blend.`,
		}
	const existing = (document.blends ?? []).find(
		(blend) =>
			blend.startObjectId === start.id ||
			blend.endObjectId === start.id ||
			blend.startObjectId === end.id ||
			blend.endObjectId === end.id,
	)
	if (existing !== undefined)
		return {
			eligible: false,
			reason: `${existing.name || "A live blend"} already uses one of the selected endpoints. Expand it before reusing that endpoint.`,
		}
	let blend: DesignBlend
	try {
		blend = createDesignBlend(
			"blend:eligibility",
			"Selection",
			start,
			end,
			steps,
		)
	} catch (error) {
		return {
			eligible: false,
			reason: error instanceof Error ? error.message : "Invalid blend options.",
		}
	}
	const diagnostics = resolveDesignBlend(
		{ ...document, blends: [...(document.blends ?? []), blend] },
		blend,
	).diagnostics
	const error = diagnostics.find(({ severity }) => severity === "error")
	return error === undefined
		? {
				eligible: true,
				start,
				end,
				warnings: diagnostics
					.filter(({ severity }) => severity !== "error")
					.map(({ message }) => message),
			}
		: { eligible: false, reason: error.message }
}

/** Creates a live blend while keeping both endpoint objects ordinary. */
export function makeDesignBlend(
	document: DesignDocument,
	objectIds: readonly string[],
	nextId: () => string,
	steps = 5,
): Readonly<{ document: DesignDocument; blendId: string }> | null {
	const eligibility = designBlendEligibility(document, objectIds, steps)
	if (!eligibility.eligible) return null
	const blend = createDesignBlend(
		`blend:${nextId()}`,
		`Blend ${eligibility.start.name} → ${eligibility.end.name}`,
		eligibility.start,
		eligibility.end,
		steps,
	)
	return {
		document: { ...document, blends: [...(document.blends ?? []), blend] },
		blendId: blend.id,
	}
}
