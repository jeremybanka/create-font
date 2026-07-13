import {
	createFontEditorState,
	type AxisId,
	type EditorFontSource,
	type EditorLayerNode,
	type EditorLocationSource,
	type GlyphId,
	type InstanceId,
	type MasterId,
	type PointId,
} from "@trigraph/states"

import { makeDemoFont } from "./demo-font.ts"
import { resolveVariableGlyph, type ResolvedGlyph } from "./geometry.ts"

export interface EditorCanvasLayer {
	readonly masterId: MasterId
	readonly glyphId: GlyphId
	readonly contours: readonly (readonly EditorLayerNode[])[]
	readonly advanceWidth: number
	readonly leftSideBearing: number
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

export function createEditorWorkspace(
	source: EditorFontSource = makeDemoFont(),
) {
	const font = createFontEditorState({ key: "trigraph/editor/geometric-o" })
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
	const key = (suffix: string): string => `trigraph/editor/ui/${suffix}`
	const activeGlyphId = font.silo.atom<GlyphId>({
		key: key("activeGlyphId"),
		default:
			document.glyphs.find((glyph) => glyph.name === "O")?.id ?? firstGlyph,
	})
	const activeMasterId = font.silo.atom<MasterId>({
		key: key("activeMasterId"),
		default: document.defaultMasterId,
	})
	const selectedPointId = font.silo.atom<PointId | null>({
		key: key("selectedPointId"),
		default: null,
	})
	const previewText = font.silo.atom<string>({
		key: key("previewText"),
		default: "OOOO\nOOOO",
	})
	const caretIndex = font.silo.atom<number>({
		key: key("caretIndex"),
		default: 0,
	})
	const editingTextIndex = font.silo.atom<number | null>({
		key: key("editingTextIndex"),
		default: null,
	})
	const previewCoordinate = font.silo.atomFamily<number | null, AxisId>({
		key: key("previewCoordinate"),
		default: null,
	})
	const showNodes = font.silo.atom<boolean>({
		key: key("showNodes"),
		default: true,
	})
	for (const axis of document.axes) {
		font.silo.setState(previewCoordinate, axis.id, axis.default)
	}
	const previewLocation = font.silo.selector<Readonly<Record<string, number>>>({
		key: key("previewLocation"),
		get: ({ get }) =>
			Object.freeze(
				Object.fromEntries(
					document.axes.map((axis) => [
						axis.id,
						get(previewCoordinate, axis.id) ?? axis.default,
					]),
				),
			),
	})

	const activeLayer = font.silo.selector<EditorCanvasLayer | null>({
		key: key("activeLayer"),
		get: ({ get }) => {
			const masterId = get(activeMasterId)
			const glyphId = get(activeGlyphId)
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
			const contours: (readonly EditorLayerNode[])[] = []
			for (const contourId of contourIds) {
				const pointIds = get(font.atoms.contourPointIds, [glyphId, contourId])
				if (pointIds === null) return null
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
				contours.push(Object.freeze(contour))
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
	const previewRun = font.silo.selector<readonly PreviewRunItem[]>({
		key: key("previewRun"),
		get: ({ get }) => {
			const location = get(previewLocation)
			const byCodePoint = new Map(
				document.cmap.map((entry) => [entry.codePoint, entry.glyphId]),
			)
			const fallback = document.glyphs.find(
				(glyph) => glyph.name === ".notdef",
			)?.id
			const firstExported = document.glyphs.find((glyph) => glyph.export)?.id
			const fallbackId = fallback ?? firstExported
			if (fallbackId === undefined) return []
			const run: PreviewRunItem[] = []
			let textOffset = 0
			for (const character of get(previewText)) {
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
				previewCoordinate,
				axis.id,
				location[axis.id] ?? axis.default,
			)
		}
	}

	return {
		font,
		document,
		ui: {
			activeGlyphId,
			activeMasterId,
			selectedPointId,
			previewText,
			caretIndex,
			editingTextIndex,
			previewCoordinate,
			previewLocation,
			showNodes,
			activeLayer,
			previewRun,
		},
		actions: {
			selectGlyph(glyphId: GlyphId): void {
				if (!document.glyphs.some((glyph) => glyph.id === glyphId)) return
				font.silo.setState(activeGlyphId, glyphId)
				font.silo.setState(selectedPointId, null)
				font.silo.setState(editingTextIndex, null)
			},
			enterGlyphEdit(textStart: number, glyphId: GlyphId): void {
				if (!document.glyphs.some((glyph) => glyph.id === glyphId)) return
				font.silo.setState(activeGlyphId, glyphId)
				font.silo.setState(editingTextIndex, textStart)
				font.silo.setState(selectedPointId, null)
			},
			exitGlyphEdit(): void {
				font.silo.setState(editingTextIndex, null)
				font.silo.setState(selectedPointId, null)
			},
			selectMaster(masterId: MasterId): void {
				const master = document.masters.find((item) => item.id === masterId)
				if (master === undefined) return
				font.silo.setState(activeMasterId, masterId)
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
					previewCoordinate,
					axisId,
					Math.min(axis.max, Math.max(axis.min, value)),
				)
			},
		},
	}
}

export type EditorWorkspace = ReturnType<typeof createEditorWorkspace>
