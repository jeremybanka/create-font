import {
	validateVectorObject,
	vectorClipboardPayload,
	type VectorDocumentAdapter,
	type VectorEditIntent,
	type VectorClipboardPayload,
	type VectorObject,
	type VectorSnapshot,
	type VectorStyle,
} from "@create-art/editor"

import { swatchCss } from "@create-design/model"
import {
	documentToInterchangePoint,
	documentToInterchangeVector,
	interchangeToDocumentPoint,
	interchangeToDocumentVector,
} from "@create-design/model"
import {
	IDENTITY_DESIGN_TRANSFORM,
	projectDesignObjectContours,
} from "@create-design/model"
import {
	appendDesignHierarchyObjects,
	removeDesignHierarchyObjects,
} from "./design-hierarchy.ts"
import type {
	DesignContour,
	DesignDocument,
	DesignObject,
	DesignSwatch,
} from "./types.ts"

export type DesignVectorSelection = readonly string[]

const documentRevision = (document: DesignDocument): string =>
	[
		document.version,
		document.objects.length,
		document.swatches.length,
		document.objects.map((object) => object.id).join(","),
	].join(":")

function swatchStyle(swatch: DesignSwatch | undefined): VectorStyle {
	return swatch === undefined
		? { kind: "neutral" }
		: {
				kind: "fill",
				swatchId: swatch.id,
				resolvedCss: swatchCss(swatch),
				source: swatch.source,
				...(swatch.alternate === undefined
					? {}
					: { alternate: swatch.alternate }),
			}
}

export function projectDesignVectorObject(
	document: Pick<DesignDocument, "swatches">,
	object: DesignObject,
): VectorObject {
	return {
		id: object.id,
		name: object.name,
		...(object.hidden === undefined ? {} : { hidden: object.hidden }),
		...(object.locked === undefined ? {} : { locked: object.locked }),
		style: swatchStyle(
			document.swatches.find(
				(swatch) => swatch.id === object.appearance.fill?.swatchId,
			),
		),
		contours: projectDesignObjectContours(object).map((contour) => ({
			id: contour.id,
			closed: contour.closed,
			nodes: contour.points.map((point) => ({
				id: point.id,
				mode:
					point.incoming === undefined && point.outgoing === undefined
						? "hard"
						: "soft",
				x: point.x,
				y: point.y,
				...(point.incoming === undefined
					? {}
					: { incoming: { ...point.incoming } }),
				...(point.outgoing === undefined
					? {}
					: { outgoing: { ...point.outgoing } }),
			})),
		})),
	}
}

function projectDesignVectorSnapshot(
	document: DesignDocument,
	selection: DesignVectorSelection,
): VectorSnapshot {
	return {
		revision: documentRevision(document),
		objects: document.objects.map((object) =>
			projectDesignVectorObject(document, object),
		),
		selection: selection.map((objectId) => ({ kind: "object", objectId })),
	}
}

function projectDesignClipboardObject(
	document: DesignDocument,
	object: DesignObject,
): VectorObject {
	const projected = projectDesignVectorObject(document, object)
	return {
		...projected,
		contours: projected.contours.map((contour) => ({
			...contour,
			nodes: contour.nodes.map((node) => ({
				...node,
				...documentToInterchangePoint(node),
				...(node.incoming === undefined
					? {}
					: {
							incoming: {
								...documentToInterchangeVector(node.incoming),
							},
						}),
				...(node.outgoing === undefined
					? {}
					: {
							outgoing: {
								...documentToInterchangeVector(node.outgoing),
							},
						}),
			})),
		})),
	}
}

const designContours = (object: VectorObject): readonly DesignContour[] =>
	object.contours.map((contour) => ({
		id: contour.id,
		closed: contour.closed,
		points: contour.nodes.map((node) => ({
			id: node.id,
			x: node.x,
			y: node.y,
			...(node.incoming === undefined
				? {}
				: { incoming: { ...node.incoming } }),
			...(node.outgoing === undefined
				? {}
				: { outgoing: { ...node.outgoing } }),
		})),
	}))

