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
} from "@create-font/states"

import { makeDemoFont } from "./demo-font.ts"
import type { EditorFeatureSubstitution } from "./browser-api.ts"
import type { CanvasView } from "./canvas-view.ts"
import { createFontFaviconPreview } from "./document-metadata.ts"
import { createGlyphPreview, type GlyphPreview } from "./glyph-preview.ts"
import { createLiveFontCompiler } from "./live-font-compilation.ts"
import { resolveVariableGlyph, type ResolvedGlyph } from "./geometry.ts"
import type { EditorSelectionTarget } from "./outline-selection.ts"
import type { TextareaSelectionRange } from "./textarea-selection.ts"
import { isRoute, type Pathname, type Route, routeName } from "./routing.ts"
import {
	COMPATIBILITY_GHOST_OFFSET,
	DEFAULT_VISUAL_DEBUG_STATE,
	toggleVisualDebug,
	type CompatibilityGhostOffset,
	type VisualDebugState,
	type VisualDebugToggleId,
} from "./visual-debug.ts"

export interface EditorCanvasLayer {
	readonly masterId: MasterId
	readonly glyphId: GlyphId
	readonly contours: readonly EditorCanvasContour[]
	readonly advanceWidth: number
	readonly leftSideBearing: number
	readonly xMin: number
	readonly xMax: number
	readonly outlineWidth: number
	readonly rightSideBearing: number
}

export interface EditorCanvasContour {
	readonly id: ContourId
	readonly closed: boolean
	readonly nodes: readonly EditorLayerNode[]
	/** Raw layer vectors used by state when deriving one-sided tangent bounds. */
	readonly tangentNodes?: readonly EditorLayerNode[]
}

export interface PreviewRunGlyph {
	readonly kind: "glyph"
	readonly character: string
	readonly textStart: number
	readonly textEnd: number
	readonly glyphId: GlyphId
	/** Horizontal adjustment applied before this glyph. */
	readonly kerningBefore?: number
	readonly glyph: ResolvedGlyph | null
	/** Authoring geometry used when open contours prevent compiled preview. */
	readonly sourcePreview: GlyphPreview | null
}

export interface PreviewRunLineBreak {
	readonly kind: "line-break"
	readonly textStart: number
	readonly textEnd: number
}

export type PreviewRunItem = PreviewRunGlyph | PreviewRunLineBreak
export type EditorToolId =
	| "select"
	| "pen"
	| "rect"
	| "ellipse"
	| "knife"
	| "transform"

export interface EditorValidationStatus {
	readonly ok: boolean
	readonly issueCount: number
}

function validationStatus(
	compilation: ReturnType<
		ReturnType<typeof createFontEditorState>["read"]["compilation"]
	>,
): EditorValidationStatus {
	const issueCount = compilation.ok
		? compilation.projectionWarnings.length +
			compilation.ingestionWarnings.length
		: compilation.stage === "projection-failed"
			? compilation.projectionErrors.length +
				compilation.projectionWarnings.length
			: compilation.projectionWarnings.length +
				compilation.ingestionErrors.length +
				compilation.ingestionWarnings.length
	return Object.freeze({ ok: compilation.ok, issueCount })
}

