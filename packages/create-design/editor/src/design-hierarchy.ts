import type {
	DesignDocument,
	DesignGroup,
	DesignObject,
	DesignSceneChild,
} from "./types.ts"

export type DesignStackCommand = "forward" | "backward" | "front" | "back"

export type DesignSelectionUnit = Readonly<{
	kind: "object" | "group"
	id: string
	name: string
	objectIds: readonly string[]
}>

export type DesignSelectInteraction = Readonly<{
	unit: DesignSelectionUnit
	selection: readonly string[]
	objects: readonly DesignObject[]
	lockedObject: DesignObject | null
}>

export type DesignHierarchyResult = Readonly<{
	document: DesignDocument
	selection: readonly string[]
}>

export type DesignHierarchyScope = Readonly<{
	layerId: string
	groupId: string | null
}>

export type DesignHierarchyNode = Readonly<{
	kind: "object" | "group"
	id: string
}>

export type DesignHierarchyParent = Readonly<{
	kind: "layer" | "group"
	id: string
}>

export type DesignHierarchyMoveResult = DesignHierarchyResult &
	Readonly<{
		layerId: string
		parent: DesignHierarchyParent
	}>

function childContainsGroup(
	child: DesignSceneChild,
	groupId: string,
	groups: ReadonlyMap<string, DesignGroup>,
): boolean {
	if (child.kind === "object") return false
	if (child.id === groupId) return true
	return (
		groups
			.get(child.id)
			?.children.some((candidate) =>
				childContainsGroup(candidate, groupId, groups),
			) ?? false
	)
}

function childContainsObject(
	child: DesignSceneChild,
	objectId: string,
	groups: ReadonlyMap<string, DesignGroup>,
): boolean {
	if (child.kind === "object") return child.id === objectId
	return (
		groups
			.get(child.id)
			?.children.some((candidate) =>
				childContainsObject(candidate, objectId, groups),
			) ?? false
	)
}

export function defaultDesignHierarchyScope(
	document: DesignDocument,
): DesignHierarchyScope {
	const layer = document.layers.at(-1)
	if (layer === undefined)
		throw new Error("A design document must contain at least one layer.")
	return { layerId: layer.id, groupId: null }
}

export function designLayerIdForObject(
	document: DesignDocument,
	objectId: string,
): string | null {
	const groups = new Map(document.groups.map((group) => [group.id, group]))
	return (
		document.layers.find((layer) =>
			layer.children.some((child) =>
				childContainsObject(child, objectId, groups),
			),
		)?.id ?? null
	)
}

export function designLayerIdForGroup(
	document: DesignDocument,
	groupId: string,
): string | null {
	const groups = new Map(document.groups.map((group) => [group.id, group]))
	return (
		document.layers.find((layer) =>
			layer.children.some((child) =>
				childContainsGroup(child, groupId, groups),
			),
		)?.id ?? null
	)
}

export function isDesignHierarchyScopeValid(
	document: DesignDocument,
	scope: DesignHierarchyScope,
): boolean {
	if (!document.layers.some((layer) => layer.id === scope.layerId)) return false
	return (
		scope.groupId === null ||
		designLayerIdForGroup(document, scope.groupId) === scope.layerId
	)
}

export function appendDesignHierarchyObjects(
	document: DesignDocument,
	objectIds: readonly string[],
	scope: DesignHierarchyScope,
): DesignDocument {
	if (objectIds.length === 0) return document
	if (!isDesignHierarchyScopeValid(document, scope))
		throw new Error("The active design hierarchy scope is unavailable.")
	const objects = new Set(document.objects.map((object) => object.id))
	const unknown = objectIds.find((id) => !objects.has(id))
	if (unknown !== undefined)
		throw new Error(`Cannot insert unknown design object ${unknown}.`)
	const additions = objectIds.map((id) => ({ kind: "object" as const, id }))
	const layers = document.layers.map((layer) =>
		scope.groupId === null && layer.id === scope.layerId
			? { ...layer, children: [...layer.children, ...additions] }
			: layer,
	)
	const groups = document.groups.map((group) =>
		group.id === scope.groupId
			? { ...group, children: [...group.children, ...additions] }
			: group,
	)
	return installHierarchy(document, layers, groups)
}