export function designObjectFromVector(
	current: DesignObject,
	object: VectorObject,
): DesignObject {
	return {
		...current,
		name: object.name,
		geometry: {
			kind: "path",
			...(current.geometry.kind === "path" &&
			current.geometry.fillRule !== undefined
				? { fillRule: current.geometry.fillRule }
				: {}),
			contours: designContours(object),
		},
		transform: IDENTITY_DESIGN_TRANSFORM,
		...(object.hidden === undefined ? {} : { hidden: object.hidden }),
		...(object.locked === undefined ? {} : { locked: object.locked }),
		appearance: setAppearanceFill(
			current.appearance,
			object.style.kind === "fill" ? object.style.swatchId : undefined,
		),
	}
}

function reject(error: string) {
	return { ok: false, error } as const
}

function appearanceFromStyle(style: VectorStyle) {
	return style.kind === "fill" ? { fill: { swatchId: style.swatchId } } : {}
}

function setAppearanceFill(
	current: DesignObject["appearance"],
	swatchId: string | undefined,
): DesignObject["appearance"] {
	const { fill: _fill, ...withoutFill } = current
	return swatchId === undefined
		? withoutFill
		: { ...withoutFill, fill: { swatchId } }
}

function replaceAt(
	document: DesignDocument,
	object: DesignObject,
): DesignDocument {
	return {
		...document,
		objects: document.objects.map((candidate) =>
			candidate.id === object.id ? object : candidate,
		),
	}
}

export const designVectorAdapter: VectorDocumentAdapter<
	DesignDocument,
	DesignVectorSelection
