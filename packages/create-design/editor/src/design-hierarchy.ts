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

export function appendDesignHierarchyObjects(
	document: DesignDocument,
	objectIds: readonly string[],
): DesignDocument {
	if (document.scene === undefined || objectIds.length === 0) return document
	return {
		...document,
		scene: [
			...document.scene,
			...objectIds.map((id) => ({ kind: "object" as const, id })),
		],
	}
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
	if (document.scene === undefined || document.groups === undefined)
		return document
	return {
		...document,
		scene: replaceChildren(document.scene, objectId, replacementIds),
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
	if (document.scene === undefined || document.groups === undefined)
		return document
	let groups = document.groups.map((group) => ({
		...group,
		children: group.children.filter(
			(child) => child.kind !== "object" || !objectIds.has(child.id),
		),
	}))
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
		scene: document.scene.filter(
			(child) =>
				(child.kind !== "object" || !objectIds.has(child.id)) &&
				(child.kind !== "group" || !empty.has(child.id)),
		),
		groups,
	}
}

const normalized = (document: DesignDocument) => ({
	scene:
		document.scene ??
		document.objects.map((object) => ({
			kind: "object" as const,
			id: object.id,
		})),
	groups: document.groups ?? [],
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
	scene: readonly DesignSceneChild[],
	groups: readonly DesignGroup[],
): DesignDocument {
	const objects = new Map(document.objects.map((object) => [object.id, object]))
	const ordered = paintOrder(scene, groupMap(groups)).flatMap((id) => {
		const object = objects.get(id)
		return object === undefined ? [] : [object]
	})
	return { ...document, scene, groups, objects: ordered }
}

type Parent = Readonly<{
	id: string | null
	children: readonly DesignSceneChild[]
}>

function parents(
	scene: readonly DesignSceneChild[],
	groups: readonly DesignGroup[],
): readonly Parent[] {
	return [
		{ id: null, children: scene },
		...groups.map((group) => ({ id: group.id, children: group.children })),
	]
}

function parentForScope(
	document: DesignDocument,
	scopeGroupId: string | null,
): Parent | null {
	const hierarchy = normalized(document)
	if (scopeGroupId === null) return { id: null, children: hierarchy.scene }
	const group = hierarchy.groups.find(({ id }) => id === scopeGroupId)
	return group === undefined ? null : { id: group.id, children: group.children }
}

/** Resolves a painted object to the direct selection unit in the active group scope. */
export function designSelectionUnitAtObject(
	document: DesignDocument,
	objectId: string,
	scopeGroupId: string | null = null,
): DesignSelectionUnit | null {
	const hierarchy = normalized(document)
	const groups = groupMap(hierarchy.groups)
	const parent = parentForScope(document, scopeGroupId)
	if (parent === null) return null
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
): readonly string[] {
	const selected = new Set(objectIds)
	const parent = parentForScope(document, scopeGroupId)
	if (parent === null) return []
	const hierarchy = normalized(document)
	const groups = groupMap(hierarchy.groups)
	return parent.children.flatMap((child) => {
		const ids = descendantIds(child, groups)
		return ids.some((id) => selected.has(id)) ? ids : []
	})
}

/** Plans the exact selection and rigid object batch used by a Select-tool hit. */
export function designSelectInteraction(
	document: DesignDocument,
	currentSelection: readonly string[],
	objectId: string,
	scopeGroupId: string | null = null,
	additive = false,
): DesignSelectInteraction | null {
	const unit = designSelectionUnitAtObject(document, objectId, scopeGroupId)
	if (unit === null) return null
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
	const parent = parents(hierarchy.scene, hierarchy.groups).find(
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
	scene: readonly DesignSceneChild[],
	groups: readonly DesignGroup[],
	parentId: string | null,
	children: readonly DesignSceneChild[],
) {
	return parentId === null
		? { scene: children, groups }
		: {
				scene,
				groups: groups.map((group) =>
					group.id === parentId ? { ...group, children } : group,
				),
			}
}

/** Recreates complete selected hierarchy units using an existing object ID map. */
export function duplicateDesignHierarchySelection(
	document: DesignDocument,
	selection: readonly string[],
	objectIdMap: ReadonlyMap<string, string>,
	nextId: () => string,
): DesignHierarchyResult | null {
	if (document.scene === undefined || document.groups === undefined) return null
	const hierarchy = normalized(document)
	const groups = groupMap(hierarchy.groups)
	const selected = new Set(selection)
	const parent = parents(hierarchy.scene, hierarchy.groups).find(
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
		clonedGroups.push({ ...source, id, name: `${source.name} copy`, children })
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
	const replaced = replaceParent(
		hierarchy.scene,
		allGroups,
		parent.id,
		children,
	)
	const nextDocument = installHierarchy(
		document,
		replaced.scene,
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
	const parent = parents(hierarchy.scene, hierarchy.groups).find(
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
		hierarchy.scene,
		[...hierarchy.groups, group],
		parent.id,
		children,
	)
	return {
		document: installHierarchy(document, replaced.scene, replaced.groups),
		selection: paintOrder(group.children, groupMap(replaced.groups)),
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
	const parent = parents(hierarchy.scene, hierarchy.groups).find((candidate) =>
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
	const replaced = replaceParent(
		hierarchy.scene,
		remaining,
		parent.id,
		children,
	)
	return {
		document: installHierarchy(document, replaced.scene, replaced.groups),
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
	const parent = parents(hierarchy.scene, hierarchy.groups).find(
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
		hierarchy.scene,
		hierarchy.groups,
		parent.id,
		children,
	)
	return {
		document: installHierarchy(document, replaced.scene, replaced.groups),
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
	if (document.scene === undefined || document.groups === undefined)
		return scopeGroupId === null ? document : null
	const hierarchy = normalized(document)
	const groups = groupMap(hierarchy.groups)
	const selected = new Set(selection)
	const parent = parentForScope(document, scopeGroupId)
	if (parent === null) return null
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
		hierarchy.scene,
		remainingGroups,
		parent.id,
		children,
	)
	return installHierarchy(document, replaced.scene, replaced.groups)
}
