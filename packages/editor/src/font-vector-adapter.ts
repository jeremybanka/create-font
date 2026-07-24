import type {
	ContourId,
	GlyphId,
	MasterId,
	PasteContoursInput,
	PointId,
} from "@create-font/states"

import type {
	EditorCanvasContour,
	EditorCanvasLayer,
	EditorWorkspace,
} from "./editor-workspace.ts"
import type { EditorSelectionTarget } from "./outline-selection.ts"
import type { OutlineClipboardPayload } from "./outline-clipboard.ts"
import {
	validateVectorObject,
	type VectorClipboardPayload,
	type VectorDocumentAdapter,
	type VectorEditIntent,
	type VectorObject,
	type VectorSelectionTarget,
	type VectorSnapshot,
} from "./vector-editing.ts"

export interface FontVectorContext {
	readonly glyphId: GlyphId
	readonly masterId: MasterId
}

export function fontOutlineClipboardFromVector(
	payload: VectorClipboardPayload,
	masterId: MasterId,
): OutlineClipboardPayload {
	const contours: OutlineClipboardPayload["contours"][number][] = []
	const points: OutlineClipboardPayload["layers"][number]["points"][number][] =
		[]
	for (const [objectIndex, object] of payload.objects.entries()) {
		for (const [contourIndex, contour] of object.contours.entries()) {
			const contourPoints = contour.nodes.map((node, pointIndex) => {
				const key = `${objectIndex}/${contourIndex}/${pointIndex}`
				points.push({
					key,
					x: node.x,
					y: node.y,
					...(node.incoming === undefined ? {} : { incoming: node.incoming }),
					...(node.outgoing === undefined ? {} : { outgoing: node.outgoing }),
				})
				return { key, mode: node.mode }
			})
			if (contourPoints.length > 0)
				contours.push({ closed: contour.closed, points: contourPoints })
		}
	}
	return {
		format: "create-font.outline",
		version: 1,
		sourceApplication: "create-design",
		masterIds: [masterId],
		contours,
		layers: [{ masterId, points }],
	}
}

export interface FontVectorAdapter {
	readonly project: (
		layer: EditorCanvasLayer,
		selection: readonly EditorSelectionTarget[],
	) => VectorSnapshot
	readonly apply: (intent: VectorEditIntent) => FontVectorEditResult
	readonly clipboard: (
		layer: EditorCanvasLayer,
		selection: readonly EditorSelectionTarget[],
	) => VectorClipboardPayload
	readonly paste: (input: PasteContoursInput) => FontVectorEditResult
}

function projectAppliedFontIntent(
	layer: EditorCanvasLayer,
	intent: VectorEditIntent,
): EditorCanvasLayer {
	if (intent.kind === "transform-controls") {
		const points = new Map(intent.points.map((point) => [point.pointId, point]))
		const handles = new Map(
			intent.handles.map((handle) => [
				`${handle.pointId}/${handle.handle}`,
				handle,
			]),
		)
		return {
			...layer,
			contours: layer.contours.map((contour) => ({
				...contour,
				nodes: contour.nodes.map((node) => {
					const point = points.get(node.pointId)
					const incoming = handles.get(`${node.pointId}/incoming`)
					const outgoing = handles.get(`${node.pointId}/outgoing`)
					return {
						...node,
						...(point === undefined ? {} : { x: point.x, y: point.y }),
						...(incoming === undefined
							? {}
							: {
									incoming: {
										x: incoming.x - (point?.x ?? node.x),
										y: incoming.y - (point?.y ?? node.y),
									},
								}),
						...(outgoing === undefined
							? {}
							: {
									outgoing: {
										x: outgoing.x - (point?.x ?? node.x),
										y: outgoing.y - (point?.y ?? node.y),
									},
								}),
					}
				}),
			})),
		}
	}
	if (intent.kind === "delete" && intent.controls !== undefined) {
		const pointIds = new Set(
			intent.controls.flatMap((target) =>
				target.kind === "node" ? [target.pointId] : [],
			),
		)
		return {
			...layer,
			contours: layer.contours.flatMap((contour) => {
				const nodes = contour.nodes.filter(
					(node) => !pointIds.has(node.pointId),
				)
				return nodes.length === 0 ? [] : [{ ...contour, nodes }]
			}),
		}
	}
	if (intent.kind === "create-contour") {
		return {
			...layer,
			contours: [
				...layer.contours,
				{
					id: intent.contour.id as ContourId,
					closed: intent.contour.closed,
					nodes: intent.contour.nodes.map((node) => ({
						pointId: node.id as PointId,
						mode: node.mode,
						x: node.x,
						y: node.y,
						...(node.incoming === undefined ? {} : { incoming: node.incoming }),
						...(node.outgoing === undefined ? {} : { outgoing: node.outgoing }),
					})),
				},
			],
		}
	}
	return layer
}