function replaceChildren(
	children: readonly DesignSceneChild[],
	objectId: string,
	replacementIds: readonly string[],
): readonly DesignSceneChild[] {
	return children.flatMap((child) =>
		child.kind === "object" && child.id === objectId
			? replacementIds.map((id) => ({ kind: "object" as const, id }))
			: [child],
	)
}

export function replaceDesignHierarchyObject(
	document: DesignDocument,
	objectId: string,
	replacementIds: readonly string[],
): DesignDocument {
	return {
		...document,
		layers: document.layers.map((layer) => ({
			...layer,
			children: replaceChildren(layer.children, objectId, replacementIds),
		})),
		groups: document.groups.map((group) => ({
			...group,
			children: replaceChildren(group.children, objectId, replacementIds),
		})),
	}
}

export function removeDesignHierarchyObjects(
	document: DesignDocument,
	objectIds: ReadonlySet<string>,
): DesignDocument {
	let groups: readonly DesignGroup[] = document.groups.map((group) => {
		const children = group.children.filter(
			(child) => child.kind !== "object" || !objectIds.has(child.id),
		)
		if (
			group.clippingPathId === undefined ||
			!objectIds.has(group.clippingPathId)
		)
			return { ...group, children }
		const { clippingPathId: _clippingPathId, ...released } = group
		return { ...released, children }
	})
	let empty = new Set(
		groups
			.filter((group) => group.children.length === 0)
			.map((group) => group.id),
	)
	while (empty.size > 0) {
		groups = groups
			.filter((group) => !empty.has(group.id))
			.map((group) => ({
				...group,
				children: group.children.filter(
					(child) => child.kind !== "group" || !empty.has(child.id),
				),
			}))
		const next = new Set(
			groups
				.filter((group) => group.children.length === 0)
				.map((group) => group.id),
		)
		if ([...next].every((id) => empty.has(id))) break
		empty = new Set([...empty, ...next])
	}
	return {
		...document,
		layers: document.layers.map((layer) => ({
			...layer,
			children: layer.children.filter(
				(child) =>
					(child.kind !== "object" || !objectIds.has(child.id)) &&
					(child.kind !== "group" || !empty.has(child.id)),
			),
		})),
		groups,
	}
}

const normalized = (document: DesignDocument) => ({
	layers: document.layers,
	groups: document.groups,
})

const groupMap = (groups: readonly DesignGroup[]) =>
	new Map(groups.map((group) => [group.id, group]))

function descendantIds(
	child: DesignSceneChild,
	groups: ReadonlyMap<string, DesignGroup>,
): readonly string[] {
	if (child.kind === "object") return [child.id]
	return (groups.get(child.id)?.children ?? []).flatMap((candidate) =>
		descendantIds(candidate, groups),
	)
}

function paintOrder(
	children: readonly DesignSceneChild[],
	groups: ReadonlyMap<string, DesignGroup>,
): readonly string[] {
	return children.flatMap((child) => descendantIds(child, groups))
}

function installHierarchy(
	document: DesignDocument,
	layers: DesignDocument["layers"],
	groups: readonly DesignGroup[],
): DesignDocument {
	const objects = new Map(document.objects.map((object) => [object.id, object]))
	const ordered = layers
		.flatMap((layer) => paintOrder(layer.children, groupMap(groups)))
		.flatMap((id) => {
			const object = objects.get(id)
			return object === undefined ? [] : [object]
		})
	return { ...document, layers, groups, objects: ordered }
}

type Parent = Readonly<{
	kind: "layer" | "group"
	id: string
	children: readonly DesignSceneChild[]
}>