> = {
	project: projectDesignVectorSnapshot,
	apply(document, selection, intent) {
		if (intent.kind === "create-object") {
			const error = validateVectorObject(intent.object)
			if (error !== null) return reject(error)
			if (document.objects.some((object) => object.id === intent.object.id))
				return reject(`Object ID ${intent.object.id} is already in use.`)
			const appearance = appearanceFromStyle(intent.object.style)
			const fillId = appearance.fill?.swatchId
			if (
				fillId !== undefined &&
				!document.swatches.some((swatch) => swatch.id === fillId)
			)
				return reject(`Unknown design swatch ${fillId}.`)
			const object: DesignObject = {
				id: intent.object.id,
				name: intent.object.name,
				geometry: { kind: "path", contours: designContours(intent.object) },
				transform: IDENTITY_DESIGN_TRANSFORM,
				appearance,
				...(intent.object.hidden === undefined
					? {}
					: { hidden: intent.object.hidden }),
				...(intent.object.locked === undefined
					? {}
					: { locked: intent.object.locked }),
			}
			const next = { ...document, objects: [...document.objects, object] }
			return {
				ok: true,
				document: appendDesignHierarchyObjects(next, [object.id]),
				selection: [object.id],
			}
		}
		if (intent.kind === "replace-object") {
			const error = validateVectorObject(intent.object)
			if (error !== null) return reject(error)
			const current = document.objects.find(
				(object) => object.id === intent.object.id,
			)
			if (current === undefined)
				return reject(`Unknown design object ${intent.object.id}.`)
			if (current.locked) return reject(`Object ${current.id} is locked.`)
			const fillId =
				intent.object.style.kind === "fill"
					? intent.object.style.swatchId
					: undefined
			if (
				fillId !== undefined &&
				!document.swatches.some((swatch) => swatch.id === fillId)
			)
				return reject(`Unknown design swatch ${fillId}.`)
			return {
				ok: true,
				document: replaceAt(
					document,
					designObjectFromVector(current, intent.object),
				),
				selection,
			}
		}
		if (intent.kind === "delete") {
			const ids = new Set(intent.objectIds)
			const unknown = [...ids].find(
				(id) => !document.objects.some((object) => object.id === id),
			)
			if (unknown !== undefined)
				return reject(`Unknown design object ${unknown}.`)
			const locked = document.objects.find(
				(object) => ids.has(object.id) && object.locked,
			)
			if (locked !== undefined) return reject(`Object ${locked.id} is locked.`)
			const next = {
				...document,
				objects: document.objects.filter((object) => !ids.has(object.id)),
			}
			return {
				ok: true,
				document: removeDesignHierarchyObjects(next, ids),
				selection: selection.filter((objectId) => !ids.has(objectId)),
			}
		}
		if (intent.kind === "reorder") {
			const fromIndex = document.objects.findIndex(
				(object) => object.id === intent.objectId,
			)
			if (fromIndex < 0)
				return reject(`Unknown design object ${intent.objectId}.`)
			if (
				!Number.isInteger(intent.toIndex) ||
				intent.toIndex < 0 ||
				intent.toIndex >= document.objects.length
			)
				return reject("Design object order is outside the document.")
			const targetId = document.objects[intent.toIndex]?.id
			const layer = document.layers.find((candidate) =>
				candidate.children.some(
					(child) => child.kind === "object" && child.id === intent.objectId,
				),
			)
			if (
				layer === undefined ||
				targetId === undefined ||
				!layer.children.some(
					(child) => child.kind === "object" && child.id === targetId,
				)
			)
				return reject(
					"Use hierarchy-aware stacking commands across groups or layers.",
				)
			const children = [...layer.children]
			const childIndex = children.findIndex(
				(child) => child.kind === "object" && child.id === intent.objectId,
			)
			const targetChildIndex = children.findIndex(
				(child) => child.kind === "object" && child.id === targetId,
			)
			const [child] = children.splice(childIndex, 1)
			if (child === undefined) return reject("Design object is unavailable.")
			children.splice(targetChildIndex, 0, child)
			const objects = [...document.objects]
			const [object] = objects.splice(fromIndex, 1)
			if (object === undefined) return reject("Design object is unavailable.")
			objects.splice(intent.toIndex, 0, object)
			return {
				ok: true,
				document: {
					...document,
					objects,
					layers: document.layers.map((candidate) =>
						candidate.id === layer.id ? { ...candidate, children } : candidate,
					),
				},
				selection,
			}
		}
		if (intent.kind === "set-style") {
			const object = document.objects.find(
				(candidate) => candidate.id === intent.objectId,
			)
			if (object === undefined)
				return reject(`Unknown design object ${intent.objectId}.`)
			if (object.locked) return reject(`Object ${object.id} is locked.`)
			const fillId =
				intent.style.kind === "fill" ? intent.style.swatchId : undefined
			if (
				fillId !== undefined &&
				!document.swatches.some((swatch) => swatch.id === fillId)
			)
				return reject(`Unknown design swatch ${fillId}.`)
			return {
				ok: true,
				document: replaceAt(document, {
					...object,
					appearance: setAppearanceFill(object.appearance, fillId),
				}),
				selection,
			}
		}
		if (intent.kind === "set-object-properties") {
			const object = document.objects.find(
				(candidate) => candidate.id === intent.objectId,
			)
			if (object === undefined)
				return reject(`Unknown design object ${intent.objectId}.`)
			const updated: DesignObject = {
				...object,
				...(intent.name === undefined ? {} : { name: intent.name }),
				...(intent.hidden === undefined ? {} : { hidden: intent.hidden }),
				...(intent.locked === undefined ? {} : { locked: intent.locked }),
			}
			return {
				ok: true,
				document: replaceAt(document, updated),
				selection,
			}
		}
		if (intent.kind === "transform-controls") {
			return reject(
				"Design control transforms require an object-scoped replacement.",
			)
		}
		return reject(`The design document does not support ${intent.kind}.`)
	},
	clipboard(document, selection) {
		const snapshot = projectDesignVectorSnapshot(document, selection)
		return vectorClipboardPayload({
			...snapshot,
			objects: document.objects.map((object) =>
				projectDesignClipboardObject(document, object),
			),
		})
	},
}

export function applyDesignVectorIntent(
	document: DesignDocument,
	selection: DesignVectorSelection,
	intent: VectorEditIntent,
) {
	return designVectorAdapter.apply(document, selection, intent)
}

