import {
	createFontEditorState,
	type AxisId,
	type ContourId,
	type EditorFontSource,
	type EditorLayerNode,
	type EditorLocationSource,
	type GlyphId,
	type InstanceId,
	type MasterId,
} from "@trigraph/states"

import { makeDemoFont } from "./demo-font.ts"
import { resolveVariableGlyph, type ResolvedGlyph } from "./geometry.ts"
import type { EditorSelectionTarget } from "./outline-selection.ts"

export interface EditorCanvasLayer {
	readonly masterId: MasterId
	readonly glyphId: GlyphId
	readonly contours: readonly EditorCanvasContour[]
	readonly advanceWidth: number
	readonly leftSideBearing: number
}

export interface EditorCanvasContour {
	readonly id: ContourId
	readonly closed: boolean
	readonly nodes: readonly EditorLayerNode[]
}

export interface PreviewRunGlyph {
	readonly kind: "glyph"
	readonly character: string
	readonly textStart: number
	readonly textEnd: number
	readonly glyphId: GlyphId
	readonly glyph: ResolvedGlyph | null
}

export interface PreviewRunLineBreak {
	readonly kind: "line-break"
	readonly textStart: number
	readonly textEnd: number
}

export type PreviewRunItem = PreviewRunGlyph | PreviewRunLineBreak
export type EditorToolId = "select" | "pen"