function parents(
	layers: DesignDocument["layers"],
	groups: readonly DesignGroup[],
): readonly Parent[] {
	return [
		...layers.map((layer) => ({
			kind: "layer" as const,
			id: layer.id,
			children: layer.children,
		})),
		...groups.map((group) => ({
			kind: "group" as const,
			id: group.id,
			children: group.children,
		})),
	]
}

function parentsForScope(
	document: DesignDocument,
	scopeGroupId: string | null,
): readonly Parent[] {
	const hierarchy = normalized(document)
	if (scopeGroupId === null)
		return parents(hierarchy.layers, hierarchy.groups).filter(
			(parent) => parent.kind === "layer",
		)
	const group = hierarchy.groups.find(({ id }) => id === scopeGroupId)
	return group === undefined
		? []
		: [{ kind: "group", id: group.id, children: group.children }]
}

/** Resolves a painted object to the direct selection unit in the active group scope. */
export function designSelectionUnitAtObject(
	document: DesignDocument,
	objectId: string,
	scopeGroupId: string | null = null,
): DesignSelectionUnit | null {
	const hierarchy = normalized(document)
	const groups = groupMap(hierarchy.groups)
	const parent = parentsForScope(document, scopeGroupId).find((candidate) =>
		candidate.children.some((child) =>
			descendantIds(child, groups).includes(objectId),
		),
	)
	if (parent === undefined) return null
	const child = parent.children.find((candidate) =>
		descendantIds(candidate, groups).includes(objectId),
	)
	if (child === undefined) return null
	const objectIds = descendantIds(child, groups)
	if (child.kind === "object") {
		const object = document.objects.find(({ id }) => id === child.id)
		return {
			kind: "object",
			id: child.id,
			name: object?.name ?? child.id,
			objectIds,
		}
	}
	const group = groups.get(child.id)
	return {
		kind: "group",
		id: child.id,
		name: group?.name ?? child.id,
		objectIds,
	}
}

/** Returns the exact direct unit represented by a complete object-ID selection. */
export function designSelectionUnitForIds(
	document: DesignDocument,
	selection: readonly string[],
	scopeGroupId: string | null = null,
): DesignSelectionUnit | null {
	if (selection.length === 0) return null
	const selected = new Set(selection)
	const first = designSelectionUnitAtObject(
		document,
		selection[0]!,
		scopeGroupId,
	)
	return first !== null &&
		first.objectIds.length === selected.size &&
		first.objectIds.every((id) => selected.has(id))
		? first
		: null
}

/** Expands raw object hits to complete direct units in deterministic paint order. */
export function normalizeDesignSelection(
	document: DesignDocument,
	objectIds: readonly string[],
	scopeGroupId: string | null = null,
	eligibleObjectIds?: ReadonlySet<string>,
): readonly string[] {
	const selected = new Set(objectIds)
	const hierarchy = normalized(document)
	const groups = groupMap(hierarchy.groups)
	return parentsForScope(document, scopeGroupId).flatMap((parent) =>
		parent.children.flatMap((child) => {
			const ids = descendantIds(child, groups)
			return ids.some((id) => selected.has(id)) &&
				(eligibleObjectIds === undefined ||
					ids.every((id) => eligibleObjectIds.has(id)))
				? ids
				: []
		}),
	)
}

/** Plans the exact selection and rigid object batch used by a Select-tool hit. */
export function designSelectInteraction(
	document: DesignDocument,
	currentSelection: readonly string[],
	objectId: string,
	scopeGroupId: string | null = null,
	additive = false,
	eligibleObjectIds?: ReadonlySet<string>,
): DesignSelectInteraction | null {
	const unit = designSelectionUnitAtObject(document, objectId, scopeGroupId)
	if (unit === null) return null
	if (
		eligibleObjectIds !== undefined &&
		!unit.objectIds.every((id) => eligibleObjectIds.has(id))
	)
		return null
	const unitIds = new Set(unit.objectIds)
	const alreadySelected = unit.objectIds.every((id) =>
		currentSelection.includes(id),
	)
	const selection = additive
		? alreadySelected
			? currentSelection.filter((id) => !unitIds.has(id))
			: document.objects
					.filter(
						(candidate) =>
							currentSelection.includes(candidate.id) ||
							unitIds.has(candidate.id),
					)
					.map(({ id }) => id)
		: alreadySelected
			? currentSelection
			: unit.objectIds
	const objects = document.objects.filter((object) =>
		selection.includes(object.id),
	)
	return {
		unit,
		selection,
		objects,
		lockedObject: objects.find((object) => object.locked) ?? null,
	}
}