export function createEditorWorkspace(
	source: EditorFontSource = makeDemoFont(),
	initialValidation?: EditorValidationStatus,
	initialFeatureSubstitutions: readonly EditorFeatureSubstitution[] = [],
) {
	const font = createFontEditorState({ key: "create-font/editor/font" })
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
	const selectedGlyphIdAtom = font.silo.atom<GlyphId | null>({
		key: "selectedGlyphId",
		default: null,
	})
	const activeMasterIdAtom = font.silo.atom<MasterId>({
		key: "activeMasterId",
		default: document.defaultMasterId,
	})
	const comparisonMasterIdAtom = font.silo.atom<MasterId>({
		key: "comparisonMasterId",
		default:
			document.masters.find((master) => master.id !== document.defaultMasterId)
				?.id ?? document.defaultMasterId,
	})
	const selectionAtom = font.silo.atom<readonly EditorSelectionTarget[]>({
		key: "selection",
		default: Object.freeze([]),
	})
	const previewTextAtom = font.silo.atom<string>({
		key: "previewText",
		default: "AHO\nnon",
	})
	const featureSubstitutionsAtom = font.silo.atom<
		readonly EditorFeatureSubstitution[]
	>({
		key: "featureSubstitutions",
		default: Object.freeze(initialFeatureSubstitutions),
	})
	const fontFeaturesEnabledAtom = font.silo.atom<boolean>({
		key: "fontFeaturesEnabled",
		default: true,
	})
	font.actions.setFeatureSubstitutions(
		initialFeatureSubstitutions.map((rule) => ({
			...rule,
			from: rule.from as readonly GlyphId[],
			to: rule.to as GlyphId,
		})),
	)
	const caretIndexAtom = font.silo.atom<number>({
		key: "caretIndex",
		default: 0,
	})
	const textSelectionCollapsedAtom = font.silo.atom<boolean>({
		key: "textSelectionCollapsed",
		default: true,
	})
	const textSelectionRangeAtom = font.silo.atom<TextareaSelectionRange>({
		key: "textSelectionRange",
		default: Object.freeze({
			selectionStart: 0,
			selectionEnd: 0,
			selectionDirection: "none",
		}),
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
	const constrainProportionsAtom = font.silo.atom<boolean>({
		key: "constrainProportions",
		default: false,
	})
	const canvasViewAtom = font.silo.atom<CanvasView>({
		key: "canvasView",
		default: { x: 72, y: 72, zoom: 1 },
	})
	const canvasViewportAtom = font.silo.atom<
		Readonly<{ width: number; height: number }>
	>({
		key: "canvasViewport",
		default: { width: 0, height: 0 },
	})
	const visualDebugAtom = font.silo.atom<VisualDebugState>({
		key: "visualDebug",
		default: DEFAULT_VISUAL_DEBUG_STATE,
	})
	const compatibilityGhostOffsetAtom = font.silo.atom<CompatibilityGhostOffset>(
		{
			key: "compatibilityGhostOffset",
			default: COMPATIBILITY_GHOST_OFFSET,
		},
	)
	const validationAtom = font.silo.atom<EditorValidationStatus>({
		key: "validation",
		default: initialValidation ?? validationStatus(font.read.compilation()),
	})
	const liveFontCompiler = createLiveFontCompiler({
		silo: font.silo,
		documentRevision: font.atoms.documentRevision,
		compilation: font.read.compilation,
	})
	const pathnameAtom = font.silo.atom<string>({
		key: "pathname",
		default: () =>
			typeof window === "undefined" ? "/" : window.location.pathname,
		effects: [
			({ setSelf }) => {
				if (
					typeof window === "undefined" ||
					typeof globalThis.document === "undefined"
				) {
					return
				}
				const syncFromBrowser = (): void => {
					setSelf(window.location.pathname)
				}
				const navigateFromClick = (event: MouseEvent): void => {
					if (
						event.defaultPrevented ||
						event.button !== 0 ||
						event.metaKey ||
						event.altKey ||
						event.ctrlKey ||
						event.shiftKey
					) {
						return
					}
					if (!(event.target instanceof Element)) return
					const anchor = event.target.closest(`a`)
					if (!(anchor instanceof HTMLAnchorElement)) return
					if (anchor.target && anchor.target !== `_self`) return
					if (anchor.hasAttribute(`download`)) return
					const url = new URL(anchor.href)
					if (url.origin !== window.location.origin) return
					event.preventDefault()
					history.pushState(null, ``, `${url.pathname}${url.search}${url.hash}`)
					setSelf(url.pathname)
				}
				globalThis.document.addEventListener(`click`, navigateFromClick)
				window.addEventListener(`popstate`, syncFromBrowser)
				return () => {
					globalThis.document.removeEventListener(`click`, navigateFromClick)
					window.removeEventListener(`popstate`, syncFromBrowser)
				}
			},
		],
	})
	const routeSelector = font.silo.selector<Route | 404>({
		key: "route",
		get: ({ get }) => {
			const path = get(pathnameAtom).split(`/`).slice(1).filter(Boolean)
			return isRoute(path) ? path : 404
		},
	})
	const routeNameSelector = font.silo.selector<
		"canvas" | "glyphs" | "info" | "not-found"
	>({
		key: "routeName",
		get: ({ get }) => {
			const route = get(routeSelector)
			return route === 404 ? "not-found" : routeName(route)
		},
	})
	for (const axis of document.axes) {
		font.silo.setState(previewCoordinateAtoms, axis.id, axis.default)
	}
	const previewLocationSelector = font.silo.selector<
		Readonly<Record<string, number>>
	>({
		key: "previewLocation",
		get: ({ get }) => {
			const axes = get(font.atoms.axisIds).flatMap((axisId) => {
				const axis = get(font.atoms.axis, axisId)
				return axis === null ? [] : [{ id: axisId, ...axis }]
			})
			return Object.freeze(
				Object.fromEntries(
					axes.map((axis) => [
						axis.id,
						get(previewCoordinateAtoms, axis.id) ?? axis.default,
					]),
				),
			)
		},
	})

	const previewRunSelector = font.silo.selector<readonly PreviewRunItem[]>({
		key: "previewRun",
		get: ({ get }) => {
			const activeMasterId = get(activeMasterIdAtom)
			const axes = get(font.atoms.axisIds).flatMap((axisId) => {
				const axis = get(font.atoms.axis, axisId)
				if (axis === null) return []
				return [
					{
						id: axisId,
						tag: axis.tag,
						name: axis.name,
						min: axis.min,
						default: axis.default,
						max: axis.max,
						...(axis.hidden ? { hidden: true } : {}),
						...(axis.map === null ? {} : { map: axis.map }),
					},
				]
			})
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
			const kerning = get(font.atoms.kerning)
			let previousGlyphId: GlyphId | null = null
			let textOffset = 0
			for (const character of get(previewTextAtom)) {
				const textStart = textOffset
				textOffset += character.length
				if (character === "\n") {
					run.push({ kind: "line-break", textStart, textEnd: textOffset })
					previousGlyphId = null
					continue
				}
				const codePoint = character.codePointAt(0)
				const glyphId =
					codePoint === undefined
						? fallbackId
						: (byCodePoint.get(codePoint) ?? fallbackId)
				const result = get(font.selectors.glyphSource, glyphId)
				const editorGlyph = get(font.selectors.editorGlyphSource, glyphId)
				run.push({
					kind: "glyph",
					character,
					textStart,
					textEnd: textOffset,
					glyphId,
					kerningBefore:
						previousGlyphId === null
							? 0
							: (kerning.find(
									(pair) =>
										pair.left === previousGlyphId && pair.right === glyphId,
								)?.value ?? 0),
					glyph: result.ok
						? resolveVariableGlyph(glyphId, result.value, axes, location)
						: null,
					sourcePreview:
						editorGlyph === null
							? null
							: createGlyphPreview(
									editorGlyph,
									activeMasterId,
									document.metrics,
									document.metadata.unitsPerEm,
								),
				})
				previousGlyphId = glyphId
			}
			if (!get(fontFeaturesEnabledAtom)) return Object.freeze(run)
			for (const rule of get(featureSubstitutionsAtom)) {
				if (rule.feature !== "liga" && rule.feature !== "calt") continue
				for (
					let index = 0;
					index <= run.length - rule.from.length;
					index += 1
				) {
					const input = run.slice(index, index + rule.from.length)
					if (
						rule.from.length === 0 ||
						!input.every(
							(item, offset) =>
								item.kind === "glyph" && item.glyphId === rule.from[offset],
						)
					)
						continue
					const replacementId = rule.to as GlyphId
					const editorGlyph = get(
						font.selectors.editorGlyphSource,
						replacementId,
					)
					const contextualTarget =
						rule.contextIndex === undefined
							? undefined
							: input[rule.contextIndex]
					const first = contextualTarget ?? input[0]
					const last = contextualTarget ?? input.at(-1)
					if (
						editorGlyph === null ||
						first === undefined ||
						last === undefined
					) {
						continue
					}
					const result = get(font.selectors.glyphSource, replacementId)
					run.splice(
						index + (rule.contextIndex ?? 0),
						rule.contextIndex === undefined ? input.length : 1,
						{
							kind: "glyph",
							character: get(previewTextAtom).slice(
								first.textStart,
								last.textEnd,
							),
							textStart: first.textStart,
							textEnd: last.textEnd,
							glyphId: replacementId,
							glyph: result.ok
								? resolveVariableGlyph(
										replacementId,
										result.value,
										axes,
										location,
									)
								: null,
							sourcePreview: createGlyphPreview(
								editorGlyph,
								activeMasterId,
								document.metrics,
								document.metadata.unitsPerEm,
							),
						},
					)
				}
			}
			return Object.freeze(run)
		},
	})
	const activeGlyphIdSelector = font.silo.selector<GlyphId | null>({
		key: "activeGlyphId",
		get: ({ get }) => {
			if (get(editingTextIndexAtom) !== null) return get(selectedGlyphIdAtom)
			if (get(routeNameSelector) !== "canvas") return get(selectedGlyphIdAtom)
			const caretIndex = get(caretIndexAtom)
			const containingGlyph = get(previewRunSelector).find(
				(item): item is PreviewRunGlyph =>
					item.kind === "glyph" &&
					item.textStart <= caretIndex &&
					caretIndex < item.textEnd,
			)
			if (containingGlyph !== undefined) return containingGlyph.glyphId
			const nextGlyph = get(previewRunSelector).find(
				(item): item is PreviewRunGlyph =>
					item.kind === "glyph" && item.textStart >= caretIndex,
			)
			return nextGlyph?.glyphId ?? null
		},
	})
	const activeKerningPairSelector = font.silo.selector<Readonly<{
		left: GlyphId
		right: GlyphId
		value: number | null
	}> | null>({
		key: "activeKerningPair",
		get: ({ get }) => {
			if (get(editingTextIndexAtom) !== null) return null
			if (!get(textSelectionCollapsedAtom)) return null
			const caret = get(caretIndexAtom)
			const glyphs = get(previewRunSelector).filter(
				(item): item is PreviewRunGlyph => item.kind === "glyph",
			)
			const left = glyphs.find((item) => item.textEnd === caret)
			const right = glyphs.find((item) => item.textStart === caret)
			if (left === undefined || right === undefined) return null
			const pair = get(font.atoms.kerning).find(
				(pair) => pair.left === left.glyphId && pair.right === right.glyphId,
			)
			return Object.freeze({
				left: left.glyphId,
				right: right.glyphId,
				value: pair?.value ?? null,
			})
		},
	})
	const activeLayerSelector = font.silo.selector<EditorCanvasLayer | null>({
		key: "activeLayer",
		get: ({ get }) => {
			const masterId = get(activeMasterIdAtom)
			const glyphId = get(activeGlyphIdSelector)
			if (glyphId === null) return null
			const contourIds = get(font.atoms.glyphContourIds, [masterId, glyphId])
			const advanceWidth = get(font.atoms.advanceWidth, [masterId, glyphId])
			const bounds = get(font.selectors.layerBounds, [masterId, glyphId])
			if (contourIds === null || advanceWidth === null || !bounds.ok) {
				return null
			}
			const contours: EditorCanvasContour[] = []
			for (const contourId of contourIds) {
				const pointIds = get(font.atoms.contourPointIds, [
					masterId,
					glyphId,
					contourId,
				])
				const closed = get(font.atoms.contourClosed, [
					masterId,
					glyphId,
					contourId,
				])
				if (pointIds === null || closed === null) return null
				const contour: EditorLayerNode[] = []
				const tangentNodes: EditorLayerNode[] = []
				for (const pointId of pointIds) {
					const node = get(font.selectors.layerNode, [
						masterId,
						glyphId,
						pointId,
					])
					if (!node.ok) return null
					contour.push(node.value)
					const topology = get(font.atoms.point, [masterId, glyphId, pointId])
					const position = get(font.atoms.pointPosition, [
						masterId,
						glyphId,
						pointId,
					])
					if (topology === null || position === null) return null
					const atomKey = [masterId, glyphId, pointId] as const
					const incomingX = get(font.atoms.incomingHandleX, atomKey)
					const incomingY = get(font.atoms.incomingHandleY, atomKey)
					const outgoingX = get(font.atoms.outgoingHandleX, atomKey)
					const outgoingY = get(font.atoms.outgoingHandleY, atomKey)
					if (
						(incomingX === null) !== (incomingY === null) ||
						(outgoingX === null) !== (outgoingY === null)
					) {
						return null
					}
					tangentNodes.push({
						pointId,
						mode: topology.mode,
						x: position.x,
						y: position.y,
						...(incomingX === null || incomingY === null
							? {}
							: { incoming: { x: incomingX, y: incomingY } }),
						...(outgoingX === null || outgoingY === null
							? {}
							: { outgoing: { x: outgoingX, y: outgoingY } }),
					})
				}
				contours.push(
					Object.freeze({
						id: contourId,
						closed,
						nodes: Object.freeze(contour),
						tangentNodes: Object.freeze(tangentNodes),
					}),
				)
			}
			const { xMin, xMax } = bounds.value
			const outlineWidth = xMax - xMin
			return Object.freeze({
				masterId,
				glyphId,
				contours: Object.freeze(contours),
				advanceWidth,
				leftSideBearing: xMin,
				xMin,
				xMax,
				outlineWidth,
				rightSideBearing: advanceWidth - xMax,
			})
		},
	})
	const glyphIndexSelector = font.silo.selector<
		readonly Readonly<{ id: GlyphId; name: string; export: boolean }>[]
	>({
		key: "glyphIndex",
		get: ({ get }) =>
			Object.freeze(
				get(font.atoms.glyphIds).flatMap((glyphId) => {
					const glyph = get(font.atoms.glyph, glyphId)
					return glyph === null
						? []
						: [
								Object.freeze({
									id: glyphId,
									name: glyph.name,
									export: glyph.export,
								}),
							]
				}),
			),
	})
	const faviconPreviewSelector = font.silo.selector<GlyphPreview | null>({
		key: "faviconPreview",
		get: ({ get }) => {
			const glyphId = get(font.atoms.cmapGlyph, 0x61)
			const metadata = get(font.atoms.metadata)
			const metrics = get(font.atoms.metrics)
			const defaultMasterId = get(font.atoms.defaultMasterId)
			if (
				glyphId === null ||
				metadata === null ||
				metrics === null ||
				defaultMasterId === null
			)
				return null
			const glyph = get(font.selectors.editorGlyphSource, glyphId)
			if (glyph === null) return null
			return createFontFaviconPreview({
				...source,
				metadata,
				metrics,
				defaultMasterId,
				glyphs: [glyph],
				cmap: [{ codePoint: 0x61, glyphId }],
			})
		},
	})

	const setLocation = (location: EditorLocationSource): void => {
		const currentDocument = font.read.editorSource()
		if (currentDocument === null) return
		for (const axis of currentDocument.axes) {
			font.silo.setState(
				previewCoordinateAtoms,
				axis.id,
				location[axis.id] ?? axis.default,
			)
		}
	}
	const selectMaster = (masterId: MasterId): void => {
		const currentDocument = font.read.editorSource()
		if (currentDocument === null) return
		const master = currentDocument.masters.find((item) => item.id === masterId)
		if (master === undefined) return
		font.silo.setState(activeMasterIdAtom, masterId)
		font.silo.setState(selectionAtom, Object.freeze([]))
		if (font.silo.getState(comparisonMasterIdAtom) === masterId) {
			font.silo.setState(
				comparisonMasterIdAtom,
				masterId === currentDocument.defaultMasterId
					? (currentDocument.masters.find((item) => item.id !== masterId)?.id ??
							masterId)
					: currentDocument.defaultMasterId,
			)
		}
		setLocation(
			master.kind === "default"
				? Object.fromEntries(
						currentDocument.axes.map((axis) => [axis.id, axis.default]),
					)
				: master.location,
		)
	}
	const cycleMaster = (direction: -1 | 1): void => {
		const currentDocument = font.read.editorSource()
		if (currentDocument === null || currentDocument.masters.length < 2) return
		const currentMasterId = font.silo.getState(activeMasterIdAtom)
		const currentIndex = currentDocument.masters.findIndex(
			(master) => master.id === currentMasterId,
		)
		if (currentIndex === -1) return
		const nextIndex =
			(currentIndex + direction + currentDocument.masters.length) %
			currentDocument.masters.length
		const nextMaster = currentDocument.masters[nextIndex]
		if (nextMaster !== undefined) selectMaster(nextMaster.id)
	}
	let restoreTextCanvasFocus: (() => void) | null = null

	return {
		font,
		liveFont: {
			family: "Create Font Live Preview",
			compilation: liveFontCompiler.state,
			active: liveFontCompiler.active,
			start: liveFontCompiler.start,
			stop: liveFontCompiler.stop,
			request: liveFontCompiler.request,
		},
		document,
		ui: {
			selectedGlyphId: selectedGlyphIdAtom,
			activeGlyphId: activeGlyphIdSelector,
			activeMasterId: activeMasterIdAtom,
			comparisonMasterId: comparisonMasterIdAtom,
			selection: selectionAtom,
			previewText: previewTextAtom,
			fontFeaturesEnabled: fontFeaturesEnabledAtom,
			caretIndex: caretIndexAtom,
			textSelectionCollapsed: textSelectionCollapsedAtom,
			textSelectionRange: textSelectionRangeAtom,
			editingTextIndex: editingTextIndexAtom,
			activeTool: activeToolAtom,
			previewCoordinate: previewCoordinateAtoms,
			previewLocation: previewLocationSelector,
			showNodes: showNodesAtom,
			constrainProportions: constrainProportionsAtom,
			canvasView: canvasViewAtom,
			canvasViewport: canvasViewportAtom,
			visualDebug: visualDebugAtom,
			compatibilityGhostOffset: compatibilityGhostOffsetAtom,
			validation: validationAtom,
			pathname: pathnameAtom,
			route: routeSelector,
			routeName: routeNameSelector,
			activeLayer: activeLayerSelector,
			previewRun: previewRunSelector,
			activeKerningPair: activeKerningPairSelector,
			glyphIndex: glyphIndexSelector,
			faviconPreview: faviconPreviewSelector,
		},
		actions: {
			registerTextCanvasFocusRestorer(restorer: () => void): () => void {
				restoreTextCanvasFocus = restorer
				return () => {
					if (restoreTextCanvasFocus === restorer) restoreTextCanvasFocus = null
				}
			},
			restoreTextCanvasFocus(): void {
				queueMicrotask(() => restoreTextCanvasFocus?.())
			},
			setActiveKerning(value: number | null): void {
				const pair = font.silo.getState(activeKerningPairSelector)
				if (pair !== null)
					font.actions.setKerningPair({
						left: pair.left,
						right: pair.right,
						value,
					})
			},
			setFeatureSubstitutions(
				substitutions: readonly EditorFeatureSubstitution[],
			): void {
				font.silo.setState(
					featureSubstitutionsAtom,
					Object.freeze([...substitutions]),
				)
				font.actions.setFeatureSubstitutions(
					substitutions.map((rule) => ({
						...rule,
						from: rule.from as readonly GlyphId[],
						to: rule.to as GlyphId,
					})),
				)
			},
			toggleFontFeatures(): void {
				font.silo.setState(fontFeaturesEnabledAtom, (enabled) => !enabled)
			},
			toggleConstrainProportions(): void {
				font.silo.setState(constrainProportionsAtom, (enabled) => !enabled)
			},
			toggleVisualDebug(id: VisualDebugToggleId): void {
				font.silo.setState(visualDebugAtom, (state) =>
					toggleVisualDebug(state, id),
				)
			},
			navigate(pathname: Pathname): void {
				if (typeof window !== "undefined") {
					history.pushState(null, ``, pathname)
				}
				font.silo.setState(pathnameAtom, pathname)
			},
			selectGlyph(glyphId: GlyphId): void {
				const currentDocument = font.read.editorSource()
				if (!currentDocument?.glyphs.some((glyph) => glyph.id === glyphId))
					return
				font.silo.setState(selectedGlyphIdAtom, glyphId)
				font.silo.setState(selectionAtom, Object.freeze([]))
				font.silo.setState(editingTextIndexAtom, null)
				font.silo.setState(activeToolAtom, "select")
			},
			reviewGlyph(glyphId: GlyphId): void {
				const currentDocument = font.read.editorSource()
				if (currentDocument === null) return
				const mapping = currentDocument.cmap.find(
					(entry) => entry.glyphId === glyphId,
				)
				const character =
					mapping === undefined
						? undefined
						: String.fromCodePoint(mapping.codePoint)
				font.silo.setState(selectedGlyphIdAtom, glyphId)
				font.silo.setState(selectionAtom, Object.freeze([]))
				font.silo.setState(activeToolAtom, "select")
				if (character !== undefined) {
					font.silo.setState(previewTextAtom, character)
					font.silo.setState(caretIndexAtom, 0)
					font.silo.setState(editingTextIndexAtom, 0)
				} else {
					font.silo.setState(editingTextIndexAtom, null)
				}
				if (typeof window !== "undefined") history.pushState(null, ``, `/`)
				font.silo.setState(pathnameAtom, `/`)
			},
			enterGlyphEdit(textStart: number, glyphId: GlyphId): void {
				const currentDocument = font.read.editorSource()
				if (!currentDocument?.glyphs.some((glyph) => glyph.id === glyphId))
					return
				font.silo.setState(selectedGlyphIdAtom, glyphId)
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
						layers: currentDocument.masters.map((master) => ({
							masterId: master.id,
							advanceWidth: currentDocument.metadata.unitsPerEm,
							leftSideBearing: 80,
							contours: [],
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
					font.silo.setState(selectedGlyphIdAtom, selectedId)
					font.silo.setState(editingTextIndexAtom, null)
					font.silo.setState(selectionAtom, Object.freeze([]))
					font.silo.setState(activeToolAtom, "select")
				}
				return Object.freeze(addedIds)
			},
			selectMaster,
			selectPreviousMaster(): void {
				cycleMaster(-1)
			},
			selectNextMaster(): void {
				cycleMaster(1)
			},
			selectComparisonMaster(masterId: MasterId): void {
				const currentDocument = font.read.editorSource()
				if (
					currentDocument?.masters.some((master) => master.id === masterId) &&
					masterId !== font.silo.getState(activeMasterIdAtom)
				) {
					font.silo.setState(comparisonMasterIdAtom, masterId)
				}
			},
			selectInstance(instanceId: InstanceId): void {
				const currentDocument = font.read.editorSource()
				const instance = currentDocument?.instances.find(
					(item) => item.id === instanceId,
				)
				if (instance !== undefined) setLocation(instance.coordinates)
			},
			setPreviewCoordinate(axisId: AxisId, value: number): void {
				const axis = font.read
					.editorSource()
					?.axes.find((item) => item.id === axisId)
				if (axis === undefined || !Number.isFinite(value)) return
				font.silo.setState(
					previewCoordinateAtoms,
					axisId,
					Math.min(axis.max, Math.max(axis.min, value)),
				)
			},
			replaceSource(source: EditorFontSource): void {
				font.actions.load(source)
				for (const axis of source.axes) {
					if (font.silo.getState(previewCoordinateAtoms, axis.id) === null) {
						font.silo.setState(previewCoordinateAtoms, axis.id, axis.default)
					}
				}
				const currentGlyphId = font.silo.getState(selectedGlyphIdAtom)
				if (!source.glyphs.some((glyph) => glyph.id === currentGlyphId)) {
					font.silo.setState(selectedGlyphIdAtom, null)
				}
				const currentMasterId = font.silo.getState(activeMasterIdAtom)
				if (!source.masters.some((master) => master.id === currentMasterId)) {
					font.silo.setState(activeMasterIdAtom, source.defaultMasterId)
				}
				font.silo.setState(selectionAtom, Object.freeze([]))
			},
		},
	}
}

export type EditorWorkspace = ReturnType<typeof createEditorWorkspace>
