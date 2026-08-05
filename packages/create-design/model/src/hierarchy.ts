import type {
	DesignDocument,
	DesignGroup,
	DesignLayer,
	DesignObject,
	DesignSceneChild,
} from "@create-design/source"

export type DesignEffectiveStateBlocker = Readonly<{
	kind: "layer" | "object"
	id: string
	name: string
}>

export type DesignEffectiveHierarchyEntry = Readonly<{
	object: DesignObject
	layer: DesignLayer
	groupIds: readonly string[]
	visible: boolean
	locked: boolean
	hiddenBy: DesignEffectiveStateBlocker | null
	lockedBy: DesignEffectiveStateBlocker | null
}>

export type DesignEffectiveHierarchy = Readonly<{
	/** Canonical recursive paint order, from back to front. */
	entries: readonly DesignEffectiveHierarchyEntry[]
	byObjectId: ReadonlyMap<string, DesignEffectiveHierarchyEntry>
	visibleObjects: readonly DesignObject[]
	editableObjects: readonly DesignObject[]
}>

const layerBlocker = (layer: DesignLayer): DesignEffectiveStateBlocker => ({
	kind: "layer",
	id: layer.id,
	name: layer.name,
})

const objectBlocker = (object: DesignObject): DesignEffectiveStateBlocker => ({
	kind: "object",
	id: object.id,
	name: object.name,
})

/**
 * Resolves authored hierarchy into one paint-ordered effective-state view.
 * Layer facts remain inherited metadata and are never copied onto descendants.
 */
export function projectDesignEffectiveHierarchy(
	document: Pick<DesignDocument, "groups" | "layers" | "objects">,
): DesignEffectiveHierarchy {
	const objects = new Map(document.objects.map((object) => [object.id, object]))
	const groups = new Map(document.groups.map((group) => [group.id, group]))
	const entries: DesignEffectiveHierarchyEntry[] = []

	const visit = (
		child: DesignSceneChild,
		layer: DesignLayer,
		groupIds: readonly string[],
	): void => {
		if (child.kind === "group") {
			const group: DesignGroup | undefined = groups.get(child.id)
			if (group === undefined) return
			for (const descendant of group.children)
				visit(descendant, layer, [...groupIds, group.id])
			return
		}
		const object = objects.get(child.id)
		if (object === undefined) return
		const hiddenBy = layer.hidden
			? layerBlocker(layer)
			: object.hidden
				? objectBlocker(object)
				: null
		const lockedBy = layer.locked
			? layerBlocker(layer)
			: object.locked
				? objectBlocker(object)
				: null
		entries.push({
			object,
			layer,
			groupIds,
			visible: hiddenBy === null,
			locked: lockedBy !== null,
			hiddenBy,
			lockedBy,
		})
	}

	for (const layer of document.layers)
		for (const child of layer.children) visit(child, layer, [])

	return {
		entries,
		byObjectId: new Map(entries.map((entry) => [entry.object.id, entry])),
		visibleObjects: entries.flatMap((entry) =>
			entry.visible ? [entry.object] : [],
		),
		editableObjects: entries.flatMap((entry) =>
			entry.visible && !entry.locked ? [entry.object] : [],
		),
	}
}

export function designObjectEffectiveState(
	document: Pick<DesignDocument, "groups" | "layers" | "objects">,
	objectId: string,
): DesignEffectiveHierarchyEntry | null {
	return (
		projectDesignEffectiveHierarchy(document).byObjectId.get(objectId) ?? null
	)
}