export function designParentGroupId(
	document: DesignDocument,
	groupId: string,
): string | null {
	const hierarchy = normalized(document)
	return (
		hierarchy.groups.find((group) =>
			group.children.some(
				(child) => child.kind === "group" && child.id === groupId,
			),
		)?.id ?? null
	)
}

export function designGroupSelectionUnit(
	document: DesignDocument,
	groupId: string,
): DesignSelectionUnit | null {
	const hierarchy = normalized(document)
	const groups = groupMap(hierarchy.groups)
	const group = groups.get(groupId)
	if (group === undefined) return null
	return {
		kind: "group",
		id: group.id,
		name: group.name,
		objectIds: paintOrder(group.children, groups),
	}
}

function selectedUnits(
	parent: Parent,
	selection: ReadonlySet<string>,
	groups: ReadonlyMap<string, DesignGroup>,
): readonly DesignSceneChild[] {
	return parent.children.filter((child) => {
		const ids = descendantIds(child, groups)
		return ids.length > 0 && ids.every((id) => selection.has(id))
	})
}

/** Resolves selected sibling objects or complete groups into transform units. */
export function designSelectionUnits(
	document: DesignDocument,
	selection: readonly string[],
): readonly (readonly string[])[] {
	const hierarchy = normalized(document)
	const groups = groupMap(hierarchy.groups)
	const selected = new Set(selection)
	const parent = parents(hierarchy.layers, hierarchy.groups).find(
		(candidate) => {
			const units = selectedUnits(candidate, selected, groups)
			return (
				units.length > 0 &&
				new Set(units.flatMap((unit) => descendantIds(unit, groups))).size ===
					selected.size
			)
		},
	)
	return parent === undefined
		? selection.map((id) => [id])
		: selectedUnits(parent, selected, groups).map((unit) =>
				descendantIds(unit, groups),
			)
}

function replaceParent(
	layers: DesignDocument["layers"],
	groups: readonly DesignGroup[],
	parent: Parent,
	children: readonly DesignSceneChild[],
) {
	return parent.kind === "layer"
		? {
				layers: layers.map((layer) =>
					layer.id === parent.id ? { ...layer, children } : layer,
				),
				groups,
			}
		: {
				layers,
				groups: groups.map((group) =>
					group.id === parent.id ? { ...group, children } : group,
				),
			}
}

function sameNode(
	left: Pick<DesignSceneChild, "kind" | "id">,
	right: Pick<DesignSceneChild, "kind" | "id">,
): boolean {
	return left.kind === right.kind && left.id === right.id
}

export function designHierarchyParentForNode(
	document: DesignDocument,
	node: DesignHierarchyNode,
): DesignHierarchyParent | null {
	const hierarchy = normalized(document)
	const parent = parents(hierarchy.layers, hierarchy.groups).find((candidate) =>
		candidate.children.some((child) => sameNode(child, node)),
	)
	return parent === undefined ? null : { kind: parent.kind, id: parent.id }
}

function layerForParent(
	document: DesignDocument,
	parent: DesignHierarchyParent,
): DesignDocument["layers"][number] | null {
	const layerId =
		parent.kind === "layer"
			? parent.id
			: designLayerIdForGroup(document, parent.id)
	return document.layers.find(({ id }) => id === layerId) ?? null
}

/**
 * Moves one complete object or group to an explicit parent and final sibling
 * index. The index is interpreted after removing the source from its old
 * parent, which keeps same-parent reordering deterministic.
 */
