import type {
	DesignBlend,
	DesignDocument,
	DesignObject,
	DesignPoint,
	DesignSceneChild,
	DesignSwatch,
} from "@create-design/source"

import { createDesignBlend, resolveDesignBlend } from "./blends.ts"

function recaptureBlend(
	document: DesignDocument,
	blend: DesignBlend,
): DesignBlend {
	const start = document.objects.find(({ id }) => id === blend.startObjectId)
	const end = document.objects.find(({ id }) => id === blend.endObjectId)
	if (start === undefined || end === undefined) return blend
	return {
		...createDesignBlend(blend.id, blend.name, start, end, blend.steps),
		...(blend.hidden === undefined ? {} : { hidden: blend.hidden }),
		...(blend.locked === undefined ? {} : { locked: blend.locked }),
	}
}

/** Replaces persisted blend options without changing its identity or endpoints. */
export function updateDesignBlend(
	document: DesignDocument,
	blendId: string,
	property: Partial<Pick<DesignBlend, "name" | "steps">>,
): DesignDocument | null {
	const blend = document.blends?.find(({ id }) => id === blendId)
	if (blend === undefined) return null
	const steps = property.steps ?? blend.steps
	if (!Number.isInteger(steps) || steps < 1 || steps > 10_000) return null
	return {
		...document,
		blends: document.blends!.map((candidate) =>
			candidate.id === blendId
				? { ...candidate, ...property, steps }
				: candidate,
		),
	}
}

function reversePoint(point: DesignPoint): DesignPoint {
	const { incoming, outgoing, ...rest } = point
	return {
		...rest,
		...(outgoing === undefined ? {} : { incoming: outgoing }),
		...(incoming === undefined ? {} : { outgoing: incoming }),
	}
}

/** Reverses every path contour on one endpoint and recaptures correspondence. */
export function reverseDesignBlendEndpoint(
	document: DesignDocument,
	blendId: string,
	endpoint: "start" | "end",
): DesignDocument | null {
	const blend = document.blends?.find(({ id }) => id === blendId)
	if (blend === undefined) return null
	const objectId =
		endpoint === "start" ? blend.startObjectId : blend.endObjectId
	const object = document.objects.find(({ id }) => id === objectId)
	if (object?.geometry.kind !== "path" || object.locked) return null
	const reversed: DesignObject = {
		...object,
		geometry: {
			...object.geometry,
			contours: object.geometry.contours.map((contour) => ({
				...contour,
				points: [...contour.points].reverse().map(reversePoint),
			})),
		},
	}
	const next = {
		...document,
		objects: document.objects.map((candidate) =>
			candidate.id === objectId ? reversed : candidate,
		),
	}
	return {
		...next,
		blends: next.blends!.map((candidate) =>
			candidate.id === blendId ? recaptureBlend(next, candidate) : candidate,
		),
	}
}

/** Makes an existing closed-path point the persisted first point. */
export function setDesignBlendFirstPoint(
	document: DesignDocument,
	blendId: string,
	endpoint: "start" | "end",
	contourId: string,
	pointId: string,
): DesignDocument | null {
	const blend = document.blends?.find(({ id }) => id === blendId)
	if (blend === undefined) return null
	const objectId =
		endpoint === "start" ? blend.startObjectId : blend.endObjectId
	const object = document.objects.find(({ id }) => id === objectId)
	if (object?.geometry.kind !== "path" || object.locked) return null
	const contour = object.geometry.contours.find(({ id }) => id === contourId)
	const index = contour?.points.findIndex(({ id }) => id === pointId) ?? -1
	if (contour === undefined || !contour.closed || index < 0) return null
	const updated: DesignObject = {
		...object,
		geometry: {
			...object.geometry,
			contours: object.geometry.contours.map((candidate) =>
				candidate.id === contourId
					? {
							...candidate,
							points: [
								...candidate.points.slice(index),
								...candidate.points.slice(0, index),
							],
						}
					: candidate,
			),
		},
	}
	const next = {
		...document,
		objects: document.objects.map((candidate) =>
			candidate.id === objectId ? updated : candidate,
		),
	}
	return {
		...next,
		blends: next.blends!.map((candidate) =>
			candidate.id === blendId ? recaptureBlend(next, candidate) : candidate,
		),
	}
}

