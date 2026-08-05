import { nextDesignLayerUiColor } from "@create-design/source"
import type {
	DesignDocument,
	DesignLayer,
	DesignLayerUiColor,
	DesignSceneChild,
} from "./types.ts"

export type DesignLayerIdKind = "blend" | "group" | "layer" | "object"
export type DesignLayerIdFactory = (kind: DesignLayerIdKind) => string

export type DesignLayerDeletion = Readonly<{
	document: DesignDocument
	fallbackLayerId: string
	removedObjectIds: readonly string[]
}>

export type DesignLayerDuplication = Readonly<{
	document: DesignDocument
	layerId: string
}>

function requireLayer(document: DesignDocument, layerId: string): DesignLayer {
	const layer = document.layers.find(({ id }) => id === layerId)
	if (layer === undefined) throw new Error(`Unknown design layer ${layerId}.`)
	return layer
}

function descendants(
	children: readonly DesignSceneChild[],
	groups: ReadonlyMap<string, DesignDocument["groups"][number]>,
): Readonly<{ groups: readonly string[]; objects: readonly string[] }> {
	const groupIds: string[] = []
	const objectIds: string[] = []
	const visit = (candidates: readonly DesignSceneChild[]): void => {
		for (const child of candidates) {
			if (child.kind === "object") objectIds.push(child.id)
			else {
				groupIds.push(child.id)
				visit(groups.get(child.id)?.children ?? [])
			}
		}
	}
	visit(children)
	return { groups: groupIds, objects: objectIds }
}

function booleanProperty(
	layer: DesignLayer,
	property: "hidden" | "locked",
	enabled: boolean,
): DesignLayer {
	const { [property]: ignored, ...rest } = layer
	void ignored
	return enabled ? { ...rest, [property]: true } : rest
}

export function createDesignLayer(
	document: DesignDocument,
	layer: Readonly<
		Pick<DesignLayer, "id" | "name"> & Partial<Pick<DesignLayer, "uiColor">>
	>,
): DesignDocument {
	if (document.layers.some(({ id }) => id === layer.id))
		throw new Error(`Design layer ${layer.id} already exists.`)
	const name = layer.name.trim()
	if (name.length === 0) throw new Error("A layer name cannot be empty.")
	return {
		...document,
		layers: [
			...document.layers,
			{
				...layer,
				name,
				children: [],
				uiColor:
					layer.uiColor ??
					nextDesignLayerUiColor(document.layers.map(({ uiColor }) => uiColor)),
			},
		],
	}
}

export function setDesignLayerUiColor(
	document: DesignDocument,
	layerId: string,
	uiColor: DesignLayerUiColor,
): DesignDocument {
	requireLayer(document, layerId)
	return {
		...document,
		layers: document.layers.map((layer) =>
			layer.id === layerId ? { ...layer, uiColor } : layer,
		),
	}
}

export function renameDesignLayer(
	document: DesignDocument,
	layerId: string,
	name: string,
): DesignDocument {
	requireLayer(document, layerId)
	const trimmed = name.trim()
	if (trimmed.length === 0) throw new Error("A layer name cannot be empty.")
	return {
		...document,
		layers: document.layers.map((layer) =>
			layer.id === layerId ? { ...layer, name: trimmed } : layer,
		),
	}
}

export function setDesignLayerVisibility(
	document: DesignDocument,
	layerId: string,
	visible: boolean,
): DesignDocument {
	requireLayer(document, layerId)
	return {
		...document,
		layers: document.layers.map((layer) =>
			layer.id === layerId ? booleanProperty(layer, "hidden", !visible) : layer,
		),
	}
}

export function setDesignLayerLocked(
	document: DesignDocument,
	layerId: string,
	locked: boolean,
): DesignDocument {
	requireLayer(document, layerId)
	return {
		...document,
		layers: document.layers.map((layer) =>
			layer.id === layerId ? booleanProperty(layer, "locked", locked) : layer,
		),
	}
}