export function moveDesignHierarchyNode(
	document: DesignDocument,
	node: DesignHierarchyNode,
	destination: DesignHierarchyParent,
	index: number,
): DesignHierarchyMoveResult | null {
	const hierarchy = normalized(document)
	const sourceParent = parents(hierarchy.layers, hierarchy.groups).find(
		(candidate) => candidate.children.some((child) => sameNode(child, node)),
	)
	if (sourceParent === undefined)
		throw new Error(`Cannot move unknown ${node.kind} ${node.id}.`)
	const sourceLayer = layerForParent(document, {
		kind: sourceParent.kind,
		id: sourceParent.id,
	})
	if (sourceLayer === null)
		throw new Error(`The source ${node.kind} has no valid layer.`)
	if (sourceLayer.hidden)
		throw new Error(`Show ${sourceLayer.name} before moving its contents.`)
	if (sourceLayer.locked)
		throw new Error(`Unlock ${sourceLayer.name} before moving its contents.`)

	const destinationParent = parents(hierarchy.layers, hierarchy.groups).find(
		(candidate) =>
			candidate.kind === destination.kind && candidate.id === destination.id,
	)
	if (destinationParent === undefined)
		throw new Error(
			`Cannot move into unknown ${destination.kind} ${destination.id}.`,
		)
	const destinationLayer = layerForParent(document, destination)
	if (destinationLayer === null)
		throw new Error(`The destination ${destination.kind} has no valid layer.`)
	if (destinationLayer.hidden)
		throw new Error(
			`Show ${destinationLayer.name} before moving artwork into it.`,
		)
	if (destinationLayer.locked)
		throw new Error(
			`Unlock ${destinationLayer.name} before moving artwork into it.`,
		)
	if (node.kind === "group") {
		if (destination.kind === "group" && destination.id === node.id)
			throw new Error("A group cannot be moved into itself.")
		const groups = groupMap(hierarchy.groups)
		const source = groups.get(node.id)
		if (
			destination.kind === "group" &&
			source?.children.some((child) =>
				childContainsGroup(child, destination.id, groups),
			)
		)
			throw new Error("A group cannot be moved into one of its descendants.")
	}

	const sourceChildren = sourceParent.children.filter(
		(child) => !sameNode(child, node),
	)
	const sameParent =
		sourceParent.kind === destinationParent.kind &&
		sourceParent.id === destinationParent.id
	const destinationChildren = sameParent
		? [...sourceChildren]
		: [...destinationParent.children]
	if (
		!Number.isInteger(index) ||
		index < 0 ||
		index > destinationChildren.length
	)
		throw new Error("The requested hierarchy position is unavailable.")
	destinationChildren.splice(index, 0, { kind: node.kind, id: node.id })
	if (
		sameParent &&
		destinationChildren.every(
			(child, childIndex) =>
				sourceParent.children[childIndex] !== undefined &&
				sameNode(child, sourceParent.children[childIndex]!),
		)
	)
		return null

	let replaced = replaceParent(
		hierarchy.layers,
		hierarchy.groups,
		sourceParent,
		sourceChildren,
	)
	const currentDestination = parents(replaced.layers, replaced.groups).find(
		(candidate) =>
			candidate.kind === destination.kind && candidate.id === destination.id,
	)!
	replaced = replaceParent(
		replaced.layers,
		replaced.groups,
		currentDestination,
		destinationChildren,
	)
	const nextDocument = installHierarchy(
		document,
		replaced.layers,
		replaced.groups,
	)
	return {
		document: nextDocument,
		selection: descendantIds(
			{ kind: node.kind, id: node.id },
			groupMap(replaced.groups),
		),
		layerId: destinationLayer.id,
		parent: destination,
	}
}

