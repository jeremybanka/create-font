import {
	createFontEditorState,
	type AxisId,
	type ContourId,
	type EditorFontSource,
	type EditorGlyphSource,
	type EditorLayerNode,
	type EditorLocationSource,
	type GlyphCompatibility,
	type GlyphId,
	type InstanceId,
	type MasterId,
	type RuleId,
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
	| "rule"
	| "transform"

export interface EditorValidationStatus {
	readonly ok: boolean
	readonly issueCount: number
}

type EditorUiTransition =
	| Readonly<{ kind: "select-glyph"; glyphId: GlyphId }>
	| Readonly<{
			kind: "review-glyph"
			glyphId: GlyphId
			character?: string
	  }>
	| Readonly<{
			kind: "enter-glyph-edit"
			glyphId: GlyphId
			textStart: number
	  }>
	| Readonly<{ kind: "exit-glyph-edit" }>
	| Readonly<{ kind: "select-tool"; tool: EditorToolId }>
	| Readonly<{ kind: "select-added-glyph"; glyphId: GlyphId }>

type MasterSelection = Readonly<{
	masterId: MasterId
	comparisonMasterId: MasterId
	previewCoordinates: Readonly<Record<string, number | null>>
}>

type EditorInteractionState = Readonly<{
	selectedGlyphId: GlyphId | null
	activeMasterId: MasterId
	comparisonMasterId: MasterId
	selection: readonly EditorSelectionTarget[]
	previewText: string
	caretIndex: number
	textSelectionCollapsed: boolean
	textSelectionRange: TextareaSelectionRange
	editingTextIndex: number | null
	activeTool: EditorToolId
	selectedRuleIds: readonly RuleId[]
	previewCoordinates: Readonly<Record<string, number | null>>
	pathname: string
}>

function reconcileInteractionForSource(
	interaction: EditorInteractionState,
	source: EditorFontSource,
): EditorInteractionState {
	const firstGlyphId = source.glyphs[0]?.id
	const firstMasterId = source.masters[0]?.id
	if (firstGlyphId === undefined || firstMasterId === undefined) {
		throw new TypeError(
			"The editor requires at least one glyph and one master.",
		)
	}
	const masterIds = new Set(source.masters.map((master) => master.id))
	const defaultMasterId = masterIds.has(source.defaultMasterId)
		? source.defaultMasterId
		: firstMasterId
	const activeMasterId = masterIds.has(interaction.activeMasterId)
		? interaction.activeMasterId
		: defaultMasterId
	const comparisonMasterId =
		masterIds.has(interaction.comparisonMasterId) &&
		interaction.comparisonMasterId !== activeMasterId
			? interaction.comparisonMasterId
			: (source.masters.find((master) => master.id !== activeMasterId)?.id ??
				activeMasterId)
	const previewCoordinates = Object.freeze(
		Object.fromEntries(
			source.axes.map((axis) => {
				const current = interaction.previewCoordinates[axis.id]
				const value =
					typeof current === "number" && Number.isFinite(current)
						? current
						: axis.default
				return [axis.id, Math.min(axis.max, Math.max(axis.min, value))]
			}),
		),
	)
	const selectedGlyphIsValid = source.glyphs.some(
		(glyph) => glyph.id === interaction.selectedGlyphId,
	)
	return Object.freeze({
		...interaction,
		selectedGlyphId: selectedGlyphIsValid ? interaction.selectedGlyphId : null,
		activeMasterId,
		comparisonMasterId,
		selection: Object.freeze([]),
		editingTextIndex: selectedGlyphIsValid
			? interaction.editingTextIndex
			: null,
		activeTool: selectedGlyphIsValid ? interaction.activeTool : "select",
		selectedRuleIds: Object.freeze([]),
		previewCoordinates,
	})
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
	const interactionAtom = font.silo.atom<EditorInteractionState>({
		key: "interaction",
		default: Object.freeze({
			selectedGlyphId: null,
			activeMasterId: document.defaultMasterId,
			comparisonMasterId:
				document.masters.find(
					(master) => master.id !== document.defaultMasterId,
				)?.id ?? document.defaultMasterId,
			selection: Object.freeze([]),
			previewText: "AHO\nnon",
			caretIndex: 0,
			textSelectionCollapsed: true,
			textSelectionRange: Object.freeze({
				selectionStart: 0,
				selectionEnd: 0,
				selectionDirection: "none",
			}),
			editingTextIndex: null,
			activeTool: "select",
			selectedRuleIds: Object.freeze([]),
			previewCoordinates: Object.freeze(
				Object.fromEntries(document.axes.map((axis) => [axis.id, axis.default])),
			),
			pathname:
				typeof window === "undefined" ? "/" : window.location.pathname,
		}),
	})
	const selectedGlyphIdSelector = font.silo.selector<GlyphId | null>({
		key: "selectedGlyphId",
		get: ({ get }) => get(interactionAtom).selectedGlyphId,
		set: ({ get, set }, selectedGlyphId) => {
			set(interactionAtom, { ...get(interactionAtom), selectedGlyphId })
		},
	})
	const activeMasterIdSelector = font.silo.selector<MasterId>({
		key: "activeMasterId",
		get: ({ get }) => get(interactionAtom).activeMasterId,
		set: ({ get, set }, activeMasterId) => {
			set(interactionAtom, { ...get(interactionAtom), activeMasterId })
		},
	})
	const comparisonMasterIdSelector = font.silo.selector<MasterId>({
		key: "comparisonMasterId",
		get: ({ get }) => get(interactionAtom).comparisonMasterId,
		set: ({ get, set }, comparisonMasterId) => {
			set(interactionAtom, { ...get(interactionAtom), comparisonMasterId })
		},
	})
	const selectionSelector = font.silo.selector<readonly EditorSelectionTarget[]>({
		key: "selection",
		get: ({ get }) => get(interactionAtom).selection,
		set: ({ get, set }, selection) => {
			set(interactionAtom, { ...get(interactionAtom), selection })
		},
	})
	const previewTextSelector = font.silo.selector<string>({
		key: "previewText",
		get: ({ get }) => get(interactionAtom).previewText,
		set: ({ get, set }, previewText) => {
			set(interactionAtom, { ...get(interactionAtom), previewText })
		},
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
	const caretIndexSelector = font.silo.selector<number>({
		key: "caretIndex",
		get: ({ get }) => get(interactionAtom).caretIndex,
		set: ({ get, set }, caretIndex) => {
			set(interactionAtom, { ...get(interactionAtom), caretIndex })
		},
	})
	const textSelectionCollapsedSelector = font.silo.selector<boolean>({
		key: "textSelectionCollapsed",
		get: ({ get }) => get(interactionAtom).textSelectionCollapsed,
		set: ({ get, set }, textSelectionCollapsed) => {
			set(interactionAtom, {
				...get(interactionAtom),
				textSelectionCollapsed,
			})
		},
	})
	const textSelectionRangeSelector = font.silo.selector<TextareaSelectionRange>({
		key: "textSelectionRange",
		get: ({ get }) => get(interactionAtom).textSelectionRange,
		set: ({ get, set }, textSelectionRange) => {
			set(interactionAtom, { ...get(interactionAtom), textSelectionRange })
		},
	})
	const editingTextIndexSelector = font.silo.selector<number | null>({
		key: "editingTextIndex",
		get: ({ get }) => get(interactionAtom).editingTextIndex,
		set: ({ get, set }, editingTextIndex) => {
			set(interactionAtom, { ...get(interactionAtom), editingTextIndex })
		},
	})
	const activeToolSelector = font.silo.selector<EditorToolId>({
		key: "activeTool",
		get: ({ get }) => get(interactionAtom).activeTool,
		set: ({ get, set }, activeTool) => {
			set(interactionAtom, { ...get(interactionAtom), activeTool })
		},
	})
	const previewCoordinateSelectors = font.silo.selectorFamily<number | null, AxisId>({
		key: "previewCoordinate",
		get:
			(axisId) =>
			({ get }) =>
				get(interactionAtom).previewCoordinates[axisId] ?? null,
		set:
			(axisId) =>
			({ get, set }, value) => {
				const interaction = get(interactionAtom)
				set(interactionAtom, {
					...interaction,
					previewCoordinates: Object.freeze({
						...interaction.previewCoordinates,
						[axisId]: value,
					}),
				})
			},
	})
	const showNodesAtom = font.silo.atom<boolean>({
		key: "showNodes",
		default: true,
	})
	const showMeasuresAtom = font.silo.atom<boolean>({
		key: "showMeasures",
		default: true,
	})
	const selectedRuleIdsSelector = font.silo.selector<readonly RuleId[]>({
		key: "selectedRuleIds",
		get: ({ get }) => get(interactionAtom).selectedRuleIds,
		set: ({ get, set }, selectedRuleIds) => {
			set(interactionAtom, { ...get(interactionAtom), selectedRuleIds })
		},
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
		compilation: font.read.livePreviewCompilation,
	})
	const inactiveGlyphTimeline = font.silo.timeline({
		key: "inactiveGlyph",
		scope: [],
	})
	const pathnameSelector = font.silo.selector<string>({
		key: "pathname",
		get: ({ get }) => get(interactionAtom).pathname,
		set: ({ get, set }, pathname) => {
			set(interactionAtom, { ...get(interactionAtom), pathname })
		},
	})
	const routeSelector = font.silo.selector<Route | 404>({
		key: "route",
		get: ({ get }) => {
			const path = get(pathnameSelector).split(`/`).slice(1).filter(Boolean)
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
	const setLocationTransaction = font.silo.transaction<
		(previewCoordinates: Readonly<Record<string, number | null>>) => void
	>({
		key: "setLocation",
		do: ({ get, set }, previewCoordinates) => {
			set(interactionAtom, {
				...get(interactionAtom),
				previewCoordinates,
			})
		},
	})
	const selectMasterTransaction = font.silo.transaction<
		(selection: MasterSelection) => void
	>({
		key: "selectMaster",
		do: ({ get, set }, selection) => {
			set(interactionAtom, {
				...get(interactionAtom),
				activeMasterId: selection.masterId,
				comparisonMasterId: selection.comparisonMasterId,
				selection: Object.freeze([]),
				previewCoordinates: selection.previewCoordinates,
			})
		},
	})
	const transitionEditorUiTransaction = font.silo.transaction<
		(transition: EditorUiTransition) => void
	>({
		key: "transitionEditorUi",
		do: ({ get, set }, transition) => {
			const interaction = get(interactionAtom)
			switch (transition.kind) {
				case "select-glyph":
					set(interactionAtom, {
						...interaction,
						selectedGlyphId: transition.glyphId,
						selection: Object.freeze([]),
						selectedRuleIds: Object.freeze([]),
						editingTextIndex: null,
						activeTool: "select",
					})
					return
				case "review-glyph":
					set(interactionAtom, {
						...interaction,
						selectedGlyphId: transition.glyphId,
						selection: Object.freeze([]),
						selectedRuleIds: Object.freeze([]),
						activeTool: "select",
						...(transition.character === undefined
							? { editingTextIndex: null }
							: {
									previewText: transition.character,
									caretIndex: 0,
									editingTextIndex: 0,
								}),
						pathname: "/",
					})
					return
				case "enter-glyph-edit":
					set(interactionAtom, {
						...interaction,
						selectedGlyphId: transition.glyphId,
						editingTextIndex: transition.textStart,
						selection: Object.freeze([]),
						selectedRuleIds: Object.freeze([]),
						activeTool: "select",
					})
					return
				case "exit-glyph-edit":
					set(interactionAtom, {
						...interaction,
						editingTextIndex: null,
						selection: Object.freeze([]),
						selectedRuleIds: Object.freeze([]),
						activeTool: "select",
					})
					return
				case "select-tool":
					set(interactionAtom, {
						...interaction,
						activeTool: transition.tool,
						...(transition.tool === "select" || transition.tool === "rule"
							? {}
							: { selectedRuleIds: Object.freeze([]) }),
					})
					return
				case "select-added-glyph":
					set(interactionAtom, {
						...interaction,
						selectedGlyphId: transition.glyphId,
						editingTextIndex: null,
						selection: Object.freeze([]),
						activeTool: "select",
					})
			}
		},
	})
	const runSetLocation = font.silo.runTransaction(setLocationTransaction)
	const runSelectMaster = font.silo.runTransaction(selectMasterTransaction)
	const runEditorUiTransition = font.silo.runTransaction(
		transitionEditorUiTransaction,
	)
	const replaceSourceTransaction = font.silo.transaction<
		(source: EditorFontSource, interaction: EditorInteractionState) => void
	>({
		key: "replaceSource",
		do: ({ get, run, set }, nextSource, nextInteraction) => {
			run(font.transactions.replaceFont)(nextSource)
			set(interactionAtom, nextInteraction)
			set(font.atoms.documentRevision, get(font.atoms.documentRevision) + 1)
		},
	})
	const runReplaceSource = font.silo.runTransaction(replaceSourceTransaction)
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
						get(previewCoordinateSelectors, axis.id) ?? axis.default,
					]),
				),
			)
		},
	})

	let previewRunCache:
		| Readonly<{
				signature: readonly unknown[]
				value: readonly PreviewRunItem[]
		  }>
		| undefined
	const previewRunSelector = font.silo.selector<readonly PreviewRunItem[]>({
		key: "previewRun",
		get: ({ get }) => {
			// Font mutations are revisioned. Keep the subscribed selector's reactive
			// edge shallow, then read the already memoized document projections
			// directly. Tracking every point/handle selector makes atom.io retrace the
			// entire glyph graph for each atom created by a Pen transaction.
			get(font.atoms.documentRevision)
			const activeMasterId = get(activeMasterIdSelector)
			const metrics = font.silo.getState(font.atoms.metrics) ?? document.metrics
			const metadata = font.silo.getState(font.atoms.metadata)
			const unitsPerEm = metadata?.unitsPerEm ?? document.metadata.unitsPerEm
			const axisIds = font.silo.getState(font.atoms.axisIds)
			const axisSources = axisIds.map((axisId) =>
				font.silo.getState(font.atoms.axis, axisId),
			)
			const axes = axisIds.flatMap((axisId, index) => {
				const axis = axisSources[index]
				if (axis === null) return []
				if (axis === undefined) return []
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
			const previewText = get(previewTextSelector)
			const characters = [...previewText]
			const codePoints = new Set(
				characters.flatMap((character) => {
					const codePoint = character.codePointAt(0)
					return codePoint === undefined ? [] : [codePoint]
				}),
			)
			const byCodePoint = new Map(
				[...codePoints].flatMap((codePoint) => {
					const glyphId = font.silo.getState(font.atoms.cmapGlyph, codePoint)
					return glyphId === null ? [] : [[codePoint, glyphId] as const]
				}),
			)
			const glyphIds = font.silo.getState(font.atoms.glyphIds)
			const glyphMetadata = glyphIds.map((glyphId) =>
				font.silo.getState(font.atoms.glyph, glyphId),
			)
			const fallback = glyphIds.find(
				(_glyphId, index) => glyphMetadata[index]?.name === ".notdef",
			)
			const firstExported = glyphIds.find(
				(_glyphId, index) => glyphMetadata[index]?.export,
			)
			const fallbackId = fallback ?? firstExported
			if (fallbackId === undefined) return []
			const kerning = font.silo.getState(font.atoms.kerning)
			const fontFeaturesEnabled = get(fontFeaturesEnabledAtom)
			const featureSubstitutions = get(featureSubstitutionsAtom)
			const readGlyphSource = (glyphId: GlyphId) =>
				font.silo.getState(font.selectors.glyphSource, glyphId)
			const readEditorGlyph = (glyphId: GlyphId) =>
				font.silo.getState(font.selectors.editorGlyphSource, glyphId)
			const glyphSourceById = new Map<
				GlyphId,
				ReturnType<typeof readGlyphSource>
			>()
			const editorGlyphById = new Map<
				GlyphId,
				ReturnType<typeof readEditorGlyph>
			>()
			const runGlyphIds = characters.flatMap((character) => {
				if (character === "\n") return []
				const codePoint = character.codePointAt(0)
				return [
					codePoint === undefined
						? fallbackId
						: (byCodePoint.get(codePoint) ?? fallbackId),
				]
			})
			const sourceGlyphIds = new Set([
				...runGlyphIds,
				...(fontFeaturesEnabled
					? featureSubstitutions.map((rule) => rule.to as GlyphId)
					: []),
			])
			for (const glyphId of sourceGlyphIds) {
				glyphSourceById.set(glyphId, readGlyphSource(glyphId))
				editorGlyphById.set(glyphId, readEditorGlyph(glyphId))
			}
			const signature = [
				activeMasterId,
				metrics,
				metadata,
				axisIds,
				...axisSources,
				location,
				previewText,
				...[...byCodePoint].flat(),
				glyphIds,
				...glyphMetadata,
				kerning,
				fontFeaturesEnabled,
				featureSubstitutions,
				...[...glyphSourceById].flat(),
				...[...editorGlyphById].flat(),
			]
			if (
				previewRunCache !== undefined &&
				signature.length === previewRunCache.signature.length &&
				signature.every((value, index) =>
					Object.is(value, previewRunCache?.signature[index]),
				)
			) {
				return previewRunCache.value
			}
			const run: PreviewRunItem[] = []
			let previousGlyphId: GlyphId | null = null
			let textOffset = 0
			for (const character of characters) {
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
				const result = glyphSourceById.get(glyphId)
				const editorGlyph = editorGlyphById.get(glyphId)
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
					glyph: result?.ok
						? resolveVariableGlyph(glyphId, result.value, axes, location)
						: null,
					sourcePreview:
						editorGlyph === null || editorGlyph === undefined
							? null
							: createGlyphPreview(
									editorGlyph,
									activeMasterId,
									metrics,
									unitsPerEm,
								),
				})
				previousGlyphId = glyphId
			}
			if (!fontFeaturesEnabled) {
				const value = Object.freeze(run)
				previewRunCache = Object.freeze({ signature, value })
				return value
			}
			for (const rule of featureSubstitutions) {
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
					const editorGlyph = editorGlyphById.get(replacementId)
					const contextualTarget =
						rule.contextIndex === undefined
							? undefined
							: input[rule.contextIndex]
					const first = contextualTarget ?? input[0]
					const last = contextualTarget ?? input.at(-1)
					if (
						editorGlyph === null ||
						editorGlyph === undefined ||
						first === undefined ||
						last === undefined
					) {
						continue
					}
					const result = glyphSourceById.get(replacementId)
					run.splice(
						index + (rule.contextIndex ?? 0),
						rule.contextIndex === undefined ? input.length : 1,
						{
							kind: "glyph",
							character: previewText.slice(first.textStart, last.textEnd),
							textStart: first.textStart,
							textEnd: last.textEnd,
							glyphId: replacementId,
							glyph: result?.ok
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
								metrics,
								unitsPerEm,
							),
						},
					)
				}
			}
			const value = Object.freeze(run)
			previewRunCache = Object.freeze({ signature, value })
			return value
		},
	})
	const activeGlyphIdSelector = font.silo.selector<GlyphId | null>({
		key: "activeGlyphId",
		get: ({ get }) => {
			if (get(editingTextIndexSelector) !== null) return get(selectedGlyphIdSelector)
			if (get(routeNameSelector) !== "canvas") return get(selectedGlyphIdSelector)
			const caretIndex = get(caretIndexSelector)
			// Glyph geometry changes can invalidate the preview projection without
			// changing which glyph contains the caret. Subscribe only to inputs that
			// can change run membership, then read the cached projection directly.
			for (const character of get(previewTextSelector)) {
				const codePoint = character.codePointAt(0)
				if (codePoint !== undefined) get(font.atoms.cmapGlyph, codePoint)
			}
			for (const glyphId of get(font.atoms.glyphIds)) {
				const glyph = get(font.atoms.glyph, glyphId)
				if (glyph?.name === ".notdef") break
			}
			get(fontFeaturesEnabledAtom)
			get(featureSubstitutionsAtom)
			const previewRun = font.silo.getState(previewRunSelector)
			const containingGlyph = previewRun.find(
				(item): item is PreviewRunGlyph =>
					item.kind === "glyph" &&
					item.textStart <= caretIndex &&
					caretIndex < item.textEnd,
			)
			if (containingGlyph !== undefined) return containingGlyph.glyphId
			const nextGlyph = previewRun.find(
				(item): item is PreviewRunGlyph =>
					item.kind === "glyph" && item.textStart >= caretIndex,
			)
			return nextGlyph?.glyphId ?? null
		},
	})
	const activeGlyphSourceSelector = font.silo.selector<EditorGlyphSource | null>(
		{
			key: "activeGlyphSource",
			get: ({ get }) => {
				const glyphId = get(activeGlyphIdSelector)
				return glyphId === null
					? null
					: get(font.selectors.editorGlyphSource, glyphId)
			},
		},
	)
	const activeGlyphCompatibilitySelector = font.silo.selector<
		GlyphCompatibility | null
	>({
		key: "activeGlyphCompatibility",
		get: ({ get }) => {
			const glyphId = get(activeGlyphIdSelector)
			if (glyphId === null) return null
			return get(font.selectors.glyphCompatibility, [
				get(comparisonMasterIdSelector),
				get(activeMasterIdSelector),
				glyphId,
			])
		},
	})
	const activeKerningPairSelector = font.silo.selector<Readonly<{
		left: GlyphId
		right: GlyphId
		value: number | null
	}> | null>({
		key: "activeKerningPair",
		get: ({ get }) => {
			if (get(editingTextIndexSelector) !== null) return null
			if (!get(textSelectionCollapsedSelector)) return null
			const caret = get(caretIndexSelector)
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
	let activeLayerCache:
		| Readonly<{
				glyph: unknown
				masterId: MasterId
				value: EditorCanvasLayer
		  }>
		| undefined
	const activeLayerSelector = font.silo.selector<EditorCanvasLayer | null>({
		key: "activeLayer",
		get: ({ get }) => {
			get(font.atoms.documentRevision)
			const masterId = get(activeMasterIdSelector)
			const glyphId = get(activeGlyphIdSelector)
			if (glyphId === null) return null
			const editorGlyph = font.silo.getState(
				font.selectors.editorGlyphSource,
				glyphId,
			)
			if (
				activeLayerCache !== undefined &&
				activeLayerCache.masterId === masterId &&
				Object.is(activeLayerCache.glyph, editorGlyph)
			) {
				return activeLayerCache.value
			}
			const contourIds = font.silo.getState(font.atoms.glyphContourIds, [
				masterId,
				glyphId,
			])
			const advanceWidth = font.silo.getState(font.atoms.advanceWidth, [
				masterId,
				glyphId,
			])
			const bounds = font.silo.getState(font.selectors.layerBounds, [
				masterId,
				glyphId,
			])
			if (contourIds === null || advanceWidth === null || !bounds.ok) {
				return null
			}
			const contours: EditorCanvasContour[] = []
			for (const contourId of contourIds) {
				const pointIds = font.silo.getState(font.atoms.contourPointIds, [
					masterId,
					glyphId,
					contourId,
				])
				const closed = font.silo.getState(font.atoms.contourClosed, [
					masterId,
					glyphId,
					contourId,
				])
				if (pointIds === null || closed === null) return null
				const contour: EditorLayerNode[] = []
				const tangentNodes: EditorLayerNode[] = []
				for (const pointId of pointIds) {
					const node = font.silo.getState(font.selectors.layerNode, [
						masterId,
						glyphId,
						pointId,
					])
					if (!node.ok) return null
					contour.push(node.value)
					const topology = font.silo.getState(font.atoms.point, [
						masterId,
						glyphId,
						pointId,
					])
					const position = font.silo.getState(font.atoms.pointPosition, [
						masterId,
						glyphId,
						pointId,
					])
					if (topology === null || position === null) return null
					const atomKey = [masterId, glyphId, pointId] as const
					const incomingX = font.silo.getState(
						font.atoms.incomingHandleX,
						atomKey,
					)
					const incomingY = font.silo.getState(
						font.atoms.incomingHandleY,
						atomKey,
					)
					const outgoingX = font.silo.getState(
						font.atoms.outgoingHandleX,
						atomKey,
					)
					const outgoingY = font.silo.getState(
						font.atoms.outgoingHandleY,
						atomKey,
					)
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
			const value = Object.freeze({
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
			activeLayerCache = Object.freeze({ glyph: editorGlyph, masterId, value })
			return value
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
		runSetLocation(
			Object.freeze(
				Object.fromEntries(
					currentDocument.axes.map((axis) => [
						axis.id,
						location[axis.id] ?? axis.default,
					]),
				),
			),
		)
	}
	const selectMaster = (masterId: MasterId): void => {
		const currentDocument = font.read.editorSource()
		if (currentDocument === null) return
		const master = currentDocument.masters.find((item) => item.id === masterId)
		if (master === undefined) return
		const currentComparisonMasterId = font.silo.getState(comparisonMasterIdSelector)
		const comparisonMasterId =
			currentComparisonMasterId === masterId
				? masterId === currentDocument.defaultMasterId
					? (currentDocument.masters.find((item) => item.id !== masterId)?.id ??
						masterId)
					: currentDocument.defaultMasterId
				: currentComparisonMasterId
		const location =
			master.kind === "default"
				? Object.fromEntries(
						currentDocument.axes.map((axis) => [axis.id, axis.default]),
					)
				: master.location
		runSelectMaster({
			masterId,
			comparisonMasterId,
			previewCoordinates: Object.freeze(
				Object.fromEntries(
					currentDocument.axes.map((axis) => [
						axis.id,
						location[axis.id] ?? axis.default,
					]),
				),
			),
		})
	}
	const cycleMaster = (direction: -1 | 1): void => {
		const currentDocument = font.read.editorSource()
		if (currentDocument === null || currentDocument.masters.length < 2) return
		const currentMasterId = font.silo.getState(activeMasterIdSelector)
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
	let stopBrowserNavigation: (() => void) | null = null
	let workspaceDisposed = false
	const startBrowserNavigation = (): (() => void) => {
		if (workspaceDisposed) return () => {}
		stopBrowserNavigation?.()
		if (
			typeof window === "undefined" ||
			typeof globalThis.document === "undefined"
		) {
			return () => {}
		}
		const syncFromBrowser = (): void => {
			font.silo.setState(pathnameSelector, window.location.pathname)
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
			font.silo.setState(pathnameSelector, url.pathname)
		}
		globalThis.document.addEventListener(`click`, navigateFromClick)
		window.addEventListener(`popstate`, syncFromBrowser)
		let active = true
		const stop = (): void => {
			if (!active) return
			active = false
			globalThis.document.removeEventListener(`click`, navigateFromClick)
			window.removeEventListener(`popstate`, syncFromBrowser)
			if (stopBrowserNavigation === stop) stopBrowserNavigation = null
		}
		stopBrowserNavigation = stop
		return stop
	}

	return {
		startBrowserNavigation,
		dispose(): void {
			if (workspaceDisposed) return
			workspaceDisposed = true
			stopBrowserNavigation?.()
			restoreTextCanvasFocus = null
			liveFontCompiler.dispose()
		},
		font,
		liveFont: {
			family: "Create Font Live Preview",
			compilation: liveFontCompiler.state,
			active: liveFontCompiler.active,
			start: liveFontCompiler.start,
			stop: liveFontCompiler.stop,
			retain: liveFontCompiler.retain,
			request: liveFontCompiler.request,
			dispose: liveFontCompiler.dispose,
		},
		inactiveGlyphTimeline,
		document,
		ui: {
			selectedGlyphId: selectedGlyphIdSelector,
			activeGlyphId: activeGlyphIdSelector,
			activeGlyphSource: activeGlyphSourceSelector,
			activeGlyphCompatibility: activeGlyphCompatibilitySelector,
			activeMasterId: activeMasterIdSelector,
			comparisonMasterId: comparisonMasterIdSelector,
			selection: selectionSelector,
			previewText: previewTextSelector,
			fontFeaturesEnabled: fontFeaturesEnabledAtom,
			caretIndex: caretIndexSelector,
			textSelectionCollapsed: textSelectionCollapsedSelector,
			textSelectionRange: textSelectionRangeSelector,
			editingTextIndex: editingTextIndexSelector,
			activeTool: activeToolSelector,
			previewCoordinate: previewCoordinateSelectors,
			previewLocation: previewLocationSelector,
			showNodes: showNodesAtom,
			showMeasures: showMeasuresAtom,
			selectedRuleIds: selectedRuleIdsSelector,
			constrainProportions: constrainProportionsAtom,
			canvasView: canvasViewAtom,
			canvasViewport: canvasViewportAtom,
			visualDebug: visualDebugAtom,
			compatibilityGhostOffset: compatibilityGhostOffsetAtom,
			validation: validationAtom,
			pathname: pathnameSelector,
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
				font.silo.setState(pathnameSelector, pathname)
			},
			selectGlyph(glyphId: GlyphId): void {
				const currentDocument = font.read.editorSource()
				if (!currentDocument?.glyphs.some((glyph) => glyph.id === glyphId))
					return
				runEditorUiTransition({ kind: "select-glyph", glyphId })
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
				if (typeof window !== "undefined") history.pushState(null, ``, `/`)
				runEditorUiTransition({
					kind: "review-glyph",
					glyphId,
					...(character === undefined ? {} : { character }),
				})
			},
			enterGlyphEdit(textStart: number, glyphId: GlyphId): void {
				const currentDocument = font.read.editorSource()
				if (!currentDocument?.glyphs.some((glyph) => glyph.id === glyphId))
					return
				runEditorUiTransition({ kind: "enter-glyph-edit", glyphId, textStart })
			},
			exitGlyphEdit(): void {
				runEditorUiTransition({ kind: "exit-glyph-edit" })
			},
			selectTool(tool: EditorToolId): void {
				runEditorUiTransition({ kind: "select-tool", tool })
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
					runEditorUiTransition({
						kind: "select-added-glyph",
						glyphId: selectedId,
					})
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
					masterId !== font.silo.getState(activeMasterIdSelector)
				) {
					font.silo.setState(comparisonMasterIdSelector, masterId)
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
					previewCoordinateSelectors,
					axisId,
					Math.min(axis.max, Math.max(axis.min, value)),
				)
			},
			replaceSource(source: EditorFontSource): void {
				const previousGlyphIds = font.silo.getState(font.atoms.glyphIds)
				const nextInteraction = reconcileInteractionForSource(
					font.silo.getState(interactionAtom),
					source,
				)
				runReplaceSource(source, nextInteraction)
				const nextGlyphIds = font.silo.getState(font.atoms.glyphIds)
				const nextGlyphIdSet = new Set(nextGlyphIds)
				for (const glyphId of previousGlyphIds) {
					if (!nextGlyphIdSet.has(glyphId)) {
						font.silo.disposeTimeline(font.glyphHistoryTimelines, glyphId)
					}
				}
				for (const glyphId of nextGlyphIds) {
					font.silo.clearTimeline(font.glyphHistoryTimelines, glyphId)
				}
				font.silo.clearTimeline(font.kerningTimeline)
			},
		},
	}
}

export type EditorWorkspace = ReturnType<typeof createEditorWorkspace>