export function createFontVectorDocumentAdapter(
	workspace: EditorWorkspace,
	context: FontVectorContext,
): VectorDocumentAdapter<EditorCanvasLayer, readonly EditorSelectionTarget[]> {
	return {
		project: projectFontVectorSnapshot,
		clipboard: projectFontVectorClipboard,
		apply(layer, selection, intent) {
			const result = applyFontVectorIntent(workspace, context, intent)
			if (!result.ok) return result
			return {
				ok: true,
				document: projectAppliedFontIntent(layer, intent),
				selection: intent.kind === "delete" ? Object.freeze([]) : selection,
			}
		},
	}
}

export function createFontVectorAdapter(
	workspace: EditorWorkspace,
	context: FontVectorContext,
): FontVectorAdapter {
	const documentAdapter = createFontVectorDocumentAdapter(workspace, context)
	return {
		project: documentAdapter.project,
		apply: (intent) => applyFontVectorIntent(workspace, context, intent),
		clipboard: documentAdapter.clipboard,
		paste(input) {
			try {
				workspace.font.actions.pasteContours(input)
				return { ok: true }
			} catch (error) {
				return {
					ok: false,
					error:
						error instanceof Error
							? error.message
							: "The font vector paste was rejected.",
				}
			}
		},
	}
}

function projectFontLayerVectorObject(layer: EditorCanvasLayer): VectorObject {
	return projectFontContoursVectorObject(layer.glyphId, layer.contours)
}

function projectFontContoursVectorObject(
	glyphId: string,
	contours: readonly EditorCanvasContour[],
): VectorObject {
	return {
		id: glyphId,
		name: glyphId,
		style: { kind: "neutral" },
		contours: contours.map((contour) => ({
			id: contour.id,
			closed: contour.closed,
			nodes: contour.nodes.map((node) => ({
				id: node.pointId,
				mode: node.mode,
				x: node.x,
				y: node.y,
				...(node.incoming === undefined
					? {}
					: { incoming: { ...node.incoming } }),
				...(node.outgoing === undefined
					? {}
					: { outgoing: { ...node.outgoing } }),
			})),
		})),
	}
}

function projectFontVectorSelection(
	object: VectorObject,
	selection: readonly EditorSelectionTarget[],
): readonly VectorSelectionTarget[] {
	const contourByPoint = new Map(
		object.contours.flatMap((contour) =>
			contour.nodes.map((node) => [node.id, contour.id] as const),
		),
	)
	return selection.flatMap((target): readonly VectorSelectionTarget[] => {
		const contourId = contourByPoint.get(target.pointId)
		if (contourId === undefined) return []
		return target.kind === "node"
			? [
					{
						kind: "node",
						objectId: object.id,
						contourId,
						pointId: target.pointId,
					},
				]
			: [
					{
						kind: "handle",
						objectId: object.id,
						contourId,
						pointId: target.pointId,
						handle: target.handle,
					},
				]
	})
}

function projectFontVectorSnapshot(
	layer: EditorCanvasLayer,
	selection: readonly EditorSelectionTarget[],
	revision = `${layer.masterId}/${layer.glyphId}`,
): VectorSnapshot {
	const object = projectFontLayerVectorObject(layer)
	return {
		revision,
		objects: [object],
		selection: projectFontVectorSelection(object, selection),
	}
}

function projectFontVectorClipboard(
	layer: EditorCanvasLayer,
	selection: readonly EditorSelectionTarget[],
): VectorClipboardPayload {
	const object = projectFontLayerVectorObject(layer)
	const selectedPointIds = new Set<string>(
		selection.map((target) => target.pointId),
	)
	return {
		format: "create-vector.selection",
		version: 1,
		objects: [
			{
				...object,
				contours: object.contours.flatMap((contour) => {
					const nodes = contour.nodes.filter((node) =>
						selectedPointIds.has(node.id),
					)
					return nodes.length === 0
						? []
						: [
								{
									...contour,
									closed:
										contour.closed && nodes.length === contour.nodes.length,
									nodes,
								},
							]
				}),
			},
		],
	}
}