/** Recreates complete selected hierarchy units using an existing object ID map. */
export function duplicateDesignHierarchySelection(
	document: DesignDocument,
	selection: readonly string[],
	objectIdMap: ReadonlyMap<string, string>,
	nextId: () => string,
): DesignHierarchyResult | null {
	const hierarchy = normalized(document)
	const groups = groupMap(hierarchy.groups)
	const selected = new Set(selection)
	const parent = parents(hierarchy.layers, hierarchy.groups).find(
		(candidate) => {
			const units = selectedUnits(candidate, selected, groups)
			return (
				units.length > 0 &&
				new Set(units.flatMap((unit) => descendantIds(unit, groups))).size ===
					selected.size
			)
		},
	)
	if (parent === undefined) return null
	const units = selectedUnits(parent, selected, groups)
	const clonedGroups: DesignGroup[] = []
	const cloneChild = (child: DesignSceneChild): DesignSceneChild | null => {
		if (child.kind === "object") {
			const id = objectIdMap.get(child.id)
			return id === undefined ? null : { kind: "object", id }
		}
		const source = groups.get(child.id)
		if (source === undefined) return null
		const children = source.children.flatMap((candidate) => {
			const clone = cloneChild(candidate)
			return clone === null ? [] : [clone]
		})
		const id = `group:${nextId()}`
		const clippingPathId =
			source.clippingPathId === undefined
				? undefined
				: objectIdMap.get(source.clippingPathId)
		clonedGroups.push({
			...source,
			id,
			name: `${source.name} copy`,
			children,
			...(clippingPathId === undefined ? {} : { clippingPathId }),
		})
		return { kind: "group", id }
	}
	const clones = units.flatMap((unit) => {
		const clone = cloneChild(unit)
		return clone === null ? [] : [clone]
	})
	if (clones.length === 0) return null
	const unitKeys = new Set(units.map((unit) => `${unit.kind}:${unit.id}`))
	const last = parent.children.findLastIndex((child) =>
		unitKeys.has(`${child.kind}:${child.id}`),
	)
	const children = [...parent.children]
	children.splice(last + 1, 0, ...clones)
	const allGroups = [...hierarchy.groups, ...clonedGroups]
	const replaced = replaceParent(hierarchy.layers, allGroups, parent, children)
	const nextDocument = installHierarchy(
		document,
		replaced.layers,
		replaced.groups,
	)
	return {
		document: nextDocument,
		selection: clones.flatMap((child) =>
			descendantIds(child, groupMap(replaced.groups)),
		),
	}
}

export function groupDesignSelection(
	document: DesignDocument,
	selection: readonly string[],
	nextId: () => string,
): DesignHierarchyResult | null {
	const hierarchy = normalized(document)
	const groups = groupMap(hierarchy.groups)
	const selected = new Set(selection)
	const parent = parents(hierarchy.layers, hierarchy.groups).find(
		(candidate) => {
			const units = selectedUnits(candidate, selected, groups)
			return (
				units.length >= 2 &&
				new Set(units.flatMap((unit) => descendantIds(unit, groups))).size ===
					selected.size
			)
		},
	)
	if (parent === undefined) return null
	const units = selectedUnits(parent, selected, groups)
	const unitIds = new Set(units.map((unit) => `${unit.kind}:${unit.id}`))
	const first = parent.children.findIndex((child) =>
		unitIds.has(`${child.kind}:${child.id}`),
	)
	const id = `group:${nextId()}`
	const group: DesignGroup = {
		id,
		name: `Group ${hierarchy.groups.length + 1}`,
		children: units,
	}
	const children = parent.children.filter(
		(child) => !unitIds.has(`${child.kind}:${child.id}`),
	)
	children.splice(first, 0, { kind: "group", id })
	const replaced = replaceParent(
		hierarchy.layers,
		[...hierarchy.groups, group],
		parent,
		children,
	)
	return {
		document: installHierarchy(document, replaced.layers, replaced.groups),
		selection: paintOrder(group.children, groupMap(replaced.groups)),
	}
}