/** Moves a layer one visual row toward the top or bottom of the Layers tile. */
export function reorderDesignLayer(
	document: DesignDocument,
	layerId: string,
	direction: "down" | "up",
): DesignDocument {
	const index = document.layers.findIndex(({ id }) => id === layerId)
	if (index < 0) throw new Error(`Unknown design layer ${layerId}.`)
	const target = direction === "up" ? index + 1 : index - 1
	if (target < 0 || target >= document.layers.length) return document
	const layers = [...document.layers]
	const [layer] = layers.splice(index, 1)
	layers.splice(target, 0, layer!)
	return { ...document, layers }
}

export function duplicateDesignLayer(
	document: DesignDocument,
	layerId: string,
	nextId: DesignLayerIdFactory,
): DesignLayerDuplication {
	const layer = requireLayer(document, layerId)
	const groupById = new Map(document.groups.map((group) => [group.id, group]))
	const tree = descendants(layer.children, groupById)
	const objectIds = new Set(tree.objects)
	const groupIds = new Set(tree.groups)
	const objectIdMap = new Map(tree.objects.map((id) => [id, nextId("object")]))
	const groupIdMap = new Map(tree.groups.map((id) => [id, nextId("group")]))
	const cloneChild = (child: DesignSceneChild): DesignSceneChild => ({
		kind: child.kind,
		id:
			child.kind === "object"
				? objectIdMap.get(child.id)!
				: groupIdMap.get(child.id)!,
	})
	const clonedObjects = document.objects
		.filter((object) => objectIds.has(object.id))
		.map((object) => ({
			...object,
			id: objectIdMap.get(object.id)!,
			name: `${object.name} copy`,
		}))
	const clonedGroups = document.groups
		.filter((group) => groupIds.has(group.id))
		.map((group) => ({
			...group,
			id: groupIdMap.get(group.id)!,
			name: `${group.name} copy`,
			children: group.children.map(cloneChild),
		}))
	const clonedBlends = (document.blends ?? []).flatMap((blend) => {
		const startObjectId = objectIdMap.get(blend.startObjectId)
		const endObjectId = objectIdMap.get(blend.endObjectId)
		return startObjectId === undefined || endObjectId === undefined
			? []
			: [
					{
						...blend,
						id: nextId("blend"),
						name: `${blend.name} copy`,
						startObjectId,
						endObjectId,
					},
				]
	})
	const duplicateId = nextId("layer")
	const duplicate: DesignLayer = {
		...layer,
		id: duplicateId,
		name: `${layer.name} copy`,
		children: layer.children.map(cloneChild),
	}
	return {
		layerId: duplicateId,
		document: {
			...document,
			objects: [...document.objects, ...clonedObjects],
			groups: [...document.groups, ...clonedGroups],
			layers: [...document.layers, duplicate],
			...(document.blends === undefined && clonedBlends.length === 0
				? {}
				: { blends: [...(document.blends ?? []), ...clonedBlends] }),
		},
	}
}

export function deleteDesignLayer(
	document: DesignDocument,
	layerId: string,
): DesignLayerDeletion {
	if (document.layers.length === 1)
		throw new Error("A design document must keep at least one layer.")
	const index = document.layers.findIndex(({ id }) => id === layerId)
	if (index < 0) throw new Error(`Unknown design layer ${layerId}.`)
	const layer = document.layers[index]!
	const tree = descendants(
		layer.children,
		new Map(document.groups.map((group) => [group.id, group])),
	)
	const objectIds = new Set(tree.objects)
	const groupIds = new Set(tree.groups)
	const layers = document.layers.filter(({ id }) => id !== layerId)
	const fallbackLayerId = layers[Math.min(index, layers.length - 1)]!.id
	return {
		fallbackLayerId,
		removedObjectIds: tree.objects,
		document: {
			...document,
			objects: document.objects.filter((object) => !objectIds.has(object.id)),
			groups: document.groups.filter((group) => !groupIds.has(group.id)),
			layers,
			...(document.blends === undefined
				? {}
				: {
						blends: document.blends.filter(
							(blend) =>
								!objectIds.has(blend.startObjectId) &&
								!objectIds.has(blend.endObjectId),
						),
					}),
		},
	}
}
