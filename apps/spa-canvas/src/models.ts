import { boundsOfPoints } from "@create-art/vector-geometry"
import {
	IDENTITY_DESIGN_TRANSFORM,
	projectDesignObjectContours,
	projectDesignOutput,
	swatchCss,
} from "@create-design/model"
import type { DesignDocument, DesignObject } from "@create-design/source"
import {
	createFontEditorState,
	type EditorFontSource,
	type GlyphId,
	type MasterId,
	type PointId,
} from "@create-font/states"
import type {
	ReadableToken,
	Silo,
	TimelineManageable,
	TimelineToken,
} from "atom.io"

import { createDesignEditorState } from "../../../packages/create-design/editor/src/design-editor-state.ts"
import { createDesignPersistenceState } from "../../../packages/create-design/editor/src/persistence.ts"
import type {
	VectorHandleKind,
	VectorObject,
	VectorPoint,
} from "../../../packages/create-art/editor/src/vector-editing.ts"
import type { VectorBounds } from "../../../packages/create-art/editor/src/vector-scene.ts"

export interface CanvasObject {
	readonly vector: VectorObject
	readonly fill?: string
	readonly stroke?: string
	readonly strokeWidth: number
	readonly lineCap?: "butt" | "round" | "square"
	readonly lineJoin?: "miter" | "round" | "bevel"
}

interface CanvasScene {
	readonly objects: readonly CanvasObject[]
	readonly bounds: VectorBounds
	readonly label: string
}

interface CanvasChoice {
	readonly id: string
	readonly name: string
}

/** The prototype binds directly to the existing editor stores and transactions. */
export interface CanvasModel {
	readonly kind: "font" | "design"
	readonly title: string
	readonly description: string
	readonly yDirection: 1 | -1
	readonly silo: Silo
	readonly scene: ReadableToken<CanvasScene>
	readonly choices: readonly CanvasChoice[]
	readonly choice: ReadableToken<string>
	readonly masters: readonly CanvasChoice[]
	readonly master: ReadableToken<string>
	choose(id: string): void
	chooseMaster(id: string): void
	getTimeline(): TimelineToken<TimelineManageable>
	moveObject(id: string, delta: VectorPoint): void
	moveNode(
		id: string,
		pointId: string,
		position: VectorPoint,
		handle?: VectorHandleKind,
	): void
	reset(): void
}

const fallbackBounds = { minX: 0, minY: 0, maxX: 100, maxY: 100 }

function sceneBounds(objects: readonly CanvasObject[]): VectorBounds {
	return (
		boundsOfPoints(
			objects.flatMap(({ vector }) =>
				vector.contours.flatMap(({ nodes }) =>
					nodes.flatMap((node) => [
						node,
						...(node.incoming === undefined
							? []
							: [{ x: node.x + node.incoming.x, y: node.y + node.incoming.y }]),
						...(node.outgoing === undefined
							? []
							: [{ x: node.x + node.outgoing.x, y: node.y + node.outgoing.y }]),
					]),
				),
			),
		) ?? fallbackBounds
	)
}

export function createFontCanvasModel(source: EditorFontSource): CanvasModel {
	const font = createFontEditorState({ key: "spa-canvas/font" })
	font.actions.load(source)
	const { silo } = font
	const initialGlyph =
		source.glyphs.find(({ id }) => id === "glyph:O") ?? source.glyphs[0]
	if (initialGlyph === undefined)
		throw new Error("The font prototype needs a glyph.")
	const choice = silo.atom<GlyphId>({
		key: "prototype/glyph",
		default: initialGlyph.id,
	})
	const master = silo.atom<MasterId>({
		key: "prototype/master",
		default: source.defaultMasterId,
	})
	const currentLayer = () =>
		font.read
			.editorGlyphSource(silo.getState(choice))
			?.layers.find(({ masterId }) => masterId === silo.getState(master))
	const scene = silo.selector<CanvasScene>({
		key: "prototype/scene",
		get: ({ get }) => {
			const glyph = get(font.selectors.editorGlyphSource, get(choice))
			const layer = glyph?.layers.find(
				({ masterId }) => masterId === get(master),
			)
			const objects: CanvasObject[] =
				layer === undefined
					? []
					: [
							{
								vector: {
									id: get(choice),
									name: glyph?.name ?? get(choice),
									style: { kind: "neutral" },
									contours: layer.contours.map((contour) => ({
										id: contour.id,
										closed: contour.closed,
										nodes: contour.points,
									})),
								},
								fill: "#242720",
								strokeWidth: 0,
							},
						]
			return {
				objects,
				bounds: sceneBounds(objects),
				label: glyph?.name ?? "Empty glyph",
			}
		},
	})
	return {
		kind: "font",
		title: "create-font",
		description: "Workbench Sans · authored master outlines",
		yDirection: -1,
		silo,
		scene,
		choice,
		master,
		choices: source.glyphs.map(({ id, name }) => ({ id, name })),
		masters: source.masters.map(({ id, name }) => ({ id, name })),
		choose(id) {
			const glyph = source.glyphs.find((glyph) => glyph.id === id)
			if (glyph !== undefined) silo.setState(choice, glyph.id)
		},
		chooseMaster(id) {
			const selected = source.masters.find((entry) => entry.id === id)
			if (selected !== undefined) silo.setState(master, selected.id)
		},
		getTimeline: () =>
			silo.findTimeline(font.glyphHistoryTimelines, silo.getState(choice)),
		moveObject(id, delta) {
			if (id !== silo.getState(choice)) return
			font.actions.transformControls({
				masterId: silo.getState(master),
				glyphId: silo.getState(choice),
				points:
					currentLayer()?.contours.flatMap(({ points }) =>
						points.map((point) => ({
							pointId: point.id,
							x: Math.round(point.x + delta.x),
							y: Math.round(point.y + delta.y),
						})),
					) ?? [],
				handles: [],
			})
		},
		moveNode(id, pointId, position, handle) {
			if (id !== silo.getState(choice)) return
			const point = currentLayer()
				?.contours.flatMap(({ points }) => points)
				.find(({ id }) => id === pointId)
			if (point === undefined) return
			const context = {
				masterId: silo.getState(master),
				glyphId: silo.getState(choice),
				pointId: pointId as PointId,
			}
			if (handle === undefined)
				font.actions.transformControls({
					...context,
					points: [
						{
							pointId: point.id,
							x: Math.round(position.x),
							y: Math.round(position.y),
						},
					],
					handles: [],
				})
			else
				font.actions.moveHandle({
					...context,
					handle,
					vector: {
						x: Math.round(position.x - point.x),
						y: Math.round(position.y - point.y),
					},
				})
		},
		reset() {
			font.actions.load(source)
		},
	}
}