export type FontVectorEditResult =
	| Readonly<{ readonly ok: true }>
	| Readonly<{ readonly ok: false; readonly error: string }>

function applyFontVectorIntent(
	workspace: EditorWorkspace,
	context: FontVectorContext,
	intent: VectorEditIntent,
): FontVectorEditResult {
	try {
		if (intent.kind === "transform-controls") {
			workspace.font.actions.transformControls({
				glyphId: context.glyphId,
				masterId: context.masterId,
				points: intent.points.map((point) => ({
					...point,
					pointId: point.pointId as PointId,
				})),
				handles: intent.handles.map((handle) => ({
					...handle,
					pointId: handle.pointId as PointId,
				})),
			})
			return { ok: true }
		}
		if (intent.kind === "create-contour") {
			if (intent.objectId !== context.glyphId)
				return {
					ok: false,
					error: `The contour does not belong to glyph ${context.glyphId}.`,
				}
			if (intent.contour.nodes.length === 0)
				return { ok: false, error: "A contour requires at least one point." }
			const variants = intent.variants ?? [
				{
					variantId: context.masterId,
					nodes: intent.contour.nodes.map((node) => ({
						...node,
						variantId: context.masterId,
					})),
				},
			]
			if (intent.contour.nodes.length === 1 && !intent.contour.closed) {
				const point = intent.contour.nodes[0]!
				workspace.font.actions.createContour({
					masterId: context.masterId,
					glyphId: context.glyphId,
					contourId: intent.contour.id as ContourId,
					point: { id: point.id as PointId, mode: point.mode },
					coordinates: variants.map((variant) => {
						const node = variant.nodes.find(
							(candidate) => candidate.id === point.id,
						)
						if (node === undefined)
							throw new TypeError(
								`Variant ${variant.variantId} is missing point ${point.id}.`,
							)
						return {
							masterId: variant.variantId as MasterId,
							x: node.x,
							y: node.y,
							...(node.incoming === undefined
								? {}
								: { incoming: node.incoming }),
							...(node.outgoing === undefined
								? {}
								: { outgoing: node.outgoing }),
						}
					}),
				})
			} else {
				workspace.font.actions.createCompleteContour({
					masterId: context.masterId,
					glyphId: context.glyphId,
					contour: {
						id: intent.contour.id as ContourId,
						closed: intent.contour.closed,
						points: intent.contour.nodes.map((node) => ({
							id: node.id as PointId,
							mode: node.mode,
						})),
					},
					layers: variants.map((variant) => ({
						masterId: variant.variantId as MasterId,
						points: variant.nodes.map((node) => ({
							pointId: node.id as PointId,
							x: node.x,
							y: node.y,
							...(node.incoming === undefined
								? {}
								: { incoming: node.incoming }),
							...(node.outgoing === undefined
								? {}
								: { outgoing: node.outgoing }),
						})),
					})),
				})
			}
			return { ok: true }
		}
		if (intent.kind === "insert-node") {
			if (intent.objectId !== context.glyphId)
				return {
					ok: false,
					error: `The point does not belong to glyph ${context.glyphId}.`,
				}
			const variants = intent.variants ?? [
				{ ...intent.node, variantId: context.masterId },
			]
			workspace.font.actions.insertPoint({
				masterId: context.masterId,
				glyphId: context.glyphId,
				contourId: intent.contourId as ContourId,
				...(intent.at === undefined ? {} : { at: intent.at }),
				point: {
					id: intent.node.id as PointId,
					mode: intent.node.mode,
				},
				coordinates: variants.map((node) => ({
					masterId: node.variantId as MasterId,
					x: node.x,
					y: node.y,
					...(node.incoming === undefined ? {} : { incoming: node.incoming }),
					...(node.outgoing === undefined ? {} : { outgoing: node.outgoing }),
				})),
			})
			return { ok: true }
		}
		if (intent.kind === "author-endpoint") {
			if (intent.objectId !== context.glyphId)
				return {
					ok: false,
					error: `The endpoint does not belong to glyph ${context.glyphId}.`,
				}
			workspace.font.actions.authorPenEndpoint({
				masterId: context.masterId,
				glyphId: context.glyphId,
				contourId: intent.contourId as ContourId,
				pointId: intent.pointId as PointId,
				forwardHandle: intent.forwardHandle,
				mode: intent.mode,
				coordinates: intent.variants.map((variant) => ({
					masterId: variant.variantId as MasterId,
					forward: variant.forward,
				})),
			})
			return { ok: true }
		}
		if (intent.kind === "close-contour") {
			if (intent.objectId !== context.glyphId)
				return {
					ok: false,
					error: `The contour does not belong to glyph ${context.glyphId}.`,
				}
			workspace.font.actions.closeContour({
				masterId: context.masterId,
				glyphId: context.glyphId,
				contourId: intent.contourId as ContourId,
				...(intent.endpoint === undefined
					? {}
					: {
							[intent.endpoint.side === "first" ? "firstPoint" : "lastPoint"]: {
								pointId: intent.endpoint.pointId as PointId,
								mode: "soft",
								coordinates: intent.endpoint.variants.map((variant) => ({
									masterId: variant.variantId as MasterId,
									incoming: variant.incoming,
									outgoing: variant.outgoing,
								})),
							},
						}),
			})
			return { ok: true }
		}
		if (intent.kind === "move-handle") {
			if (intent.objectId !== context.glyphId)
				return {
					ok: false,
					error: `The handle does not belong to glyph ${context.glyphId}.`,
				}
			workspace.font.actions.moveHandle({
				masterId: context.masterId,
				glyphId: context.glyphId,
				pointId: intent.pointId as PointId,
				handle: intent.handle,
				vector: intent.vector,
			})
			return { ok: true }
		}
		if (intent.kind === "slide-node") {
			if (intent.objectId !== context.glyphId)
				return {
					ok: false,
					error: `The node does not belong to glyph ${context.glyphId}.`,
				}
			workspace.font.actions.slideSoftNode({
				masterId: context.masterId,
				glyphId: context.glyphId,
				pointId: intent.pointId as PointId,
				x: intent.x,
				y: intent.y,
				handles: intent.handles,
				...(intent.unboundedDirection === undefined
					? {}
					: { unboundedDirection: intent.unboundedDirection }),
			})
			return { ok: true }
		}
		if (intent.kind === "join-contours") {
			if (intent.objectId !== context.glyphId)
				return {
					ok: false,
					error: `The contours do not belong to glyph ${context.glyphId}.`,
				}
			workspace.font.actions.joinOpenContours({
				masterId: context.masterId,
				glyphId: context.glyphId,
				draggedContourId: intent.draggedContourId as ContourId,
				draggedPointId: intent.draggedPointId as PointId,
				targetContourId: intent.targetContourId as ContourId,
				targetPointId: intent.targetPointId as PointId,
				...(intent.transform === undefined
					? {}
					: {
							transform: {
								masterId: context.masterId,
								glyphId: context.glyphId,
								points: intent.transform.points.map((point) => ({
									...point,
									pointId: point.pointId as PointId,
								})),
								handles: intent.transform.handles.map((handle) => ({
									...handle,
									pointId: handle.pointId as PointId,
								})),
							},
						}),
			})
			return { ok: true }
		}
		if (intent.kind === "delete" && intent.controls !== undefined) {
			workspace.font.actions.deleteSelection({
				glyphId: context.glyphId,
				masterId: context.masterId,
				pointIds: intent.controls.flatMap((target) =>
					target.kind === "node" ? [target.pointId as PointId] : [],
				),
				handles: intent.controls.flatMap((target) =>
					target.kind === "handle"
						? [
								{
									pointId: target.pointId as PointId,
									handle: target.handle,
								},
							]
						: [],
				),
				breakPaths: intent.deletePolicy === "break-paths",
			})
			return { ok: true }
		}
		if (intent.kind === "create-object" || intent.kind === "replace-object") {
			const error = validateVectorObject(intent.object)
			return {
				ok: false,
				error:
					error ??
					"Whole-object replacement is not supported by font layer history.",
			}
		}
		return {
			ok: false,
			error: `The font layer does not support ${intent.kind} through the vector adapter.`,
		}
	} catch (error) {
		return {
			ok: false,
			error:
				error instanceof Error
					? error.message
					: "The font vector edit was rejected.",
		}
	}
}
