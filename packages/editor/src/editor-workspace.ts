import {
	createFontEditorState,
	type AxisId,
	type EditorFontSource,
	type EditorLocationSource,
	type GlyphId,
	type InstanceId,
	type MasterId,
	type PointId,
} from "@trigraph/states"

import { makeDemoFont } from "./demo-font.ts"
import { resolveVariableGlyph, type ResolvedGlyph } from "./geometry.ts"

type FontState = ReturnType<typeof createFontEditorState>
type GlyphLayerProjection = ReturnType<FontState["read"]["glyphLayer"]>

export interface PreviewRunGlyph {
	readonly character: string
	readonly glyphId: GlyphId
	readonly glyph: ResolvedGlyph | null
}

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
		default: "OOOO",
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

	const activeLayer = font.silo.selector<GlyphLayerProjection>({
		key: key("activeLayer"),
		get: ({ get }) =>
			get(font.selectors.glyphLayer, [get(activeMasterId), get(activeGlyphId)]),
	})
	const previewRun = font.silo.selector<readonly PreviewRunGlyph[]>({
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
			return Array.from(get(previewText), (character) => {
				const codePoint = character.codePointAt(0)
				const glyphId =
					codePoint === undefined
						? fallbackId
						: (byCodePoint.get(codePoint) ?? fallbackId)
				const result = get(font.selectors.glyphSource, glyphId)
				return {
					character,
					glyphId,
					glyph: result.ok
						? resolveVariableGlyph(
								glyphId,
								result.value,
								document.axes,
								location,
							)
						: null,
				}
			})
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