function freshExpandedObject(
	object: DesignObject,
	nextId: () => string,
	swatchIds: ReadonlyMap<string, string>,
): DesignObject {
	return {
		...object,
		id: `object:${nextId()}`,
		geometry:
			object.geometry.kind !== "path"
				? object.geometry
				: {
						...object.geometry,
						contours: object.geometry.contours.map((contour) => ({
							...contour,
							id: `contour:${nextId()}`,
							points: contour.points.map((point) => ({
								...point,
								id: `point:${nextId()}`,
							})),
						})),
					},
		appearance: {
			...(object.appearance.fill === undefined
				? {}
				: {
						fill: {
							swatchId:
								swatchIds.get(object.appearance.fill.swatchId) ??
								object.appearance.fill.swatchId,
						},
					}),
			...(object.appearance.stroke === undefined
				? {}
				: {
						stroke: {
							...object.appearance.stroke,
							swatchId:
								swatchIds.get(object.appearance.stroke.swatchId) ??
								object.appearance.stroke.swatchId,
						},
					}),
		},
	}
}

function insertSceneChildrenBefore(
	children: readonly DesignSceneChild[],
	beforeId: string,
	insertions: readonly DesignSceneChild[],
): readonly DesignSceneChild[] {
	return children.flatMap((child) =>
		child.kind === "object" && child.id === beforeId
			? [...insertions, child]
			: [child],
	)
}

/**
 * Expands only derived intermediates. Endpoint objects are retained in place;
 * fresh ordinary paths are inserted immediately before the later endpoint.
 */
export function expandDesignBlend(
	document: DesignDocument,
	blendId: string,
	nextId: () => string,
): Readonly<{ document: DesignDocument; selection: readonly string[] }> | null {
	const blend = document.blends?.find(({ id }) => id === blendId)
	if (blend === undefined || blend.locked) return null
	const resolution = resolveDesignBlend(document, blend)
	if (resolution.status !== "ready") return null
	const swatchIds = new Map<string, string>()
	const swatches: DesignSwatch[] = resolution.swatches.map((swatch) => {
		const id = `swatch:${nextId()}`
		swatchIds.set(swatch.id, id)
		return { ...swatch, id, name: `${blend.name} expanded ${swatch.name}` }
	})
	const objects = resolution.objects.map((object) =>
		freshExpandedObject(object, nextId, swatchIds),
	)
	const startIndex = document.objects.findIndex(
		({ id }) => id === blend.startObjectId,
	)
	const endIndex = document.objects.findIndex(
		({ id }) => id === blend.endObjectId,
	)
	if (startIndex < 0 || endIndex < 0) return null
	const insertionIndex = Math.max(startIndex, endIndex)
	const laterEndpointId = document.objects[insertionIndex]!.id
	const sceneInsertions = objects.map(({ id }): DesignSceneChild => ({
		kind: "object",
		id,
	}))
	return {
		document: {
			...document,
			swatches: [...document.swatches, ...swatches],
			objects: [
				...document.objects.slice(0, insertionIndex),
				...objects,
				...document.objects.slice(insertionIndex),
			],
			blends: document.blends!.filter(({ id }) => id !== blendId),
			layers: document.layers.map((layer) => ({
				...layer,
				children: insertSceneChildrenBefore(
					layer.children,
					laterEndpointId,
					sceneInsertions,
				),
			})),
			groups: document.groups.map((group) => ({
				...group,
				children: insertSceneChildrenBefore(
					group.children,
					laterEndpointId,
					sceneInsertions,
				),
			})),
		},
		selection: objects.map(({ id }) => id),
	}
}
