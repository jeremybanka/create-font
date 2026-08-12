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
import {
	cornerProfileEligibility,
	DEFAULT_GEOMETRY_TOLERANCES,
	lowerCornerProfiles,
	type CornerContourPoint,
} from "@create-art/vector-geometry"

import {
	projectDesignEffectiveHierarchy,
	projectDesignOutput,
	swatchCss,
} from "@create-design/model"
import {
	documentToInterchangePoint,
	documentToInterchangeVector,
	interchangeToDocumentPoint,
	interchangeToDocumentVector,
} from "@create-design/model"
import {
	IDENTITY_DESIGN_TRANSFORM,
	projectDesignObjectContours,
	transformDesignPoint,
} from "@create-design/model"
import {
	appendDesignHierarchyObjects,
	isDesignHierarchyScopeValid,
	removeDesignHierarchyObjects,
	type DesignHierarchyScope,
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
		document.layers
			.map((layer) =>
				[layer.id, layer.hidden, layer.locked, layer.children.length].join(":"),
			)
			.join(","),
		document.groups
			.map((group) => [group.id, group.children.length].join(":"))
			.join(","),
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
	const contours =
		object.geometry.kind === "path"
			? object.geometry.contours.map((contour) => ({
					...contour,
					points: contour.points.map((point) =>
						transformDesignPoint(object.transform, point),
					),
				}))
			: projectDesignObjectContours(object)
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
		contours: contours.map((contour) => ({
			id: contour.id,
			closed: contour.closed,
			nodes: contour.points.map((point) => ({
				id: point.id,
				mode:
					point.mode ??
					(point.incoming === undefined && point.outgoing === undefined
						? "hard"
						: "soft"),
				x: point.x,
				y: point.y,
				...(point.incoming === undefined
					? {}
					: { incoming: { ...point.incoming } }),
				...(point.outgoing === undefined
					? {}
					: { outgoing: { ...point.outgoing } }),
				...(point.corner === undefined ? {} : { corner: { ...point.corner } }),
			})),
		})),
	}
}

