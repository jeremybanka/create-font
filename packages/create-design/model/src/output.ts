import type {
	DesignDocument,
	DesignLayer,
	DesignObject,
	DesignSwatch,
} from "@create-design/source"

import {
	projectDesignDocumentBlends,
	resolveDesignBlend,
	type DesignBlendDiagnostic,
} from "./blends.ts"
import { projectDesignEffectiveHierarchy } from "./hierarchy.ts"

export type DesignOutputEntry = Readonly<{
	object: DesignObject
	layer: DesignLayer
	groupIds: readonly string[]
	source:
		| Readonly<{ kind: "object"; objectId: string }>
		| Readonly<{ kind: "blend"; blendId: string }>
}>

export type DesignOutputProjection = Readonly<{
	/** Visible ordinary and derived objects in canonical back-to-front order. */
	entries: readonly DesignOutputEntry[]
	objects: readonly DesignObject[]
	swatches: readonly DesignSwatch[]
	diagnostics: readonly DesignBlendDiagnostic[]
	byObjectId: ReadonlyMap<string, DesignOutputEntry>
	layerByBlendId: ReadonlyMap<string, DesignLayer>
}>

const effectiveObject = (
	entry: ReturnType<typeof projectDesignEffectiveHierarchy>["entries"][number],
): DesignObject =>
	entry.visible && entry.locked === Boolean(entry.object.locked)
		? entry.object
		: {
				...entry.object,
				...(entry.visible ? {} : { hidden: true }),
				...(entry.locked ? { locked: true } : {}),
			}

/**
 * Flattens layers and nested groups into one deterministic output stream.
 * Hidden layer descendants are removed, locked descendants remain visible,
 * and live blend steps inherit the later-painted endpoint's hierarchy slot.
 */
export function projectDesignOutput(
	document: DesignDocument,
): DesignOutputProjection {
	const hierarchy = projectDesignEffectiveHierarchy(document)
	const policyDocument: DesignDocument = {
		...document,
		objects: hierarchy.entries.map(effectiveObject),
	}
	const blendProjection = projectDesignDocumentBlends(policyDocument)
	const hierarchyByObjectId = hierarchy.byObjectId
	const objectIndex = new Map(
		policyDocument.objects.map(({ id }, index) => [id, index]),
	)
	const derivedEntries = new Map<string, DesignOutputEntry>()
	const layerByBlendId = new Map<string, DesignLayer>()

	for (const blend of policyDocument.blends ?? []) {
		const startIndex = objectIndex.get(blend.startObjectId)
		const endIndex = objectIndex.get(blend.endObjectId)
		if (startIndex === undefined || endIndex === undefined) continue
		const laterObjectId =
			startIndex < endIndex ? blend.endObjectId : blend.startObjectId
		const placement = hierarchyByObjectId.get(laterObjectId)
		if (placement === undefined) continue
		layerByBlendId.set(blend.id, placement.layer)
		for (const object of resolveDesignBlend(policyDocument, blend).objects)
			derivedEntries.set(object.id, {
				object,
				layer: placement.layer,
				groupIds: placement.groupIds,
				source: { kind: "blend", blendId: blend.id },
			})
	}

	const entries = blendProjection.objects.flatMap((object) => {
		const authored = hierarchyByObjectId.get(object.id)
		if (authored !== undefined)
			return authored.visible
				? [
						{
							object,
							layer: authored.layer,
							groupIds: authored.groupIds,
							source: {
								kind: "object" as const,
								objectId: object.id,
							},
						},
					]
				: []
		const derived = derivedEntries.get(object.id)
		return derived === undefined ? [] : [derived]
	})

	return {
		entries,
		objects: entries.map(({ object }) => object),
		swatches: blendProjection.swatches,
		diagnostics: blendProjection.diagnostics,
		byObjectId: new Map(entries.map((entry) => [entry.object.id, entry])),
		layerByBlendId,
	}
}

export function designOutputLayerForEntity(
	projection: DesignOutputProjection,
	entityId: string,
): DesignLayer | null {
	return (
		projection.byObjectId.get(entityId)?.layer ??
		projection.layerByBlendId.get(entityId) ??
		null
	)
}