export function createEditorWorkspace(
	source: EditorFontSource = makeDemoFont(),
) {
	const font = createFontEditorState({ key: "trigraph/editor/geometric" })
	font.actions.load(source)
	const document = font.read.editorSource()
	if (document === null)
		throw new TypeError("The editor document did not load.")
	const firstGlyph = document.glyphs[0]?.id
	const firstMaster = document.masters[0]?.id
	if (firstGlyph === undefined || firstMaster === undefined) {
		throw new TypeError(
			"The editor requires at least one glyph and one master.",
		)
	}
	const activeGlyphIdAtom = font.silo.atom<GlyphId>({
		key: "activeGlyphId",
		default:
			document.glyphs.find((glyph) => glyph.name === "O")?.id ?? firstGlyph,
	})
	const activeMasterIdAtom = font.silo.atom<MasterId>({
		key: "activeMasterId",
		default: document.defaultMasterId,
	})
	const selectionAtom = font.silo.atom<readonly EditorSelectionTarget[]>({
		key: "selection",
		default: Object.freeze([]),
	})
	const previewTextAtom = font.silo.atom<string>({
		key: "previewText",
		default: "AOOO\nAOOO",
	})
	const caretIndexAtom = font.silo.atom<number>({
		key: "caretIndex",
		default: 0,
	})
	const editingTextIndexAtom = font.silo.atom<number | null>({
		key: "editingTextIndex",
		default: null,
	})
	const activeToolAtom = font.silo.atom<EditorToolId>({
		key: "activeTool",
		default: "select",
	})
	const previewCoordinateAtoms = font.silo.atomFamily<number | null, AxisId>({
		key: "previewCoordinate",
		default: null,
	})
	const showNodesAtom = font.silo.atom<boolean>({
		key: "showNodes",
		default: true,
	})
	for (const axis of document.axes) {
		font.silo.setState(previewCoordinateAtoms, axis.id, axis.default)
	}
	const previewLocationSelector = font.silo.selector<
		Readonly<Record<string, number>>
	>({
		key: "previewLocation",
		get: ({ get }) =>
			Object.freeze(
				Object.fromEntries(
					document.axes.map((axis) => [
						axis.id,
						get(previewCoordinateAtoms, axis.id) ?? axis.default,
					]),
				),
			),
	})

	const activeLayerSelector = font.silo.selector<EditorCanvasLayer | null>({
		key: "activeLayer",
		get: ({ get }) => {
			const masterId = get(activeMasterIdAtom)
			const glyphId = get(activeGlyphIdAtom)
			const contourIds = get(font.atoms.glyphContourIds, glyphId)
			const advanceWidth = get(font.atoms.advanceWidth, [masterId, glyphId])
			const leftSideBearing = get(font.atoms.leftSideBearing, [
				masterId,
				glyphId,
			])
			if (
				contourIds === null ||
				advanceWidth === null ||
				leftSideBearing === null
			) {
				return null
			}
			const contours: EditorCanvasContour[] = []
			for (const contourId of contourIds) {
				const pointIds = get(font.atoms.contourPointIds, [glyphId, contourId])
				const closed = get(font.atoms.contourClosed, [glyphId, contourId])
				if (pointIds === null || closed === null) return null
				const contour: EditorLayerNode[] = []
				for (const pointId of pointIds) {
					const node = get(font.selectors.layerNode, [
						masterId,
						glyphId,
						pointId,
					])
					if (!node.ok) return null
					contour.push(node.value)
				}
				contours.push(
					Object.freeze({
						id: contourId,
						closed,
						nodes: Object.freeze(contour),
					}),
				)
			}
			return Object.freeze({
				masterId,
				glyphId,
				contours: Object.freeze(contours),
				advanceWidth,
				leftSideBearing,
			})
		},
	})
	const previewRunSelector = font.silo.selector<readonly PreviewRunItem[]>({
		key: "previewRun",
		get: ({ get }) => {
			const location = get(previewLocationSelector)
			const byCodePoint = new Map(
				get(font.atoms.cmapCodePoints).flatMap((codePoint) => {
					const glyphId = get(font.atoms.cmapGlyph, codePoint)
					return glyphId === null ? [] : [[codePoint, glyphId] as const]
				}),
			)
			const glyphIds = get(font.atoms.glyphIds)
			const fallback = glyphIds.find(
				(glyphId) => get(font.atoms.glyph, glyphId)?.name === ".notdef",
			)
			const firstExported = glyphIds.find(
				(glyphId) => get(font.atoms.glyph, glyphId)?.export,
			)
			const fallbackId = fallback ?? firstExported
			if (fallbackId === undefined) return []
			const run: PreviewRunItem[] = []
			let textOffset = 0
			for (const character of get(previewTextAtom)) {
				const textStart = textOffset
				textOffset += character.length
				if (character === "\n") {
					run.push({ kind: "line-break", textStart, textEnd: textOffset })
					continue
				}
				const codePoint = character.codePointAt(0)
				const glyphId =
					codePoint === undefined
						? fallbackId
						: (byCodePoint.get(codePoint) ?? fallbackId)
				const result = get(font.selectors.glyphSource, glyphId)
				run.push({
					kind: "glyph",
					character,
					textStart,
					textEnd: textOffset,
					glyphId,
					glyph: result.ok
						? resolveVariableGlyph(
								glyphId,
								result.value,
								document.axes,
								location,
							)
						: null,
				})
			}
			return Object.freeze(run)
		},
	})

	const setLocation = (location: EditorLocationSource): void => {
		for (const axis of document.axes) {
			font.silo.setState(
				previewCoordinateAtoms,
				axis.id,
				location[axis.id] ?? axis.default,
			)
		}
	}

	return {
		font,
		document,
		ui: {
			activeGlyphId: activeGlyphIdAtom,
			activeMasterId: activeMasterIdAtom,
			selection: selectionAtom,
			previewText: previewTextAtom,
			caretIndex: caretIndexAtom,
			editingTextIndex: editingTextIndexAtom,
			activeTool: activeToolAtom,
			previewCoordinate: previewCoordinateAtoms,
			previewLocation: previewLocationSelector,
			showNodes: showNodesAtom,
			activeLayer: activeLayerSelector,
			previewRun: previewRunSelector,
		},
		actions: {
			selectGlyph(glyphId: GlyphId): void {
				const currentDocument = font.read.editorSource()
				if (!currentDocument?.glyphs.some((glyph) => glyph.id === glyphId))
					return
				font.silo.setState(activeGlyphIdAtom, glyphId)
				font.silo.setState(selectionAtom, Object.freeze([]))
				font.silo.setState(editingTextIndexAtom, null)
				font.silo.setState(activeToolAtom, "select")
			},
			enterGlyphEdit(textStart: number, glyphId: GlyphId): void {
				const currentDocument = font.read.editorSource()
				if (!currentDocument?.glyphs.some((glyph) => glyph.id === glyphId))
					return
				font.silo.setState(activeGlyphIdAtom, glyphId)
				font.silo.setState(editingTextIndexAtom, textStart)
				font.silo.setState(selectionAtom, Object.freeze([]))
				font.silo.setState(activeToolAtom, "select")
			},
			exitGlyphEdit(): void {
				font.silo.setState(editingTextIndexAtom, null)
				font.silo.setState(selectionAtom, Object.freeze([]))
				font.silo.setState(activeToolAtom, "select")
			},
			selectTool(tool: EditorToolId): void {
				font.silo.setState(activeToolAtom, tool)
			},
			addGlyphs(names: readonly string[]): readonly GlyphId[] {
				const currentDocument = font.read.editorSource()
				if (currentDocument === null) return []
				const existingNames = new Set(
					currentDocument.glyphs.map((glyph) => glyph.name),
				)
				const existingIds = new Set(
					currentDocument.glyphs.map((glyph) => glyph.id),
				)
				const cmap = [...currentDocument.cmap]
				const mappedCodePoints = new Set(cmap.map((entry) => entry.codePoint))
				const glyphs = [...currentDocument.glyphs]
				const addedIds: GlyphId[] = []
				for (const rawName of names) {
					const name = rawName.trim()
					const id = `glyph:${name}` as GlyphId
					if (
						name.length === 0 ||
						existingNames.has(name) ||
						existingIds.has(id)
					)
						continue
					existingNames.add(name)
					existingIds.add(id)
					glyphs.push({
						id,
						name,
						export: true,
						color: "#d5963f",
						contours: [],
						layers: currentDocument.masters.map((master) => ({
							masterId: master.id,
							advanceWidth: currentDocument.metadata.unitsPerEm,
							leftSideBearing: 80,
							points: [],
						})),
					})
					const characters = Array.from(name)
					const codePoint =
						characters.length === 1 ? name.codePointAt(0) : undefined
					if (codePoint !== undefined && !mappedCodePoints.has(codePoint)) {
						cmap.push({ codePoint, glyphId: id })
						mappedCodePoints.add(codePoint)
					}
					addedIds.push(id)
				}
				if (addedIds.length === 0) return Object.freeze([])
				font.actions.load({ ...currentDocument, glyphs, cmap })
				const selectedId = addedIds.at(-1)
				if (selectedId !== undefined) {
					font.silo.setState(activeGlyphIdAtom, selectedId)
					font.silo.setState(editingTextIndexAtom, null)
					font.silo.setState(selectionAtom, Object.freeze([]))
					font.silo.setState(activeToolAtom, "select")
				}
				return Object.freeze(addedIds)
			},
			selectMaster(masterId: MasterId): void {
				const master = document.masters.find((item) => item.id === masterId)
				if (master === undefined) return
				font.silo.setState(activeMasterIdAtom, masterId)
				setLocation(
					master.kind === "default"
						? Object.fromEntries(
								document.axes.map((axis) => [axis.id, axis.default]),
							)
						: master.location,
				)
			},
			selectInstance(instanceId: InstanceId): void {
				const instance = document.instances.find(
					(item) => item.id === instanceId,
				)
				if (instance !== undefined) setLocation(instance.coordinates)
			},
			setPreviewCoordinate(axisId: AxisId, value: number): void {
				const axis = document.axes.find((item) => item.id === axisId)
				if (axis === undefined || !Number.isFinite(value)) return
				font.silo.setState(
					previewCoordinateAtoms,
					axisId,
					Math.min(axis.max, Math.max(axis.min, value)),
				)
			},
		},
	}
}

export type EditorWorkspace = ReturnType<typeof createEditorWorkspace>