/** Output-parity render projection; authored topology remains separate for controls. */
export function projectDesignVectorRenderObject(
	document: Pick<DesignDocument, "swatches">,
	object: DesignObject,
): VectorObject {
	const projected = projectDesignVectorObject(document, object)
	return {
		...projected,
		contours: projectDesignObjectContours(object).map((contour) => ({
			id: contour.id,
			closed: contour.closed,
			nodes: contour.points.map((point) => ({
				id: point.id,
				mode:
					point.mode ??
					(point.incoming === undefined && point.outgoing === undefined
						? "hard"
						: "soft"),
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
	const hierarchy = projectDesignEffectiveHierarchy(document)
	return {
		revision: documentRevision(document),
		objects: hierarchy.entries.map((entry) =>
			projectDesignVectorObject(document, {
				...entry.object,
				...(entry.visible ? {} : { hidden: true }),
				...(entry.locked ? { locked: true } : {}),
			}),
		),
		selection: selection.map((objectId) => ({ kind: "object", objectId })),
	}
}

function projectDesignClipboardObject(
	document: DesignDocument,
	object: DesignObject,
): VectorObject {
	// Clipboard geometry is baked to document space so non-uniform affine
	// transforms cannot distort a scalar live-corner amount on round-trip.
	const projected = projectDesignVectorRenderObject(document, object)
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
		points: contour.nodes.map((node) => {
			const corner =
				node.corner === undefined ||
				node.corner.profile === "sharp" ||
				node.corner.amount <= 0
					? undefined
					: {
							profile: node.corner.profile,
							amount: node.corner.amount,
						}
			return {
				id: node.id,
				...(node.mode ===
				(node.incoming === undefined && node.outgoing === undefined
					? "hard"
					: "soft")
					? {}
					: { mode: node.mode }),
				x: node.x,
				y: node.y,
				...(node.incoming === undefined
					? {}
					: { incoming: { ...node.incoming } }),
				...(node.outgoing === undefined
					? {}
					: { outgoing: { ...node.outgoing } }),
				...(corner === undefined ? {} : { corner }),
			}
		}),
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

function remainingDesignPointRuns(
	points: DesignContour["points"],
	deleted: ReadonlySet<string>,
	closed: boolean,
): readonly (readonly DesignContour["points"][number][])[] {
	const hasNextSegment = (index: number): boolean => {
		const nextIndex = index + 1
		if (!closed && nextIndex === points.length) return false
		const start = points[index]
		const end = points[nextIndex % points.length]
		return (
			start !== undefined &&
			end !== undefined &&
			!deleted.has(start.id) &&
			!deleted.has(end.id)
		)
	}
	const starts = points.flatMap((point, index) => {
		if (deleted.has(point.id)) return []
		if (!closed && index === 0) return [index]
		const previousIndex = (index + points.length - 1) % points.length
		return hasNextSegment(previousIndex) ? [] : [index]
	})
	if (starts.length === 0) {
		const remaining = points.filter((point) => !deleted.has(point.id))
		return remaining.length > 0 ? [remaining] : []
	}
	const runs: DesignContour["points"][number][][] = []
	for (const start of starts) {
		const run: DesignContour["points"][number][] = []
		let index = start
		while (true) {
			const point = points[index]
			if (point === undefined || deleted.has(point.id)) break
			run.push(point)
			if (!hasNextSegment(index)) break
			index = (index + 1) % points.length
			if (index === start) break
		}
		if (run.length > 0) runs.push(run)
	}
	return runs
}

function clearDanglingDesignHandles(
	points: readonly DesignContour["points"][number][],
): readonly DesignContour["points"][number][] {
	const lastIndex = points.length - 1
	return points.map((point, index) => {
		const { incoming, outgoing, ...source } = point
		return {
			...source,
			...(index === 0 || incoming === undefined ? {} : { incoming }),
			...(index === lastIndex || outgoing === undefined ? {} : { outgoing }),
		}
	})
}

function splitDesignContourId(
	contourId: string,
	firstPointId: string,
	occupied: Set<string>,
): string {
	const base = `${contourId}:split:${firstPointId}`
	let candidate = base
	let suffix = 2
	while (occupied.has(candidate)) candidate = `${base}:${suffix++}`
	occupied.add(candidate)
	return candidate
}

export function createDesignVectorAdapter(
	scope: DesignHierarchyScope,
): VectorDocumentAdapter<DesignDocument, DesignVectorSelection> {
	return {
		project: projectDesignVectorSnapshot,
		apply(document, selection, intent) {
			if (intent.kind === "set-corner-profile") {
				const object = document.objects.find(
					(candidate) => candidate.id === intent.objectId,
				)
				if (object === undefined)
					return reject(`Unknown design object ${intent.objectId}.`)
				if (object.locked) return reject(`Object ${object.id} is locked.`)
				if (object.geometry.kind !== "path")
					return reject("Corner profiles require authored path geometry.")
				const updates = new Map(
					intent.corners.map((item) => [
						`${item.contourId}/${item.pointId}`,
						item,
					]),
				)
				if (updates.size === 0) return reject("No corners were selected.")
				for (const update of updates.values()) {
					if (!Number.isFinite(update.amount) || update.amount < 0)
						return reject("Corner amounts must be finite and non-negative.")
					const contour = object.geometry.contours.find(
						(candidate) => candidate.id === update.contourId,
					)
					const index = contour?.points.findIndex(
						(candidate) => candidate.id === update.pointId,
					)
					if (
						contour === undefined ||
						index === undefined ||
						index < 0 ||
						!contour.closed ||
						contour.points.length < 3
					)
						return reject(
							`Point ${update.pointId} is not an eligible closed corner.`,
						)
					const point = contour.points[index]
					if (
						point === undefined ||
						(point.mode ??
							(point.incoming === undefined && point.outgoing === undefined
								? "hard"
								: "soft")) !== "hard"
					)
						return reject(`Point ${update.pointId} is not a hard corner.`)
				}
				for (const contour of object.geometry.contours) {
					const contourUpdates = contour.points.flatMap((point) => {
						const update = updates.get(`${contour.id}/${point.id}`)
						return update === undefined ? [] : [update]
					})
					if (contourUpdates.length === 0) continue
					const authored = contour.points.map((candidate) => {
						const update = updates.get(`${contour.id}/${candidate.id}`)
						const corner =
							update === undefined
								? candidate.corner
								: update.profile === "sharp" || update.amount === 0
									? undefined
									: { profile: update.profile, amount: update.amount }
						return {
							id: candidate.id,
							point: { x: candidate.x, y: candidate.y },
							...(candidate.incoming === undefined
								? {}
								: {
										incoming: {
											x: candidate.x + candidate.incoming.x,
											y: candidate.y + candidate.incoming.y,
										},
									}),
							...(candidate.outgoing === undefined
								? {}
								: {
										outgoing: {
											x: candidate.x + candidate.outgoing.x,
											y: candidate.y + candidate.outgoing.y,
										},
									}),
							...(corner === undefined ? {} : { corner }),
						} satisfies CornerContourPoint<string>
					})
					const lowered = lowerCornerProfiles({
						closed: true,
						points: authored,
					})
					for (const update of contourUpdates) {
						if (update.profile === "sharp" || update.amount === 0) continue
						const index = contour.points.findIndex(
							(candidate) => candidate.id === update.pointId,
						)
						const eligibility = cornerProfileEligibility(
							{ closed: true, points: authored },
							index,
						)
						if (!eligibility.eligible)
							return reject(
								`Point ${update.pointId} is geometrically ineligible (${eligibility.reason}).`,
							)
						const resolution = lowered.corners.find(
							(candidate) => candidate.pointId === update.pointId,
						)
						if (
							resolution === undefined ||
							resolution.appliedAmount <= DEFAULT_GEOMETRY_TOLERANCES.distance
						)
							return reject(
								`Point ${update.pointId} has no usable incident span after clamping.`,
							)
					}
				}
				return {
					ok: true,
					document: replaceAt(document, {
						...object,
						geometry: {
							...object.geometry,
							contours: object.geometry.contours.map((contour) => ({
								...contour,
								points: contour.points.map((point) => {
									const update = updates.get(`${contour.id}/${point.id}`)
									if (update === undefined) return point
									const { corner: _corner, ...sharp } = point
									return update.profile === "sharp" || update.amount === 0
										? sharp
										: {
												...point,
												corner: {
													profile: update.profile,
													amount: update.amount,
												},
											}
								}),
							})),
						},
					}),
					selection,
				}
			}
			if (intent.kind === "create-object") {
				if (!isDesignHierarchyScopeValid(document, scope))
					return reject("The active design hierarchy scope is unavailable.")
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
					document: appendDesignHierarchyObjects(next, [object.id], scope),
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
				const controls = intent.controls ?? []
				const ids = new Set([
					...intent.objectIds,
					...controls.flatMap((target) =>
						target.kind === "object" ? [target.objectId] : [],
					),
				])
				const editedIds = new Set([
					...ids,
					...controls.map((target) => target.objectId),
				])
				const unknown = [...editedIds].find(
					(id) => !document.objects.some((object) => object.id === id),
				)
				if (unknown !== undefined)
					return reject(`Unknown design object ${unknown}.`)
				const locked = document.objects.find(
					(object) => editedIds.has(object.id) && object.locked,
				)
				if (locked !== undefined)
					return reject(`Object ${locked.id} is locked.`)
				for (const control of controls) {
					if (control.kind === "object") continue
					const object = document.objects.find(
						(candidate) => candidate.id === control.objectId,
					)
					if (object?.geometry.kind !== "path")
						return reject(
							`Object ${control.objectId} has no editable path controls.`,
						)
					const contour = object.geometry.contours.find(
						(candidate) => candidate.id === control.contourId,
					)
					if (
						contour === undefined ||
						!contour.points.some((point) => point.id === control.pointId)
					)
						return reject(`Unknown design point ${control.pointId}.`)
				}
				const removedIds = new Set(ids)
				const objects = document.objects.flatMap((object) => {
					if (removedIds.has(object.id)) return []
					const objectControls = controls.flatMap((target) =>
						target.kind !== "object" && target.objectId === object.id
							? [target]
							: [],
					)
					if (objectControls.length === 0 || object.geometry.kind !== "path")
						return [object]
					const deletedPoints = new Set(
						objectControls.flatMap((target) =>
							target.kind === "node" ? [target.pointId] : [],
						),
					)
					const deletedHandles = new Set(
						objectControls.flatMap((target) =>
							target.kind === "handle"
								? [`${target.pointId}:${target.handle}`]
								: [],
						),
					)
					const occupiedContourIds = new Set(
						object.geometry.contours.map(({ id }) => id),
					)
					const contours = object.geometry.contours.flatMap((contour) => {
						const touched = objectControls.some(
							(target) => target.contourId === contour.id,
						)
						if (!touched) return [contour]
						const points = contour.points.map((point) => {
							const removeIncoming = deletedHandles.has(`${point.id}:incoming`)
							const removeOutgoing = deletedHandles.has(`${point.id}:outgoing`)
							if (!removeIncoming && !removeOutgoing) return point
							const { incoming, outgoing, ...source } = point
							return {
								...source,
								...(removeIncoming || incoming === undefined
									? {}
									: { incoming }),
								...(removeOutgoing || outgoing === undefined
									? {}
									: { outgoing }),
							}
						})
						const contourDeleted = new Set(
							points.flatMap((point) =>
								deletedPoints.has(point.id) ? [point.id] : [],
							),
						)
						if (contourDeleted.size === 0) return [{ ...contour, points }]
						const breakPaths = intent.deletePolicy === "break-paths"
						const remainingRuns = breakPaths
							? remainingDesignPointRuns(points, contourDeleted, contour.closed)
							: [points.filter((point) => !contourDeleted.has(point.id))]
						return remainingRuns.flatMap((run, runIndex) => {
							if (run.length === 0) return []
							const closed = !breakPaths && contour.closed && run.length >= 3
							const firstPoint = run[0]
							if (firstPoint === undefined) return []
							return [
								{
									...contour,
									id:
										runIndex === 0
											? contour.id
											: splitDesignContourId(
													contour.id,
													firstPoint.id,
													occupiedContourIds,
												),
									closed,
									points: closed ? run : clearDanglingDesignHandles(run),
								},
							]
						})
					})
					if (contours.length === 0) {
						removedIds.add(object.id)
						return []
					}
					return [
						{
							...object,
							geometry: { ...object.geometry, contours },
						},
					]
				})
				const next = {
					...document,
					objects,
				}
				return {
					ok: true,
					document: removeDesignHierarchyObjects(next, removedIds),
					selection: selection.filter((objectId) => !removedIds.has(objectId)),
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
							candidate.id === layer.id
								? { ...candidate, children }
								: candidate,
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
			const output = projectDesignOutput(document)
			return vectorClipboardPayload({
				revision: documentRevision(document),
				selection: selection.map((objectId) => ({
					kind: "object" as const,
					objectId,
				})),
				objects: output.objects.map((object) =>
					projectDesignClipboardObject(document, object),
				),
			})
		},
	}
}

export function applyDesignVectorIntent(
	document: DesignDocument,
	selection: DesignVectorSelection,
	intent: VectorEditIntent,
	scope: DesignHierarchyScope,
) {
	return createDesignVectorAdapter(scope).apply(document, selection, intent)
}

export function importDesignVectorClipboard(
	document: DesignDocument,
	selection: DesignVectorSelection,
	payload: VectorClipboardPayload,
	nextId: () => string,
	fallbackSwatchId: string,
	scope: DesignHierarchyScope,
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
		const result = createDesignVectorAdapter(scope).apply(
			nextDocument,
			nextSelection,
			{
				kind: "create-object",
				object,
			},
		)
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
	scope: DesignHierarchyScope,
) {
	if (!isDesignHierarchyScopeValid(document, scope))
		return reject("The active design hierarchy scope is unavailable.")
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
		document: appendDesignHierarchyObjects(next, importedIds, scope),
		selection: importedIds,
	} as const
}
