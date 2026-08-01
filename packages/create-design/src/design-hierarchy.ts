import type { DesignDocument, DesignGroup, DesignSceneChild } from "./types.ts"

export type DesignStackCommand = "forward" | "backward" | "front" | "back"

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