function designVector(object: DesignObject): VectorObject {
	return {
		id: object.id,
		name: object.name,
		style: { kind: "neutral" },
		locked: object.locked ?? false,
		contours: projectDesignObjectContours(object).map((contour) => ({
			id: contour.id,
			closed: contour.closed,
			nodes: contour.points.map((point) => ({
				...point,
				mode: point.mode ?? "hard",
			})),
		})),
	}
}

export function createDesignCanvasModel(document: DesignDocument): CanvasModel {
	const state = createDesignEditorState({
		document,
		name: "spa-canvas/design",
		persistence: createDesignPersistenceState(null),
	})
	const { silo } = state
	const choice = silo.atom<string>({ key: "prototype/choice", default: "logo" })
	const master = silo.atom<string>({ key: "prototype/master", default: "" })
	const scene = silo.selector<CanvasScene>({
		key: "prototype/scene",
		get: ({ get }) => {
			const current = get(state.states.documentSelector)
			const swatches = new Map(
				current.swatches.map((swatch) => [swatch.id, swatchCss(swatch)]),
			)
			const objects = projectDesignOutput(current)
				.objects.filter(({ geometry }) =>
					["path", "rectangle", "ellipse"].includes(geometry.kind),
				)
				.map((object): CanvasObject => ({
					vector: designVector(object),
					...(object.appearance.fill === undefined
						? {}
						: {
								fill:
									swatches.get(object.appearance.fill.swatchId) ?? "#242720",
							}),
					...(object.appearance.stroke === undefined
						? {}
						: {
								stroke:
									swatches.get(object.appearance.stroke.swatchId) ?? "#242720",
								lineCap: object.appearance.stroke.cap,
								lineJoin: object.appearance.stroke.join,
							}),
					strokeWidth: object.appearance.stroke?.width ?? 0,
				}))
			return { objects, bounds: sceneBounds(objects), label: current.title }
		},
	})
	const updateObject = (
		id: string,
		update: (object: DesignObject) => DesignObject,
	): void => {
		const current = silo.getState(state.states.documentSelector)
		const object = current.objects.find((entry) => entry.id === id)
		if (object === undefined || designVector(object).locked) return
		state.actions.commitDocument({
			...current,
			objects: current.objects.map((entry) =>
				entry.id === id ? update(entry) : entry,
			),
		})
	}
	return {
		kind: "design",
		title: "create-design",
		description: "Create Design logo · source primitives and Béziers",
		yDirection: 1,
		silo,
		scene,
		choice,
		master,
		choices: [],
		masters: [],
		choose() {},
		chooseMaster() {},
		getTimeline: () => state.documentTimeline,
		moveObject: (id, delta) =>
			updateObject(id, (object) => ({
				...object,
				transform: {
					...object.transform,
					e: object.transform.e + delta.x,
					f: object.transform.f + delta.y,
				},
			})),
		moveNode: (id, pointId, position, handle) =>
			updateObject(id, (object) => ({
				...object,
				transform: IDENTITY_DESIGN_TRANSFORM,
				geometry: {
					kind: "path",
					contours: projectDesignObjectContours(object).map((contour) => ({
						...contour,
						points: contour.points.map((point) =>
							point.id !== pointId
								? point
								: {
										...point,
										...(handle === undefined
											? position
											: {
													[handle]: {
														x: position.x - point.x,
														y: position.y - point.y,
													},
												}),
									},
						),
					})),
				},
			})),
		reset() {
			state.actions.resetDocument(document)
		},
	}
}