export function importDesignVectorClipboard(
	document: DesignDocument,
	selection: DesignVectorSelection,
	payload: VectorClipboardPayload,
	nextId: () => string,
	fallbackSwatchId: string,
) {
	let nextDocument = document
	let nextSelection = selection
	const importedIds: string[] = []
	for (const source of payload.objects) {
		let style = source.style
		if (style.kind === "neutral") {
			const fallback =
				nextDocument.swatches.find(
					(swatch) => swatch.id === fallbackSwatchId,
				) ?? nextDocument.swatches.find((swatch) => swatch.id === "swatch:ink")
			if (fallback === undefined)
				return reject("The design document has no fill swatch for this vector.")
			style = swatchStyle(fallback)
		} else {
			const fillStyle = style
			const existing = nextDocument.swatches.find(
				(swatch) => swatch.id === fillStyle.swatchId,
			)
			if (
				existing === undefined ||
				JSON.stringify(existing.source) !== JSON.stringify(fillStyle.source) ||
				JSON.stringify(existing.alternate) !==
					JSON.stringify(fillStyle.alternate)
			) {
				const swatchId =
					existing === undefined ? fillStyle.swatchId : `swatch:${nextId()}`
				const swatch: DesignSwatch = {
					id: swatchId,
					name:
						existing === undefined
							? `Imported ${source.name}`
							: `${existing.name} copy`,
					source: fillStyle.source,
					...(fillStyle.alternate === undefined
						? {}
						: { alternate: fillStyle.alternate }),
				}
				nextDocument = {
					...nextDocument,
					swatches: [...nextDocument.swatches, swatch],
				}
				style = { ...fillStyle, swatchId }
			}
		}
		const objectId = `object:${nextId()}`
		const object: VectorObject = {
			...source,
			id: objectId,
			name: `Pasted ${source.name}`,
			style,
			contours: source.contours.map((contour, contourIndex) => ({
				...contour,
				id: `${objectId}:contour:${contourIndex}`,
				nodes: contour.nodes.map((node, nodeIndex) => {
					const position = interchangeToDocumentPoint(node)
					return {
						...node,
						id: `${objectId}:contour:${contourIndex}:point:${nodeIndex}`,
						x: position.x,
						y: position.y,
						...(node.incoming === undefined
							? {}
							: {
									incoming: {
										...interchangeToDocumentVector(node.incoming),
									},
								}),
						...(node.outgoing === undefined
							? {}
							: {
									outgoing: {
										...interchangeToDocumentVector(node.outgoing),
									},
								}),
					}
				}),
			})),
		}
		const result = designVectorAdapter.apply(nextDocument, nextSelection, {
			kind: "create-object",
			object,
		})
		if (!result.ok) return result
		nextDocument = result.document
		nextSelection = result.selection
		importedIds.push(objectId)
	}
	return {
		ok: true,
		document: nextDocument,
		selection: importedIds,
	} as const
}

export function importDesignObjects(
	document: DesignDocument,
	_selection: DesignVectorSelection,
	addition: Readonly<{
		objects: readonly DesignObject[]
		swatches: readonly DesignSwatch[]
	}>,
) {
	const objectIds = new Set(document.objects.map((object) => object.id))
	const duplicateObject = addition.objects.find((object) =>
		objectIds.has(object.id),
	)
	if (duplicateObject !== undefined)
		return reject(`Object ID ${duplicateObject.id} is already in use.`)
	const swatchIds = new Set([
		...document.swatches.map((swatch) => swatch.id),
		...addition.swatches.map((swatch) => swatch.id),
	])
	const missingSwatch = addition.objects
		.flatMap((object) => [
			object.appearance.fill?.swatchId,
			object.appearance.stroke?.swatchId,
		])
		.find((swatchId) => swatchId !== undefined && !swatchIds.has(swatchId))
	if (missingSwatch !== undefined)
		return reject(`Unknown design swatch ${missingSwatch}.`)
	const importedIds = addition.objects.map((object) => object.id)
	const next = {
		...document,
		swatches: [...document.swatches, ...addition.swatches],
		objects: [...document.objects, ...addition.objects],
	}
	return {
		ok: true,
		document: appendDesignHierarchyObjects(next, importedIds),
		selection: importedIds,
	} as const
}