/** Makes the topmost selected sibling vector object the group's explicit clip. */
export function makeDesignClippingMask(
	document: DesignDocument,
	selection: readonly string[],
	nextId: () => string,
): DesignHierarchyResult | null {
	const hierarchy = normalized(document)
	const groups = groupMap(hierarchy.groups)
	const selected = new Set(selection)
	const parent = parents(hierarchy.layers, hierarchy.groups).find(
		(candidate) => {
			const units = selectedUnits(candidate, selected, groups)
			return (
				units.length >= 2 &&
				new Set(units.flatMap((unit) => descendantIds(unit, groups))).size ===
					selected.size
			)
		},
	)
	if (parent === undefined) return null
	const units = selectedUnits(parent, selected, groups)
	const clippingChild = units.at(-1)
	if (clippingChild?.kind !== "object") return null
	const clippingObject = document.objects.find(
		(object) => object.id === clippingChild.id,
	)
	if (
		clippingObject === undefined ||
		clippingObject.geometry.kind === "image" ||
		clippingObject.geometry.kind === "text"
	)
		return null
	const unitIds = new Set(units.map((unit) => `${unit.kind}:${unit.id}`))
	const first = parent.children.findIndex((child) =>
		unitIds.has(`${child.kind}:${child.id}`),
	)
	const id = `group:${nextId()}`
	const group: DesignGroup = {
		id,
		name: `Clipping Mask ${hierarchy.groups.length + 1}`,
		children: units,
		clippingPathId: clippingObject.id,
	}
	const children = parent.children.filter(
		(child) => !unitIds.has(`${child.kind}:${child.id}`),
	)
	children.splice(first, 0, { kind: "group", id })
	const replaced = replaceParent(
		hierarchy.layers,
		[...hierarchy.groups, group],
		parent,
		children,
	)
	return {
		document: installHierarchy(document, replaced.layers, replaced.groups),
		selection: paintOrder(group.children, groupMap(replaced.groups)),
	}
}

/** Releases clipping while preserving the group, children, and paint order. */
export function releaseDesignClippingMask(
	document: DesignDocument,
	groupId: string,
): DesignHierarchyResult | null {
	const group = document.groups.find(({ id }) => id === groupId)
	if (group?.clippingPathId === undefined) return null
	const groups = document.groups.map((candidate) => {
		if (candidate.id !== groupId) return candidate
		const { clippingPathId: _clippingPathId, ...released } = candidate
		return released
	})
	return {
		document: installHierarchy(document, document.layers, groups),
		selection: paintOrder(group.children, groupMap(document.groups)),
	}
}

export function ungroupDesignSelection(
	document: DesignDocument,
	selection: readonly string[],
): DesignHierarchyResult | null {
	const hierarchy = normalized(document)
	const groups = groupMap(hierarchy.groups)
	const selected = new Set(selection)
	const group = hierarchy.groups.find((candidate) => {
		const ids = paintOrder(candidate.children, groups)
		return (
			ids.length > 0 &&
			ids.length === selected.size &&
			ids.every((id) => selected.has(id))
		)
	})
	if (group === undefined) return null
	const parent = parents(hierarchy.layers, hierarchy.groups).find((candidate) =>
		candidate.children.some(
			(child) => child.kind === "group" && child.id === group.id,
		),
	)
	if (parent === undefined) return null
	const index = parent.children.findIndex(
		(child) => child.kind === "group" && child.id === group.id,
	)
	const children = [...parent.children]
	children.splice(index, 1, ...group.children)
	const remaining = hierarchy.groups.filter(
		(candidate) => candidate.id !== group.id,
	)
	const replaced = replaceParent(hierarchy.layers, remaining, parent, children)
	return {
		document: installHierarchy(document, replaced.layers, replaced.groups),
		selection: paintOrder(group.children, groups),
	}
}

export function stackDesignSelection(
	document: DesignDocument,
	selection: readonly string[],
	command: DesignStackCommand,
): DesignHierarchyResult | null {
	const hierarchy = normalized(document)
	const groups = groupMap(hierarchy.groups)
	const selected = new Set(selection)
	const parent = parents(hierarchy.layers, hierarchy.groups).find(
		(candidate) => {
			const units = selectedUnits(candidate, selected, groups)
			return (
				units.length > 0 &&
				new Set(units.flatMap((unit) => descendantIds(unit, groups))).size ===
					selected.size
			)
		},
	)
	if (parent === undefined) return null
	const units = selectedUnits(parent, selected, groups)
	const unitIds = new Set(units.map((unit) => `${unit.kind}:${unit.id}`))
	const isSelected = (child: DesignSceneChild) =>
		unitIds.has(`${child.kind}:${child.id}`)
	let children = [...parent.children]
	if (command === "front" || command === "back") {
		const moving = children.filter(isSelected)
		const rest = children.filter((child) => !isSelected(child))
		children = command === "front" ? [...rest, ...moving] : [...moving, ...rest]
	} else if (command === "forward") {
		for (let index = children.length - 2; index >= 0; index -= 1)
			if (isSelected(children[index]!) && !isSelected(children[index + 1]!))
				[children[index], children[index + 1]] = [
					children[index + 1]!,
					children[index]!,
				]
	} else {
		for (let index = 1; index < children.length; index += 1)
			if (isSelected(children[index]!) && !isSelected(children[index - 1]!))
				[children[index - 1], children[index]] = [
					children[index]!,
					children[index - 1]!,
				]
	}
	if (children.every((child, index) => child === parent.children[index]))
		return null
	const replaced = replaceParent(
		hierarchy.layers,
		hierarchy.groups,
		parent,
		children,
	)
	return {
		document: installHierarchy(document, replaced.layers, replaced.groups),
		selection,
	}
}

function descendantGroupIds(
	child: DesignSceneChild,
	groups: ReadonlyMap<string, DesignGroup>,
): readonly string[] {
	if (child.kind === "object") return []
	const group = groups.get(child.id)
	return [
		child.id,
		...(group?.children.flatMap((candidate) =>
			descendantGroupIds(candidate, groups),
		) ?? []),
	]
}

/**
 * Replaces complete sibling hierarchy units at their topmost paint position.
 * Selected groups are consumed as units, so no dangling group references or
 * unrelated sibling rewrites survive topology commands such as Compound Path.
 */
export function replaceDesignHierarchySelection(
	document: DesignDocument,
	selection: readonly string[],
	replacementIds: readonly string[],
	scopeGroupId: string | null = null,
): DesignDocument | null {
	const hierarchy = normalized(document)
	const groups = groupMap(hierarchy.groups)
	const selected = new Set(selection)
	const parent = parentsForScope(document, scopeGroupId).find((candidate) => {
		const units = selectedUnits(candidate, selected, groups)
		return (
			units.length > 0 &&
			new Set(units.flatMap((unit) => descendantIds(unit, groups))).size ===
				selected.size
		)
	})
	if (parent === undefined) return null
	const units = selectedUnits(parent, selected, groups)
	if (
		units.length === 0 ||
		new Set(units.flatMap((unit) => descendantIds(unit, groups))).size !==
			selected.size
	)
		return null
	const unitKeys = new Set(units.map((unit) => `${unit.kind}:${unit.id}`))
	const last = parent.children.findLastIndex((child) =>
		unitKeys.has(`${child.kind}:${child.id}`),
	)
	const insertion = parent.children
		.slice(0, last + 1)
		.filter((child) => !unitKeys.has(`${child.kind}:${child.id}`)).length
	const children = parent.children.filter(
		(child) => !unitKeys.has(`${child.kind}:${child.id}`),
	)
	children.splice(
		insertion,
		0,
		...replacementIds.map((id) => ({ kind: "object" as const, id })),
	)
	const removedGroups = new Set(
		units.flatMap((unit) => descendantGroupIds(unit, groups)),
	)
	const remainingGroups = hierarchy.groups.filter(
		(group) => !removedGroups.has(group.id),
	)
	const replaced = replaceParent(
		hierarchy.layers,
		remainingGroups,
		parent,
		children,
	)
	return installHierarchy(document, replaced.layers, replaced.groups)
}
