import {
	canvasScale,
	canvasToolCursor,
	CommandPalette,
	TilingWorkspace,
	isCommandPaletteKeyboardEvent,
	readVectorClipboard,
	reduceVectorGesture,
	reduceCanvasWheel,
	screenToDocument,
	shouldCloseVectorPen,
	VectorControlHandles,
	VectorContourPath,
	VectorPenPreview,
	VectorSelectionBounds,
	VectorShapePreview,
	VectorSnapGuides,
	tileRegistryCommands,
	type PaletteCommand,
	type CanvasPoint,
	type VectorGestureDown,
	type VectorGestureDownInput,
	type VectorGesturePreview,
	type VectorGestureState,
	type VectorEditIntent,
	type VectorSnapGuide,
	type VectorTransformHandle,
	type TileCommandRequest,
} from "@create-font/editor/shared"
import {
	Group,
	type KonvaEventObject,
	Layer,
	Line,
	Rect,
	Stage,
} from "@create-font/preact-konva"
import { DownloadIcon } from "@radix-ui/react-icons"
import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useReducer,
	useRef,
	useState,
} from "preact/hooks"
import type { ComponentChildren, ComponentProps } from "preact"

import {
	defaultDesignAppearance,
	setDesignAppearancePaint,
	summarizeDesignAppearance,
	swapDesignAppearancePaints,
	updateDesignStroke,
	validDesignAppearance,
	type AppearancePaintTarget,
} from "./appearance.ts"
import { activeDesignArtboard } from "./artboards.ts"
import {
	allDesignArtboardsBounds,
	createDesignArtboard,
	deleteDesignArtboard,
	designArtboardsAtPoint,
	duplicateDesignArtboard,
	reorderDesignArtboard,
	updateDesignArtboard,
} from "./artboard-operations.ts"
import {
	duplicateDesignObjects,
	readDesignClipboard,
	writeDesignClipboard,
} from "./clipboard.ts"
import { swatchCss } from "./color.ts"
import { canvasToDocumentPoint } from "./coordinates.ts"
import {
	createInitialDocument,
	DESIGN_STORAGE_KEY,
	readStoredDesignDocument,
} from "./document.ts"
import {
	clearDesignRecoveryDraft,
	createDesignPersistenceState,
	isDesignRecoveryDraftNewer,
	persistenceNeedsUnloadWarning,
	readDesignRecoveryDraft,
	reduceDesignPersistence,
	writeDesignRecoveryDraft,
	type DesignPersistenceState,
} from "./persistence.ts"
import {
	captureDesignPointer,
	DESIGN_MAX_ZOOM,
	DESIGN_MIN_ZOOM,
	DEFAULT_DESIGN_SNAP_SETTINGS,
	designBaseScale,
	initialDesignCanvasView,
	nearestDesignObject,
	releaseDesignPointer,
	snapDesignObject,
	snapDesignObjects,
	type DesignSnapSettings,
	type DesignSnapMatch,
} from "./design-canvas.ts"
import {
	addDesignGuide,
	deleteDesignGuide,
	designRulerTicks,
	updateDesignGuide,
} from "./design-guides.ts"
import { createDesignHistory, reduceDesignHistory } from "./design-history.ts"
import { createDesignPenObject, type DesignPenPoint } from "./design-pen.ts"
import {
	directSelectionDescription,
	directSelectionKey,
	marqueeDirectSelection,
	marqueeObjectIds,
	nearestDirectSelectionTarget,
	selectableObjectIds,
	selectionBounds as combinedSelectionBounds,
	toggleDirectSelection,
	toggleObjectSelection,
	translateDirectSelection,
	type DesignDirectSelectionTarget,
} from "./design-selection.ts"
import { DESIGN_TOOLS } from "./design-tools.ts"
import {
	type DesignSourceReviewChange,
	useDesignVersionControl,
} from "./design-version-control.ts"
import css from "./DesignApplication.module.css"
import {
	IDENTITY_DESIGN_TRANSFORM,
	rotateObject,
	scaleObject,
	translateObject,
} from "./geometry.ts"
import {
	expandDesignShape,
	shapeExpansionEligibility,
} from "./shape-expansion.ts"
import {
	applyDesignPathCommand,
	designPathCommandEligibility,
	type DesignPathCommand,
} from "./path-commands.ts"
import {
	expandDesignStroke,
	strokeExpansionEligibility,
} from "./stroke-expansion.ts"
import {
	applyDesignVectorIntent,
	designVectorAdapter,
	importDesignVectorClipboard,
	importDesignObjects,
	projectDesignVectorObject,
} from "./design-vector-adapter.ts"
import { createPdfDownloadManager } from "./pdf-download.ts"
import type { PdfExportTarget } from "./pdf.ts"
import {
	exportPreflightAllowsOutput,
	type ExportPreflightPreferences,
} from "./export-preflight.ts"
import type {
	DesignExternalSourceUpdate,
	DesignSourceSession,
} from "./source-sync.ts"
import {
	DEFAULT_DESIGN_TILING_LAYOUT,
	DESIGN_TILE_REGISTRY,
	DESIGN_TILING_STORAGE_KEY,
	type DesignTileContext,
	type DesignTileKind,
} from "./design-tile-registry.ts"
import type {
	DesignAppearance,
	DesignArtboard,
	DesignDocument,
	DesignGeometry,
	DesignGuide,
	DesignObject,
	DesignStroke,
	DesignSwatch,
	DesignTool,
} from "./types.ts"

const svg = {
	DownloadIcon,
}

/* eslint-disable lasertag/render-tag-with-own-name -- This renderer guard must return the shared Konva Stage rather than a DOM custom element. */
function MeasuredStage({
	width,
	height,
	...props
}: ComponentProps<typeof Stage>) {
	if (!(width > 0) || !(height > 0)) return null
	return <Stage {...props} width={width} height={height} />
}
/* eslint-enable lasertag/render-tag-with-own-name */

const div = {
	Stage: MeasuredStage,
}

type CanvasGesture =
	| {
			readonly kind: "artboard"
			readonly pointerId: number
			readonly mode: "create" | "move" | "resize"
			readonly start: CanvasPoint
			readonly original: DesignArtboard
			readonly resizeX: -1 | 0 | 1
			readonly resizeY: -1 | 0 | 1
	  }
	| {
			readonly kind: "move"
			readonly originals: readonly DesignObject[]
			readonly state: VectorGestureState
	  }
	| {
			readonly kind: "pan"
			readonly pointerId: number
			readonly start: CanvasPoint
			readonly original: Readonly<{ x: number; y: number; zoom: number }>
	  }
	| {
			readonly kind: "vector"
			readonly state: VectorGestureState
	  }
	| {
			readonly kind: "transform"
			readonly originals: readonly DesignObject[]
			readonly state: VectorGestureState
	  }
	| {
			readonly kind: "direct"
			readonly pointerId: number
			readonly start: CanvasPoint
			readonly original: DesignDocument
			readonly selection: readonly DesignDirectSelectionTarget[]
	  }
	| {
			readonly kind: "guide"
			readonly pointerId: number
			readonly id: string
			readonly axis: "x" | "y"
			readonly original: DesignDocument
			readonly start: CanvasPoint
			readonly value: number
	  }

type DesignObjectGesture = Extract<
	CanvasGesture,
	{ readonly kind: "move" | "transform" }
>

interface DesignGestureObjectPreview {
	readonly objects: readonly DesignObject[]
	readonly snap: {
		readonly x: number | null
		readonly y: number | null
		readonly matches: readonly DesignSnapMatch[]
	}
}

function resolveDesignGestureObject(
	document: DesignDocument,
	gesture: DesignObjectGesture,
	preview: VectorGesturePreview | null,
	worldScale: number,
	snapSettings: DesignSnapSettings,
): DesignGestureObjectPreview | null {
	if (gesture.kind === "move" && preview?.kind === "select-move") {
		const rawObjects = gesture.originals.map((object) =>
			translateObject(object, preview.delta.x, preview.delta.y),
		)
		const snapped =
			rawObjects.length === 1
				? snapDesignObject(rawObjects[0]!, document, worldScale, snapSettings)
				: snapDesignObjects(rawObjects, document, worldScale, snapSettings)
		return {
			objects: "object" in snapped ? [snapped.object] : snapped.objects,
			snap: { x: snapped.x, y: snapped.y, matches: snapped.matches ?? [] },
		}
	}
	if (gesture.kind !== "transform" || preview?.kind !== "transform") return null
	const transformed = gesture.originals.map((object) =>
		preview.handle === "rotation"
			? rotateObject(object, preview.anchor, preview.rotationDegrees)
			: preview.handle === "move"
				? translateObject(object, preview.delta.x, preview.delta.y)
				: scaleObject(object, preview.anchor, preview.scale.x, preview.scale.y),
	)
	return {
		objects: transformed,
		snap: { x: null, y: null, matches: [] },
	}
}

function designSnapGuides(
	snap: Readonly<{
		x: number | null
		y: number | null
		matches?: readonly DesignSnapMatch[]
	}>,
	artboard: Readonly<{ x: number; y: number; width: number; height: number }>,
): readonly VectorSnapGuide[] {
	const xLabel = snap.matches?.find(({ axis }) => axis === "x")?.label
	const yLabel = snap.matches?.find(({ axis }) => axis === "y")?.label
	return [
		...(snap.x === null
			? []
			: [
					{
						id: `design-snap-x:${snap.x}`,
						axis: "x" as const,
						points: [
							snap.x,
							artboard.y,
							snap.x,
							artboard.y + artboard.height,
						] as const,
						...(xLabel === undefined ? {} : { label: xLabel }),
					},
				]),
		...(snap.y === null
			? []
			: [
					{
						id: `design-snap-y:${snap.y}`,
						axis: "y" as const,
						points: [
							artboard.x,
							snap.y,
							artboard.x + artboard.width,
							snap.y,
						] as const,
						...(yLabel === undefined ? {} : { label: yLabel }),
					},
				]),
	]
}

function initialDesignLoad(initialDocument?: DesignDocument): Readonly<{
	document: DesignDocument
	preserveInvalidStorage: boolean
}> {
	if (initialDocument !== undefined)
		return { document: initialDocument, preserveInvalidStorage: false }
	const storage = browserLocalStorage()
	if (storage !== null) {
		const stored = readStoredDesignDocument(storage)
		if (stored.status === "loaded")
			return { document: stored.document, preserveInvalidStorage: false }
		if (stored.status === "invalid")
			return {
				document: createInitialDocument(),
				preserveInvalidStorage: true,
			}
	}
	return {
		document: createInitialDocument(),
		preserveInvalidStorage: false,
	}
}

function browserLocalStorage(): Storage | null {
	try {
		return typeof localStorage === "undefined" ? null : localStorage
	} catch {
		return null
	}
}

const DESIGN_MOVE_ARTWORK_WITH_ARTBOARD_KEY =
	"create-design:move-artwork-with-artboard:v1"

function initialMoveArtworkWithArtboard(): boolean {
	try {
		return (
			browserLocalStorage()?.getItem(DESIGN_MOVE_ARTWORK_WITH_ARTBOARD_KEY) ===
			"true"
		)
	} catch {
		return false
	}
}

function editableTarget(target: EventTarget | null): boolean {
	return (
		target instanceof HTMLInputElement ||
		target instanceof HTMLTextAreaElement ||
		target instanceof HTMLSelectElement ||
		(target instanceof HTMLElement && target.isContentEditable)
	)
}

function persistenceLabel(state: DesignPersistenceState): string {
	switch (state.status) {
		case "saved":
			return state.durableRevision === null
				? "Saved locally."
				: `Saved at source revision ${state.durableRevision}.`
		case "dirty":
			return "Unsaved changes."
		case "queued":
			return "Changes queued to save."
		case "saving":
			return "Saving changes."
		case "conflicted":
			return state.message ?? "Save conflict. Your local design is preserved."
		case "invalid-external-source":
			return "External source is invalid. The last valid design remains open."
		case "recoverable-draft":
			return "A recovery draft is available. It has not been saved."
	}
}

export type DesignApplicationProps = Readonly<{
	children?: ComponentChildren
	initialDocument?: DesignDocument
	sourceSession?: DesignSourceSession
}>

export function DesignApplication(props: DesignApplicationProps) {
	const { initialDocument, sourceSession } = props
	const [initialLoad] = useState(() => initialDesignLoad(initialDocument))
	const versionControl = useDesignVersionControl(sourceSession?.versionControl)
	const [history, dispatch] = useReducer(
		reduceDesignHistory,
		initialLoad.document,
		createDesignHistory,
	)
	const document = history.present
	const [persistence, dispatchPersistence] = useReducer(
		reduceDesignPersistence,
		sourceSession?.initialRevision ?? null,
		(durableRevision) => {
			const state = createDesignPersistenceState(durableRevision)
			if (sourceSession === undefined) return state
			const storage = browserLocalStorage()
			if (storage === null) return state
			const draft = readDesignRecoveryDraft(storage)
			if (draft === null) return state
			const durableDocument = initialDocument ?? createInitialDocument()
			if (!isDesignRecoveryDraftNewer(draft, durableDocument)) {
				clearDesignRecoveryDraft(storage)
				return state
			}
			return reduceDesignPersistence(state, { type: "recovery-found", draft })
		},
	)
	const [tool, setTool] = useState<DesignTool>("select")
	const [selection, setSelection] = useState<readonly string[]>([])
	const [activeArtboardId, setActiveArtboardId] = useState(
		() => activeDesignArtboard(initialLoad.document).id,
	)
	const [directSelection, setDirectSelection] = useState<
		readonly DesignDirectSelectionTarget[]
	>([])
	const [moveArtworkWithArtboard, setMoveArtworkWithArtboardState] = useState(
		initialMoveArtworkWithArtboard,
	)
	const [previewArtboardDocument, setPreviewArtboardDocument] =
		useState<DesignDocument | null>(null)
	const pathCommandSelectionsRef = useRef(
		new WeakMap<
			DesignDocument,
			Readonly<{
				objectSelection: readonly string[]
				directSelection: readonly DesignDirectSelectionTarget[]
			}>
		>(),
	)
	const [currentAppearance, setCurrentAppearance] = useState<DesignAppearance>(
		() => defaultDesignAppearance(initialLoad.document.swatches),
	)
	const [appearanceTarget, setAppearanceTarget] =
		useState<AppearancePaintTarget>("fill")
	const [selectedSwatchId, setSelectedSwatchId] = useState(
		() =>
			defaultDesignAppearance(initialLoad.document.swatches).fill?.swatchId ??
			"",
	)
	const [paletteOpen, setPaletteOpen] = useState(false)
	const [tileCommandRequest, setTileCommandRequest] =
		useState<TileCommandRequest<DesignTileKind> | null>(null)
	const [status, setStatus] = useState(
		"Ready — draw a shape or press ⇧⌘P for commands.",
	)
	const [previewObjects, setPreviewObjects] = useState<readonly DesignObject[]>(
		[],
	)
	const [gesturePreview, setGesturePreview] =
		useState<VectorGesturePreview | null>(null)
	const [penPoints, setPenPoints] = useState<readonly DesignPenPoint[]>([])
	const [canvasViewport, setCanvasViewport] = useState({
		width: 0,
		height: 0,
	})
	const [canvasView, setCanvasView] = useState({ x: 0, y: 0, zoom: 1 })
	const [activeSnapGuides, setActiveSnapGuides] = useState<
		readonly VectorSnapGuide[]
	>([])
	const [snapSettings, setSnapSettings] = useState<DesignSnapSettings>(
		DEFAULT_DESIGN_SNAP_SETTINGS,
	)
	const [selectedGuideId, setSelectedGuideId] = useState<string | null>(null)
	const [guidePreview, setGuidePreview] = useState<Readonly<{
		id: string
		value: number
	}> | null>(null)
	const artboardWrapRef = useRef<HTMLElement>(null)
	const gestureRef = useRef<CanvasGesture | null>(null)
	const penPointsRef = useRef<readonly DesignPenPoint[]>([])
	const previewObjectsRef = useRef<readonly DesignObject[]>([])
	const previewArtboardDocumentRef = useRef<DesignDocument | null>(null)
	const documentRef = useRef(document)
	const persistenceRef = useRef(persistence)
	const serializedDocumentRef = useRef(JSON.stringify(document))
	const preserveInvalidStorageRef = useRef(initialLoad.preserveInvalidStorage)
	const saveDocumentsRef = useRef(new Map<number, DesignDocument>())
	const sequence = useRef(0)
	const tileCommandSequence = useRef(0)
	const pdfDownloadManager = useMemo(() => createPdfDownloadManager(), [])
	useEffect(() => () => pdfDownloadManager.dispose(), [pdfDownloadManager])
	const openTile = useCallback((kind: DesignTileKind): void => {
		tileCommandSequence.current += 1
		setTileCommandRequest({ id: tileCommandSequence.current, kind })
	}, [])
	const nextId = useCallback(() => {
		sequence.current += 1
		return `${Date.now().toString(36)}:${sequence.current.toString(36)}`
	}, [])
	documentRef.current = document
	persistenceRef.current = persistence
	const activeArtboard = activeDesignArtboard(document, activeArtboardId)
	const selectedObjects = document.objects.filter((object) =>
		selection.includes(object.id),
	)
	const selectedObject = selectedObjects[0] ?? null
	const authoredAppearance = validDesignAppearance(
		currentAppearance,
		document.swatches,
	)
	const fallbackSwatchId =
		authoredAppearance.fill?.swatchId ??
		authoredAppearance.stroke?.swatchId ??
		document.swatches[0]?.id
	const appearanceSummary = summarizeDesignAppearance(
		selectedObjects,
		authoredAppearance,
	)
	const lockedAppearanceObject = selectedObjects.find((object) => object.locked)
	const appearanceDisabledReason =
		lockedAppearanceObject === undefined
			? document.swatches.length === 0
				? "Add a document swatch before assigning paint."
				: null
			: `Unlock ${lockedAppearanceObject.name} before editing the selection appearance.`
	const strokePropertiesDisabledReason =
		appearanceDisabledReason ??
		((
			selectedObjects.length === 0
				? authoredAppearance.stroke === undefined
				: selectedObjects.some(
						(object) => object.appearance.stroke === undefined,
					)
		)
			? "Assign a stroke paint to the complete selection before editing stroke properties."
			: null)
	const selectedSwatch =
		document.swatches.find((swatch) => swatch.id === selectedSwatchId) ??
		document.swatches[0]
	const expansionEligibility = shapeExpansionEligibility(document, selection)
	const strokeEligibility = strokeExpansionEligibility(document, selection)
	const pathCommandContext = {
		document,
		objectSelection: selection,
		directSelection,
	}
	const baseScale = designBaseScale(canvasViewport, activeArtboard)
	const viewOptions = useMemo(
		() => ({
			baseScale,
			minZoom: DESIGN_MIN_ZOOM,
			maxZoom: DESIGN_MAX_ZOOM,
		}),
		[baseScale],
	)
	const worldScale = canvasScale(canvasView, viewOptions)
	const focusActiveArtboard = useCallback((): void => {
		artboardWrapRef.current?.focus()
		if (!(canvasViewport.width > 0) || !(canvasViewport.height > 0)) return
		setCanvasView(initialDesignCanvasView(canvasViewport, activeArtboard))
	}, [activeArtboard, canvasViewport])
	const fitAllArtboards = useCallback((): void => {
		artboardWrapRef.current?.focus()
		if (!(canvasViewport.width > 0) || !(canvasViewport.height > 0)) return
		setCanvasView(
			initialDesignCanvasView(
				canvasViewport,
				allDesignArtboardsBounds(document.artboards),
			),
		)
	}, [canvasViewport, document.artboards])
	const setMoveArtworkWithArtboard = useCallback((enabled: boolean): void => {
		setMoveArtworkWithArtboardState(enabled)
		try {
			browserLocalStorage()?.setItem(
				DESIGN_MOVE_ARTWORK_WITH_ARTBOARD_KEY,
				String(enabled),
			)
		} catch {
			// The preference remains effective for this session when storage is blocked.
		}
	}, [])
	const gesturePolicy = useMemo(
		() => ({ yAxis: "down" as const, rotationSnapDegrees: 15 }),
		[],
	)

	const commit = useCallback((next: DesignDocument): void => {
		dispatch({ type: "commit", document: next })
	}, [])
	const activateArtboard = useCallback(
		(artboard: DesignArtboard, focus = false): void => {
			setActiveArtboardId(artboard.id)
			setSelection([])
			if (focus && canvasViewport.width > 0 && canvasViewport.height > 0)
				setCanvasView(initialDesignCanvasView(canvasViewport, artboard))
		},
		[canvasViewport],
	)
	const createArtboard = useCallback((): void => {
		const result = createDesignArtboard(document, `artboard:${nextId()}`)
		commit(result.document)
		setActiveArtboardId(result.activeArtboardId)
		setSelection([])
		setTool("artboard")
		setStatus("Created a new artboard.")
	}, [commit, document, nextId])
	const duplicateArtboard = useCallback((): void => {
		const result = duplicateDesignArtboard(
			document,
			activeArtboard.id,
			`artboard:${nextId()}`,
		)
		commit(result.document)
		setActiveArtboardId(result.activeArtboardId)
		setSelection([])
		setStatus(`Duplicated ${activeArtboard.name}.`)
	}, [activeArtboard, commit, document, nextId])
	const deleteArtboard = useCallback((): void => {
		const result = deleteDesignArtboard(document, activeArtboard.id)
		if (result === null) {
			setStatus("A document must keep at least one artboard.")
			return
		}
		commit(result.document)
		setActiveArtboardId(result.activeArtboardId)
		setStatus(`Deleted ${activeArtboard.name}; global artwork was preserved.`)
	}, [activeArtboard, commit, document])
	const setArtboardProperty = useCallback(
		(property: Partial<Omit<DesignArtboard, "id">>): void => {
			try {
				commit(
					updateDesignArtboard(document, activeArtboard.id, property, {
						moveIntersectingArtwork: moveArtworkWithArtboard,
					}),
				)
				setStatus(`Updated ${activeArtboard.name}.`)
			} catch (error) {
				setStatus(error instanceof Error ? error.message : "Invalid artboard.")
			}
		},
		[activeArtboard, commit, document, moveArtworkWithArtboard],
	)
	const reorderArtboard = useCallback(
		(direction: -1 | 1): void => {
			const index = document.artboards.findIndex(
				({ id }) => id === activeArtboard.id,
			)
			const next = reorderDesignArtboard(
				document,
				activeArtboard.id,
				index + direction,
			)
			if (next !== document) commit(next)
		},
		[activeArtboard.id, commit, document],
	)
	const commitVectorIntent = useCallback(
		(intent: VectorEditIntent): boolean => {
			const result = applyDesignVectorIntent(document, selection, intent)
			if (!result.ok) {
				setStatus(result.error)
				return false
			}
			commit(result.document)
			setSelection(result.selection)
			return true
		},
		[commit, document, selection],
	)

	const pagePoint = useCallback(
		(event: KonvaEventObject<PointerEvent | MouseEvent>): CanvasPoint => {
			const pointer = event.target.getStage()?.getPointerPosition() ?? {
				x: 0,
				y: 0,
			}
			return canvasToDocumentPoint(
				screenToDocument(pointer, canvasView, viewOptions),
			)
		},
		[canvasView, viewOptions],
	)
	const documentPointFromClient = useCallback(
		(point: Readonly<{ clientX: number; clientY: number }>): CanvasPoint => {
			const bounds = artboardWrapRef.current?.getBoundingClientRect()
			const screen = {
				x: point.clientX - (bounds?.left ?? 0),
				y: point.clientY - (bounds?.top ?? 0),
			}
			return canvasToDocumentPoint(
				screenToDocument(screen, canvasView, viewOptions),
			)
		},
		[canvasView, viewOptions],
	)
	const createGuideFromRuler = useCallback(
		(
			axis: "x" | "y",
			event: Readonly<{ clientX: number; clientY: number }>,
		): void => {
			const point = documentPointFromClient(event)
			const guide: DesignGuide = {
				id: `guide:${nextId()}`,
				axis,
				value: axis === "x" ? point.x : point.y,
			}
			commit(addDesignGuide(document, guide))
			setSelectedGuideId(guide.id)
			setStatus(
				`Created ${axis === "x" ? "vertical" : "horizontal"} guide at ${Number(guide.value.toFixed(2))} pt.`,
			)
		},
		[commit, document, documentPointFromClient, nextId],
	)
	const visibleDocumentBounds = useMemo(() => {
		const minimum = canvasToDocumentPoint(
			screenToDocument({ x: 0, y: 0 }, canvasView, viewOptions),
		)
		const maximum = canvasToDocumentPoint(
			screenToDocument(
				{ x: canvasViewport.width, y: canvasViewport.height },
				canvasView,
				viewOptions,
			),
		)
		return {
			minX: minimum.x,
			minY: minimum.y,
			maxX: maximum.x,
			maxY: maximum.y,
		}
	}, [canvasView, canvasViewport, viewOptions])
	const horizontalRulerTicks = useMemo(
		() =>
			designRulerTicks(
				visibleDocumentBounds.minX,
				visibleDocumentBounds.maxX,
				worldScale,
			),
		[visibleDocumentBounds, worldScale],
	)
	const verticalRulerTicks = useMemo(
		() =>
			designRulerTicks(
				visibleDocumentBounds.minY,
				visibleDocumentBounds.maxY,
				worldScale,
			),
		[visibleDocumentBounds, worldScale],
	)

	const cancelCanvasGesture = useCallback((): void => {
		const gesture = gestureRef.current
		if (
			gesture !== null &&
			gesture.kind !== "pan" &&
			gesture.kind !== "direct" &&
			gesture.kind !== "artboard" &&
			gesture.kind !== "guide"
		)
			reduceVectorGesture(
				gesture.state,
				{
					type: "pointer-cancel",
					pointerId: gesture.state.pointerId,
				},
				gesturePolicy,
			)
		gestureRef.current = null
		previewObjectsRef.current = []
		penPointsRef.current = []
		setPreviewObjects([])
		setGesturePreview(null)
		setPenPoints([])
		setActiveSnapGuides([])
		setPreviewArtboardDocument(null)
		previewArtboardDocumentRef.current = null
		setGuidePreview(null)
	}, [gesturePolicy])

	const selectTool = useCallback(
		(nextTool: DesignTool): void => {
			cancelCanvasGesture()
			if (nextTool !== "direct") setDirectSelection([])
			setTool(nextTool)
			setStatus(`${DESIGN_TOOLS[nextTool].label} tool`)
		},
		[cancelCanvasGesture],
	)

	const deleteSelection = useCallback((): void => {
		if (selection.length === 0) return
		if (
			commitVectorIntent({
				kind: "delete",
				objectIds: selection,
			})
		)
			setStatus("Deleted selection.")
	}, [commitVectorIntent, selection])

	const duplicateSelection = useCallback((): void => {
		const result = duplicateDesignObjects(document, selection, nextId)
		if (result === null) return
		commit(result.document)
		setSelection(result.selection)
		setDirectSelection([])
		setStatus(
			`Duplicated ${result.selection.length} object${result.selection.length === 1 ? "" : "s"} with offset.`,
		)
	}, [commit, document, nextId, selection])

	const expandSelection = useCallback((): void => {
		const eligibility = shapeExpansionEligibility(document, selection)
		if (!eligibility.eligible) {
			setStatus(eligibility.reason)
			return
		}
		const expanded = expandDesignShape(eligibility.object, nextId)
		commit({
			...document,
			objects: document.objects.map((object) =>
				object.id === expanded.id ? expanded : object,
			),
		})
		setSelection([expanded.id])
		setStatus(`Expanded ${expanded.name} to ordinary path geometry.`)
	}, [commit, document, nextId, selection])

	const expandStrokeSelection = useCallback((): void => {
		const eligibility = strokeExpansionEligibility(document, selection)
		if (!eligibility.eligible) {
			setStatus(eligibility.reason)
			return
		}
		const result = expandDesignStroke(eligibility.object, nextId)
		if (!result.ok) {
			setStatus(result.error)
			return
		}
		const index = document.objects.findIndex(
			(object) => object.id === eligibility.object.id,
		)
		if (index < 0) {
			setStatus("The selected object is unavailable.")
			return
		}
		commit({
			...document,
			objects: [
				...document.objects.slice(0, index),
				...result.objects,
				...document.objects.slice(index + 1),
			],
		})
		setSelection([result.selectedObjectId])
		setDirectSelection([])
		setStatus(
			`Expanded ${eligibility.object.name}'s stroke to filled contours.`,
		)
	}, [commit, document, nextId, selection])

	const executePathCommand = useCallback(
		(command: DesignPathCommand): void => {
			const result = applyDesignPathCommand(
				command,
				{
					document,
					objectSelection: selection,
					directSelection,
				},
				{ nextId },
			)
			if (!result.ok) {
				setStatus(result.error)
				return
			}
			pathCommandSelectionsRef.current.set(document, {
				objectSelection: selection,
				directSelection,
			})
			pathCommandSelectionsRef.current.set(result.document, {
				objectSelection: result.objectSelection,
				directSelection: result.directSelection,
			})
			commit(result.document)
			setSelection(result.objectSelection)
			setDirectSelection(result.directSelection)
			setStatus(result.message)
		},
		[commit, directSelection, document, nextId, selection],
	)

	const navigateDesignHistory = useCallback(
		(type: "redo" | "undo"): void => {
			const target = type === "undo" ? history.past.at(-1) : history.future[0]
			if (target === undefined) return
			dispatch({ type })
			const recorded = pathCommandSelectionsRef.current.get(target)
			if (recorded === undefined) return
			setSelection(recorded.objectSelection)
			setDirectSelection(recorded.directSelection)
		},
		[history.future, history.past],
	)

	const finishPen = useCallback(
		(closed = false): void => {
			const points = penPointsRef.current
			const object = createDesignPenObject({
				id: `object:${nextId()}`,
				name: `Pen path ${document.objects.length + 1}`,
				appearance: authoredAppearance,
				points,
				closed,
			})
			if (object === null) {
				cancelCanvasGesture()
				return
			}
			commit({ ...document, objects: [...document.objects, object] })
			setSelection([object.id])
			penPointsRef.current = []
			setPenPoints([])
			setGesturePreview(null)
			gestureRef.current = null
			setStatus(
				`Created ${closed ? "closed" : "open"} ${object.name.toLowerCase()}.`,
			)
		},
		[cancelCanvasGesture, commit, authoredAppearance, document, nextId],
	)

	const exportDocument = useCallback(
		(
			target: PdfExportTarget = activeArtboard,
			preferences: ExportPreflightPreferences = {},
		): void => {
			const preflight = pdfDownloadManager.preflight(
				document,
				target,
				preferences,
			)
			if (!exportPreflightAllowsOutput(preflight)) {
				// A refused request still supersedes any older async serialization.
				void pdfDownloadManager.request(document, target, preferences)
				openTile("export")
				setStatus(
					`PDF export blocked by ${preflight.summary.errors} preflight error${preflight.summary.errors === 1 ? "" : "s"}.`,
				)
				return
			}
			setStatus(`Preparing ${document.title}.pdf…`)
			void pdfDownloadManager.request(document, target, preferences).then(
				(downloaded) => {
					if (downloaded)
						setStatus(
							`Exported ${document.title}.pdf with ${document.objects.length} vector objects.`,
						)
				},
				(error) =>
					setStatus(
						`PDF export failed: ${error instanceof Error ? error.message : String(error)}`,
					),
			)
		},
		[activeArtboard, document, openTile, pdfDownloadManager],
	)

	const setObjectProperty = (
		object: DesignObject,
		property: Partial<DesignObject>,
	): void => {
		const committed = commitVectorIntent({
			kind: "set-object-properties",
			objectId: object.id,
			...(property.name === undefined ? {} : { name: property.name }),
			...(property.hidden === undefined ? {} : { hidden: property.hidden }),
			...(property.locked === undefined ? {} : { locked: property.locked }),
		})
		if (committed && (property.hidden === true || property.locked === true))
			setDirectSelection((current) =>
				current.filter((target) => target.objectId !== object.id),
			)
	}

	const setObjectGeometry = (
		object: DesignObject,
		geometry: DesignGeometry,
	): void => {
		if (object.locked) {
			setStatus("Unlock the selected shape before editing its parameters.")
			return
		}
		if (
			geometry.kind === "path" ||
			!Object.values(geometry)
				.filter((value): value is number => typeof value === "number")
				.every(Number.isFinite) ||
			(geometry.kind === "rectangle" &&
				(geometry.width < 0 || geometry.height < 0)) ||
			(geometry.kind === "ellipse" &&
				(geometry.radiusX < 0 || geometry.radiusY < 0))
		) {
			setStatus("Shape parameters must be finite and non-negative in size.")
			return
		}
		commit({
			...document,
			objects: document.objects.map((candidate) =>
				candidate.id === object.id ? { ...candidate, geometry } : candidate,
			),
		})
		setStatus(`Updated exact parameters for ${object.name}.`)
	}

	const updateSwatch = (swatch: DesignSwatch): void => {
		commit({
			...document,
			swatches: document.swatches.map((candidate) =>
				candidate.id === swatch.id ? swatch : candidate,
			),
		})
	}

	const applyAppearancePaint = (
		target: AppearancePaintTarget,
		swatchId: string | undefined,
	): void => {
		if (appearanceDisabledReason !== null) {
			setStatus(appearanceDisabledReason)
			return
		}
		if (
			swatchId !== undefined &&
			!document.swatches.some((swatch) => swatch.id === swatchId)
		) {
			setStatus(`Unknown design swatch ${swatchId}.`)
			return
		}
		const update = (appearance: DesignAppearance): DesignAppearance =>
			setDesignAppearancePaint(appearance, target, swatchId)
		setCurrentAppearance(update)
		if (selectedObjects.length > 0)
			commit({
				...document,
				objects: document.objects.map((object) =>
					selection.includes(object.id)
						? { ...object, appearance: update(object.appearance) }
						: object,
				),
			})
		setStatus(
			`${target === "fill" ? "Fill" : "Stroke"} paint set to ${
				swatchId === undefined
					? "none"
					: (document.swatches.find((swatch) => swatch.id === swatchId)?.name ??
						swatchId)
			}${selectedObjects.length === 0 ? " for new objects" : ""}.`,
		)
	}

	const swapAppearance = (): void => {
		if (appearanceDisabledReason !== null) {
			setStatus(appearanceDisabledReason)
			return
		}
		setCurrentAppearance(swapDesignAppearancePaints)
		if (selectedObjects.length > 0)
			commit({
				...document,
				objects: document.objects.map((object) =>
					selection.includes(object.id)
						? {
								...object,
								appearance: swapDesignAppearancePaints(object.appearance),
							}
						: object,
				),
			})
		setStatus(
			`Swapped fill and stroke${selectedObjects.length === 0 ? " for new objects" : ""}.`,
		)
	}

	const applyStrokeProperties = (
		properties: Partial<Omit<DesignStroke, "swatchId">>,
	): void => {
		if (strokePropertiesDisabledReason !== null) {
			setStatus(strokePropertiesDisabledReason)
			return
		}
		const sourceStroke =
			authoredAppearance.stroke ?? selectedObjects[0]?.appearance.stroke
		if (sourceStroke === undefined) return
		const stroke = { ...sourceStroke, ...properties }
		const validDash =
			stroke.dashArray.length === 0 ||
			(stroke.dashArray.every(
				(value) => Number.isFinite(value) && value >= 0,
			) &&
				stroke.dashArray.some((value) => value > 0))
		if (
			!Number.isFinite(stroke.width) ||
			stroke.width < 0 ||
			!Number.isFinite(stroke.miterLimit) ||
			stroke.miterLimit < 1 ||
			!Number.isFinite(stroke.dashOffset) ||
			!validDash
		) {
			setStatus(
				"Stroke values must be finite; width and dashes non-negative; miter limit at least 1; and a dash pattern cannot be all zero.",
			)
			return
		}
		setCurrentAppearance((appearance) =>
			appearance.stroke === undefined
				? { ...appearance, stroke }
				: updateDesignStroke(appearance, properties),
		)
		if (selectedObjects.length > 0)
			commit({
				...document,
				objects: document.objects.map((object) =>
					selection.includes(object.id)
						? {
								...object,
								appearance: updateDesignStroke(object.appearance, properties),
							}
						: object,
				),
			})
		setStatus(
			`Updated stroke properties${selectedObjects.length === 0 ? " for new objects" : ""}.`,
		)
	}

	const addSwatch = (): void => {
		const swatch: DesignSwatch = {
			id: `swatch:${nextId()}`,
			name: `Color ${document.swatches.length + 1}`,
			source: { space: "rgb", r: 128, g: 128, b: 128 },
		}
		commit({ ...document, swatches: [...document.swatches, swatch] })
		setSelectedSwatchId(swatch.id)
	}

	const canReviewSourceChange = (change: DesignSourceReviewChange): boolean => {
		switch (change.kind) {
			case "object":
				return (
					change.change !== "deleted" &&
					document.objects.some((object) => object.id === change.id)
				)
			case "artboard":
				return (
					change.change !== "deleted" &&
					document.artboards.some((artboard) => artboard.id === change.id)
				)
			case "document":
			case "palette":
			case "structure":
				return true
			default:
				return false
		}
	}

	const reviewSourceChange = (change: DesignSourceReviewChange): void => {
		if (!canReviewSourceChange(change)) return
		switch (change.kind) {
			case "object": {
				const object = document.objects.find(
					(candidate) => candidate.id === change.id,
				)
				if (object === undefined) return
				setSelection([object.id])
				selectTool("select")
				requestAnimationFrame(() => artboardWrapRef.current?.focus())
				setStatus(`Reviewing ${object.name}.`)
				return
			}
			case "palette":
				openTile("appearance")
				setStatus("Reviewing the document palette.")
				return
			case "structure":
				openTile("layers")
				setStatus("Reviewing coordinated layer and object structure.")
				return
			case "artboard":
				setActiveArtboardId(change.id)
				openTile("pages")
				setStatus(`Reviewing ${change.label}.`)
				return
			case "document":
				openTile("canvas")
				setStatus("Reviewing document details.")
		}
	}

	const designTileContext: DesignTileContext = {
		activateArtboard,
		addSwatch,
		appearanceDisabledReason,
		appearanceSummary,
		appearanceTarget,
		applyAppearancePaint,
		applyStrokeProperties,
		canReviewSourceChange,
		createArtboard,
		deleteArtboard,
		deleteSelection,
		document,
		expandSelection,
		expansionDisabledReason: expansionEligibility.eligible
			? null
			: expansionEligibility.reason,
		expandStrokeSelection,
		exportDocument,
		fitAllArtboards,
		focusCanvas: focusActiveArtboard,
		activeArtboard,
		duplicateArtboard,
		moveArtworkWithArtboard,
		reorderArtboard,
		reviewSourceChange,
		selectObject: (object, additive = false) => {
			setSelection((current) =>
				toggleObjectSelection(current, object.id, additive),
			)
			setDirectSelection([])
		},
		selectSwatch: (swatch) => setSelectedSwatchId(swatch.id),
		selectTool,
		selectedObject,
		selectedObjectCount: selectedObjects.length,
		selectedObjectIds: selection,
		directSelectionSummary: directSelectionDescription(directSelection),
		selectedSwatch,
		selectedSwatchId,
		selectedGuideId,
		snapSettings,
		setSnapCategory: (category, enabled) =>
			setSnapSettings((current) => ({
				...current,
				enabled: { ...current.enabled, [category]: enabled },
			})),
		setSnapThreshold: (thresholdPixels) =>
			setSnapSettings((current) => ({
				...current,
				thresholdPixels: Math.max(1, Math.min(24, thresholdPixels)),
			})),
		selectGuide: setSelectedGuideId,
		toggleGuideLock: (id) => {
			const guide = document.guides.find((candidate) => candidate.id === id)
			if (guide !== undefined)
				commit(updateDesignGuide(document, id, { locked: !guide.locked }))
		},
		deleteGuide: (id) => {
			const next = deleteDesignGuide(document, id)
			if (next !== document) {
				commit(next)
				setSelectedGuideId((current) => (current === id ? null : current))
			}
		},
		setObjectProperty,
		setObjectGeometry,
		setArtboardProperty,
		setMoveArtworkWithArtboard,
		setAppearanceTarget: (target) => {
			setAppearanceTarget(target)
			const value = appearanceSummary[target]
			if (value !== null && value !== "mixed") setSelectedSwatchId(value)
		},
		swapAppearancePaints: swapAppearance,
		strokePropertiesDisabledReason,
		strokeExpansionDisabledReason: strokeEligibility.eligible
			? null
			: strokeEligibility.reason,
		tool,
		updateSwatch,
		...(versionControl === undefined ? {} : { versionControl }),
		zoom: canvasView.zoom,
	}

	const commands = useMemo<readonly PaletteCommand[]>(
		() => [
			...(
				Object.entries(DESIGN_TOOLS) as readonly [
					DesignTool,
					(typeof DESIGN_TOOLS)[DesignTool],
				][]
			).map(([id, definition]) => ({
				id: `tool-${id}`,
				displayName: definition.label,
				category: "Tools",
				description: `Activate the ${definition.label.toLowerCase()} tool.`,
				icon: definition.paletteIcon,
				shortcut: definition.key,
				checked: tool === id,
				do: () => selectTool(id),
			})),
			{
				id: "export-pdf",
				displayName: "Export PDF",
				category: "File",
				description: "Export the artboard as editable vector PDF content.",
				icon: "DoubleArrowRightIcon",
				shortcut: "⌘ E",
				do: exportDocument,
			},
			{
				id: "expand-shape",
				displayName: "Expand Shape",
				category: "Object",
				description:
					"Convert the selected live rectangle or ellipse to ordinary cubic path geometry.",
				icon: "HobbyKnifeIcon",
				disabled: !expansionEligibility.eligible,
				...(expansionEligibility.eligible
					? {}
					: { disabledReason: expansionEligibility.reason }),
				do: expandSelection,
			},
			{
				id: "expand-stroke",
				displayName: "Expand Stroke",
				category: "Object",
				description:
					"Convert the selected visible stroke to ordinary editable filled contours.",
				icon: "HobbyKnifeIcon",
				disabled: !strokeEligibility.eligible,
				...(strokeEligibility.eligible
					? {}
					: { disabledReason: strokeEligibility.reason }),
				do: expandStrokeSelection,
			},
			...(
				[
					[
						"pathfinder-unite",
						"Pathfinder: Unite",
						"Merge selected filled regions using the topmost appearance.",
					],
					[
						"pathfinder-subtract-front",
						"Pathfinder: Subtract Front",
						"Subtract selected front fills from the backmost filled object.",
					],
					[
						"pathfinder-intersect",
						"Pathfinder: Intersect",
						"Keep only regions shared by every selected filled object.",
					],
					[
						"pathfinder-exclude",
						"Pathfinder: Exclude",
						"Keep regions covered by an odd number of selected filled objects.",
					],
				] as const
			).map(([id, displayName, description]) => {
				const eligibility = designPathCommandEligibility(id, pathCommandContext)
				return {
					id,
					displayName,
					category: "Path",
					description,
					icon: "HobbyKnifeIcon" as const,
					disabled: !eligibility.eligible,
					...(eligibility.eligible
						? {}
						: { disabledReason: eligibility.reason }),
					do: () => executePathCommand(id),
				}
			}),
			...(
				[
					[
						"reverse",
						"Reverse Path",
						"Reverse selected contour direction without changing its shape.",
					],
					[
						"join",
						"Join Paths",
						"Join exactly two selected open-path endpoints.",
					],
					["close", "Close Path", "Close the exact selected open contours."],
					[
						"simplify",
						"Simplify Path",
						"Remove redundant points and refit curves within 0.25 document units.",
					],
					[
						"make-compound",
						"Make Compound Path",
						"Combine selected closed path objects under the topmost appearance.",
					],
					[
						"release-compound",
						"Release Compound Path",
						"Split the selected compound into independently painted paths.",
					],
					[
						"normalize-winding",
						"Normalize Compound Winding",
						"Explicitly orient outer contours and nested holes.",
					],
				] as const
			).map(([id, displayName, description]) => {
				const eligibility = designPathCommandEligibility(id, pathCommandContext)
				return {
					id: `path-${id}`,
					displayName,
					category: "Path",
					description,
					icon: "HobbyKnifeIcon" as const,
					disabled: !eligibility.eligible,
					...(eligibility.eligible
						? {}
						: { disabledReason: eligibility.reason }),
					do: () => executePathCommand(id),
				}
			}),
			{
				id: "select-all",
				displayName: "Select All",
				category: "Edit",
				description: "Select every visible unlocked object.",
				icon: "CursorArrowIcon",
				shortcut: "⌘ A",
				disabled: selectableObjectIds(document.objects).length === 0,
				do: () => {
					const objectIds = selectableObjectIds(document.objects)
					setSelection(objectIds)
					setDirectSelection(
						tool === "direct"
							? document.objects.flatMap((object) =>
									objectIds.includes(object.id) &&
									object.geometry.kind === "path"
										? object.geometry.contours.map((contour) => ({
												kind: "contour" as const,
												objectId: object.id,
												contourId: contour.id,
											}))
										: [],
								)
							: [],
					)
				},
			},
			{
				id: "duplicate-offset",
				displayName: "Duplicate Offset",
				category: "Edit",
				description:
					"Duplicate the selected objects twelve points down and right.",
				icon: "PlusIcon",
				shortcut: "⌘ D",
				disabled: selection.length === 0,
				disabledReason: "Select an object first.",
				do: duplicateSelection,
			},
			{
				id: "delete-selection",
				displayName: "Delete selection",
				category: "Edit",
				icon: "HobbyKnifeIcon",
				shortcut: "⌫",
				disabled: selection.length === 0,
				disabledReason: "Select an object first.",
				do: deleteSelection,
			},
			{
				id: "undo",
				displayName: "Undo",
				category: "Edit",
				icon: "DoubleArrowLeftIcon",
				shortcut: "⌘ Z",
				disabled: history.past.length === 0,
				do: () => navigateDesignHistory("undo"),
			},
			{
				id: "redo",
				displayName: "Redo",
				category: "Edit",
				icon: "DoubleArrowRightIcon",
				shortcut: "⇧⌘ Z",
				disabled: history.future.length === 0,
				do: () => navigateDesignHistory("redo"),
			},
			...tileRegistryCommands(DESIGN_TILE_REGISTRY, designTileContext).map(
				(command): PaletteCommand => ({
					...command,
					do: () => openTile(command.kind),
				}),
			),
		],
		[
			deleteSelection,
			duplicateSelection,
			expandSelection,
			expandStrokeSelection,
			executePathCommand,
			expansionEligibility,
			exportDocument,
			history.future.length,
			history.past.length,
			navigateDesignHistory,
			openTile,
			selectTool,
			selection.length,
			selection,
			directSelection,
			strokeEligibility,
			selectedObject?.id,
			selectedSwatchId,
			tool,
			document,
		],
	)

	useEffect(() => {
		const serialized = JSON.stringify(document)
		if (serialized === serializedDocumentRef.current) {
			if (sourceSession === undefined && !preserveInvalidStorageRef.current)
				browserLocalStorage()?.setItem(DESIGN_STORAGE_KEY, serialized)
			window.document.title = `${history.present.title} — create-design`
			return
		}
		serializedDocumentRef.current = serialized
		if (sourceSession === undefined) {
			preserveInvalidStorageRef.current = false
			browserLocalStorage()?.setItem(
				DESIGN_STORAGE_KEY,
				JSON.stringify(document),
			)
		} else {
			const revision = persistenceRef.current.localRevision + 1
			saveDocumentsRef.current.set(revision, document)
			const recoveryDraft = {
				version: 1 as const,
				baseRevision: persistenceRef.current.durableRevision,
				document,
				updatedAt: Date.now(),
			}
			dispatchPersistence({ type: "edit", recoveryDraft })
			const storage = browserLocalStorage()
			if (storage !== null) writeDesignRecoveryDraft(storage, recoveryDraft)
		}
		window.document.title = `${history.present.title} — create-design`
	}, [document, history.present.title, sourceSession])

	useEffect(() => {
		if (sourceSession === undefined || persistence.status !== "dirty") return
		dispatchPersistence({ type: "queue" })
	}, [persistence.status, sourceSession])

	useEffect(() => {
		if (
			sourceSession === undefined ||
			persistence.status !== "queued" ||
			persistence.queuedRevision === null
		)
			return
		const revision = persistence.queuedRevision
		const pendingDocument =
			saveDocumentsRef.current.get(revision) ?? documentRef.current
		dispatchPersistence({ type: "save-started", revision })
		void sourceSession.save(pendingDocument).then(
			(result) => {
				dispatchPersistence({
					type: "save-succeeded",
					revision,
					durableRevision: result.revision,
				})
				saveDocumentsRef.current.delete(revision)
			},
			(error: unknown) => {
				dispatchPersistence({
					type: "save-failed",
					revision,
					message:
						error instanceof Error ? error.message : "The source write failed.",
				})
			},
		)
	}, [persistence.queuedRevision, persistence.status, sourceSession])

	useEffect(() => {
		if (sourceSession === undefined) return
		const storage = browserLocalStorage()
		if (storage === null) return
		if (persistence.status === "saved") {
			clearDesignRecoveryDraft(storage)
			return
		}
		if (!persistenceNeedsUnloadWarning(persistence)) return
		writeDesignRecoveryDraft(storage, {
			version: 1,
			baseRevision: persistence.durableRevision,
			document: documentRef.current,
			updatedAt: Date.now(),
		})
	}, [
		persistence.durableRevision,
		persistence.localRevision,
		persistence.status,
		sourceSession,
	])

	useEffect(() => {
		if (sourceSession === undefined) return
		const applyExternalUpdate = (
			update: DesignExternalSourceUpdate,
			force = false,
		): void => {
			if (!update.ok) {
				dispatchPersistence({
					type: "external-invalid",
					diagnostics: update.diagnostics,
				})
				return
			}
			if (!force && persistenceNeedsUnloadWarning(persistenceRef.current)) {
				dispatchPersistence({
					type: "external-conflict",
					message: "Source changed on disk while local work was pending.",
				})
				return
			}
			serializedDocumentRef.current = JSON.stringify(update.document)
			dispatch({ type: "reset", document: update.document })
			setSelection([])
			const storage = browserLocalStorage()
			if (storage !== null) clearDesignRecoveryDraft(storage)
			dispatchPersistence({
				type: "external-loaded",
				durableRevision: update.revision,
			})
		}
		return sourceSession.subscribeDocument((update) =>
			applyExternalUpdate(update),
		)
	}, [sourceSession])

	useEffect(() => {
		if (
			sourceSession === undefined ||
			!persistenceNeedsUnloadWarning(persistence)
		)
			return
		const beforeUnload = (event: BeforeUnloadEvent): void => {
			event.preventDefault()
			event.returnValue = ""
		}
		const pageHide = (): void => {
			const storage = browserLocalStorage()
			if (storage === null) return
			writeDesignRecoveryDraft(storage, {
				version: 1,
				baseRevision: persistenceRef.current.durableRevision,
				document: documentRef.current,
				updatedAt: Date.now(),
			})
		}
		window.addEventListener("beforeunload", beforeUnload)
		window.addEventListener("pagehide", pageHide)
		return () => {
			window.removeEventListener("beforeunload", beforeUnload)
			window.removeEventListener("pagehide", pageHide)
		}
	}, [persistence, sourceSession])

	useLayoutEffect(() => {
		const element = artboardWrapRef.current
		if (element === null) return
		const observer = new ResizeObserver(([entry]) => {
			if (entry === undefined) return
			const width = Math.round(entry.contentRect.width)
			const height = Math.round(entry.contentRect.height)
			if (!(width > 0) || !(height > 0)) return
			setCanvasViewport((current) =>
				current.width === width && current.height === height
					? current
					: { width, height },
			)
		})
		observer.observe(element)
		return () => observer.disconnect()
	}, [])

	useEffect(() => {
		if (!(canvasViewport.width > 0) || !(canvasViewport.height > 0)) return
		setCanvasView(initialDesignCanvasView(canvasViewport, activeArtboard))
	}, [activeArtboard.id, canvasViewport.height, canvasViewport.width])

	useEffect(() => {
		if (document.artboards.some(({ id }) => id === activeArtboardId)) return
		setActiveArtboardId(activeDesignArtboard(document).id)
	}, [activeArtboardId, document])

	useEffect(() => {
		const updateGestureModifiers = (event: KeyboardEvent): void => {
			if (event.key !== "Shift" && event.key !== "Alt") return
			const gesture = gestureRef.current
			if (
				gesture === null ||
				gesture.kind === "pan" ||
				gesture.kind === "direct" ||
				gesture.kind === "artboard" ||
				gesture.kind === "guide"
			)
				return
			const transition = reduceVectorGesture(
				gesture.state,
				{
					type: "modifiers",
					pointerId: gesture.state.pointerId,
					modifiers: {
						shiftKey: event.shiftKey,
						altKey: event.altKey,
						additive: event.shiftKey || event.metaKey || event.ctrlKey,
					},
				},
				gesturePolicy,
			)
			if (transition.state === null) return
			gestureRef.current = { ...gesture, state: transition.state }
			setGesturePreview(transition.preview)
			if (gesture.kind === "move" || gesture.kind === "transform") {
				const resolved = resolveDesignGestureObject(
					document,
					gesture,
					transition.preview,
					worldScale,
					snapSettings,
				)
				if (resolved !== null) {
					previewObjectsRef.current = resolved.objects
					setPreviewObjects(resolved.objects)
					setActiveSnapGuides(designSnapGuides(resolved.snap, activeArtboard))
				}
			}
		}
		const keydown = (event: KeyboardEvent): void => {
			updateGestureModifiers(event)
			if (
				isCommandPaletteKeyboardEvent(
					event,
					/Mac|iPhone|iPad/.test(navigator.platform),
				)
			) {
				event.preventDefault()
				setPaletteOpen(true)
				return
			}
			if (paletteOpen || editableTarget(event.target)) return
			const mod = event.metaKey || event.ctrlKey
			if (mod && event.key.toLowerCase() === "a") {
				event.preventDefault()
				const objectIds = selectableObjectIds(document.objects)
				setSelection(objectIds)
				if (tool === "direct")
					setDirectSelection(
						document.objects.flatMap((object) =>
							objectIds.includes(object.id) && object.geometry.kind === "path"
								? object.geometry.contours.map((contour) => ({
										kind: "contour" as const,
										objectId: object.id,
										contourId: contour.id,
									}))
								: [],
						),
					)
				setStatus(`Selected ${objectIds.length} visible unlocked objects.`)
				return
			}
			if (mod && event.key.toLowerCase() === "e") {
				event.preventDefault()
				exportDocument()
				return
			}
			if (mod && event.key.toLowerCase() === "d") {
				event.preventDefault()
				duplicateSelection()
				return
			}
			if (mod && event.key.toLowerCase() === "z") {
				event.preventDefault()
				navigateDesignHistory(event.shiftKey ? "redo" : "undo")
				return
			}
			if (event.key === "Enter" && tool === "pen") {
				event.preventDefault()
				finishPen()
				return
			}
			if (event.key === "Escape") {
				cancelCanvasGesture()
				setSelection([])
				setDirectSelection([])
				setSelectedGuideId(null)
				setStatus("Selection cleared.")
				return
			}
			if (
				["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)
			) {
				const amount = event.shiftKey ? 10 : 1
				const delta = {
					x:
						event.key === "ArrowLeft"
							? -amount
							: event.key === "ArrowRight"
								? amount
								: 0,
					y:
						event.key === "ArrowUp"
							? -amount
							: event.key === "ArrowDown"
								? amount
								: 0,
				}
				const next =
					tool === "direct"
						? translateDirectSelection(document, directSelection, delta)
						: {
								...document,
								objects: document.objects.map((object) =>
									selection.includes(object.id) &&
									!object.locked &&
									!object.hidden
										? translateObject(object, delta.x, delta.y)
										: object,
								),
							}
				if (
					next !== document &&
					(selection.length > 0 || directSelection.length > 0)
				) {
					event.preventDefault()
					commit(next)
					setStatus("Nudged selection.")
				}
				return
			}
			if (event.key === "Backspace" || event.key === "Delete") {
				if (tool === "pen" && penPoints.length > 0) {
					event.preventDefault()
					const points = penPointsRef.current.slice(0, -1)
					penPointsRef.current = points
					setPenPoints(points)
				} else if (tool === "artboard") {
					event.preventDefault()
					deleteArtboard()
				} else if (selectedGuideId !== null) {
					event.preventDefault()
					const next = deleteDesignGuide(document, selectedGuideId)
					if (next === document) setStatus("Locked guides cannot be deleted.")
					else {
						commit(next)
						setSelectedGuideId(null)
						setStatus("Guide deleted.")
					}
				} else {
					event.preventDefault()
					deleteSelection()
				}
				return
			}
			const entry = Object.entries(DESIGN_TOOLS).find(
				([, definition]) =>
					definition.key.toLowerCase() === event.key.toLowerCase(),
			)
			if (entry !== undefined && !mod && !event.altKey) {
				event.preventDefault()
				selectTool(entry[0] as DesignTool)
			}
		}
		window.addEventListener("keydown", keydown)
		window.addEventListener("keyup", updateGestureModifiers)
		return () => {
			window.removeEventListener("keydown", keydown)
			window.removeEventListener("keyup", updateGestureModifiers)
		}
	}, [
		deleteSelection,
		duplicateSelection,
		commit,
		deleteArtboard,
		cancelCanvasGesture,
		directSelection,
		document,
		exportDocument,
		finishPen,
		gesturePolicy,
		navigateDesignHistory,
		paletteOpen,
		penPoints.length,
		selectTool,
		selectedGuideId,
		selection,
		snapSettings,
		tool,
		worldScale,
	])

	useEffect(() => {
		const copy = (event: ClipboardEvent): void => {
			if (editableTarget(event.target) || event.clipboardData === null) return
			const count = writeDesignClipboard(
				event.clipboardData,
				document,
				selection,
				designVectorAdapter.clipboard(document, selection),
			)
			if (count === 0) return
			event.preventDefault()
			setStatus(`Copied ${count} vector object${count === 1 ? "" : "s"}.`)
		}
		const paste = (event: ClipboardEvent): void => {
			if (editableTarget(event.target) || event.clipboardData === null) return
			const nativeAddition = readDesignClipboard(
				event.clipboardData,
				document,
				nextId,
				{
					activeArtboard,
					nativeOnly: true,
				},
			)
			if (nativeAddition !== null && nativeAddition.objects.length > 0) {
				const result = importDesignObjects(document, selection, nativeAddition)
				if (!result.ok) {
					setStatus(result.error)
					return
				}
				event.preventDefault()
				commit(result.document)
				setSelection(result.selection)
				setStatus(
					`Pasted ${nativeAddition.objects.length} vector object${nativeAddition.objects.length === 1 ? "" : "s"}.`,
				)
				return
			}
			const vector = readVectorClipboard(event.clipboardData)
			if (vector !== null) {
				if (fallbackSwatchId === undefined) {
					setStatus("Add a document swatch before pasting vector artwork.")
					return
				}
				const result = importDesignVectorClipboard(
					document,
					selection,
					vector,
					nextId,
					fallbackSwatchId,
				)
				if (!result.ok) {
					setStatus(result.error)
					return
				}
				event.preventDefault()
				commit(result.document)
				setSelection(result.selection)
				setStatus(
					`Pasted ${result.selection.length} vector object${result.selection.length === 1 ? "" : "s"}.`,
				)
				return
			}
			const fallbackAddition = readDesignClipboard(
				event.clipboardData,
				document,
				nextId,
				{
					activeArtboard,
				},
			)
			if (fallbackAddition === null || fallbackAddition.objects.length === 0)
				return
			const result = importDesignObjects(document, selection, fallbackAddition)
			if (!result.ok) {
				setStatus(result.error)
				return
			}
			event.preventDefault()
			commit(result.document)
			setSelection(result.selection)
			setStatus(
				`Pasted ${fallbackAddition.objects.length} vector object${fallbackAddition.objects.length === 1 ? "" : "s"}.`,
			)
		}
		window.addEventListener("copy", copy)
		window.addEventListener("paste", paste)
		return () => {
			window.removeEventListener("copy", copy)
			window.removeEventListener("paste", paste)
		}
	}, [activeArtboard, commit, document, fallbackSwatchId, nextId, selection])

	const gestureModifiers = (
		event: Pick<PointerEvent, "shiftKey" | "altKey" | "metaKey" | "ctrlKey">,
	) => ({
		shiftKey: event.shiftKey,
		altKey: event.altKey,
		additive: event.shiftKey || event.metaKey || event.ctrlKey,
	})
	const gesturePointer = (
		event: KonvaEventObject<PointerEvent>,
		snaps: readonly VectorSnapGuide[] = [],
	) => {
		const screen = event.target.getStage()?.getPointerPosition() ?? {
			x: event.evt.offsetX,
			y: event.evt.offsetY,
		}
		const world = pagePoint(event)
		return {
			world,
			rawWorld: world,
			screen,
			modifiers: gestureModifiers(event.evt),
			snaps,
		}
	}
	const beginVectorGesture = (
		event: KonvaEventObject<PointerEvent>,
		down: VectorGestureDownInput,
		originals?: readonly DesignObject[],
	): void => {
		const transition = reduceVectorGesture(
			null,
			{
				...down,
				type: "pointer-down",
				pointerId: event.evt.pointerId,
				pointer: gesturePointer(event),
			} as VectorGestureDown,
			gesturePolicy,
		)
		if (transition.state === null) return
		gestureRef.current =
			originals === undefined
				? { kind: "vector", state: transition.state }
				: down.tool === "transform"
					? { kind: "transform", originals, state: transition.state }
					: { kind: "move", originals, state: transition.state }
		setGesturePreview(transition.preview)
		captureDesignPointer(event.evt.currentTarget, event.evt.pointerId)
	}

	const startObjectGesture = (
		event: KonvaEventObject<PointerEvent>,
		object: DesignObject,
	): void => {
		if (object.locked || (tool !== "select" && tool !== "transform")) return
		event.cancelBubble = true
		const additive = gestureModifiers(event.evt).additive
		const nextSelection = toggleObjectSelection(selection, object.id, additive)
		setSelection(nextSelection)
		setDirectSelection([])
		if (additive) return
		const movingIds = selection.includes(object.id) ? selection : [object.id]
		const originals = document.objects.filter(
			(candidate) =>
				movingIds.includes(candidate.id) &&
				!candidate.locked &&
				!candidate.hidden,
		)
		beginVectorGesture(
			event,
			{ tool: "select", targetId: object.id },
			originals,
		)
	}

	const startDirectGesture = (
		event: KonvaEventObject<PointerEvent>,
		target: DesignDirectSelectionTarget,
	): void => {
		event.cancelBubble = true
		const additive = gestureModifiers(event.evt).additive
		const alreadySelected = directSelection.some(
			(candidate) =>
				directSelectionKey(candidate) === directSelectionKey(target),
		)
		const next =
			!additive && alreadySelected
				? directSelection
				: toggleDirectSelection(directSelection, target, additive)
		setDirectSelection(next)
		setSelection([...new Set(next.map((candidate) => candidate.objectId))])
		if (additive || next.length === 0) return
		gestureRef.current = {
			kind: "direct",
			pointerId: event.evt.pointerId,
			start: pagePoint(event),
			original: document,
			selection: next,
		}
		captureDesignPointer(event.evt.currentTarget, event.evt.pointerId)
	}
	const beginArtboardGesture = (
		event: KonvaEventObject<PointerEvent>,
		point: CanvasPoint,
	): void => {
		const hits = designArtboardsAtPoint(document.artboards, point)
		let hit = hits.find(({ id }) => id === activeArtboard.id) ?? hits.at(-1)
		if (event.evt.altKey && hits.length > 1) {
			const current = hits.findIndex(({ id }) => id === activeArtboard.id)
			hit = hits[(current + 1) % hits.length]
		}
		if (hit === undefined) {
			const id = `artboard:${nextId()}`
			gestureRef.current = {
				kind: "artboard",
				pointerId: event.evt.pointerId,
				mode: "create",
				start: point,
				original: {
					id,
					name: `Artboard ${document.artboards.length + 1}`,
					x: point.x,
					y: point.y,
					width: 1,
					height: 1,
				},
				resizeX: 1,
				resizeY: 1,
			}
		} else {
			setActiveArtboardId(hit.id)
			const tolerance = 8 / worldScale
			const resizeX =
				Math.abs(point.x - hit.x) <= tolerance
					? -1
					: Math.abs(point.x - (hit.x + hit.width)) <= tolerance
						? 1
						: 0
			const resizeY =
				Math.abs(point.y - hit.y) <= tolerance
					? -1
					: Math.abs(point.y - (hit.y + hit.height)) <= tolerance
						? 1
						: 0
			gestureRef.current = {
				kind: "artboard",
				pointerId: event.evt.pointerId,
				mode: resizeX === 0 && resizeY === 0 ? "move" : "resize",
				start: point,
				original: hit,
				resizeX,
				resizeY,
			}
		}
		setSelection([])
		captureDesignPointer(event.evt.currentTarget, event.evt.pointerId)
	}
	const previewArtboardGesture = (
		gesture: Extract<CanvasGesture, { readonly kind: "artboard" }>,
		point: CanvasPoint,
	): void => {
		const delta = { x: point.x - gesture.start.x, y: point.y - gesture.start.y }
		if (gesture.mode === "create") {
			const bounds = {
				x: Math.min(gesture.start.x, point.x),
				y: Math.min(gesture.start.y, point.y),
				width: Math.max(1, Math.abs(delta.x)),
				height: Math.max(1, Math.abs(delta.y)),
			}
			const preview = createDesignArtboard(
				document,
				gesture.original.id,
				bounds,
			).document
			previewArtboardDocumentRef.current = preview
			setPreviewArtboardDocument(preview)
			return
		}
		let { x, y, width, height } = gesture.original
		if (gesture.mode === "move") {
			x += delta.x
			y += delta.y
		} else {
			if (gesture.resizeX < 0) {
				x = Math.min(
					gesture.original.x + gesture.original.width - 1,
					x + delta.x,
				)
				width = gesture.original.width - (x - gesture.original.x)
			} else if (gesture.resizeX > 0) width = Math.max(1, width + delta.x)
			if (gesture.resizeY < 0) {
				y = Math.min(
					gesture.original.y + gesture.original.height - 1,
					y + delta.y,
				)
				height = gesture.original.height - (y - gesture.original.y)
			} else if (gesture.resizeY > 0) height = Math.max(1, height + delta.y)
		}
		const preview = updateDesignArtboard(
			document,
			gesture.original.id,
			{ x, y, width, height },
			{ moveIntersectingArtwork: moveArtworkWithArtboard },
		)
		previewArtboardDocumentRef.current = preview
		setPreviewArtboardDocument(preview)
	}
	const startGuideGesture = (
		event: KonvaEventObject<PointerEvent>,
		guide: DesignGuide,
	): void => {
		event.cancelBubble = true
		setSelectedGuideId(guide.id)
		if (guide.locked) {
			setStatus("Guide is locked. Unlock it in Canvas settings to move it.")
			return
		}
		gestureRef.current = {
			kind: "guide",
			pointerId: event.evt.pointerId,
			id: guide.id,
			axis: guide.axis,
			original: document,
			start: pagePoint(event),
			value: guide.value,
		}
		captureDesignPointer(event.evt.currentTarget, event.evt.pointerId)
	}

	const pointerDown = (event: KonvaEventObject<PointerEvent>): void => {
		if (event.evt.button === 1) {
			const pointer = event.target.getStage()?.getPointerPosition()
			if (pointer === null || pointer === undefined) return
			gestureRef.current = {
				kind: "pan",
				pointerId: event.evt.pointerId,
				start: pointer,
				original: canvasView,
			}
			captureDesignPointer(event.evt.currentTarget, event.evt.pointerId)
			return
		}
		const point = pagePoint(event)
		if (tool === "artboard") {
			beginArtboardGesture(event, point)
			return
		}
		if (tool === "rect" || tool === "ellipse") {
			beginVectorGesture(event, { tool })
			return
		}
		if (tool === "pen") {
			if (shouldCloseVectorPen(penPointsRef.current, point, worldScale)) {
				finishPen(true)
				return
			}
			beginVectorGesture(event, { tool: "pen" })
			return
		}
		if (tool === "direct") {
			const target = nearestDirectSelectionTarget(
				document,
				displayedObjects,
				point,
				worldScale,
				{
					contour: event.evt.altKey,
				},
			)
			if (target === null) {
				if (!gestureModifiers(event.evt).additive) {
					setSelection([])
					setDirectSelection([])
				}
				beginVectorGesture(event, { tool: "select", targetId: null })
			} else startDirectGesture(event, target)
			return
		}
		const hit = nearestDesignObject(
			displayedObjects,
			point,
			worldScale,
			tool === "select" || tool === "transform" ? 12 : 0,
		)
		if (hit === null)
			beginVectorGesture(event, { tool: "select", targetId: null })
		else startObjectGesture(event, hit.object)
	}

	const pointerMove = (event: KonvaEventObject<PointerEvent>): void => {
		const gesture = gestureRef.current
		if (gesture === null) return
		if (gesture.kind === "pan") {
			if (gesture.pointerId !== event.evt.pointerId) return
			const pointer = event.target.getStage()?.getPointerPosition()
			if (pointer === null || pointer === undefined) return
			setCanvasView({
				...gesture.original,
				x: gesture.original.x + pointer.x - gesture.start.x,
				y: gesture.original.y + pointer.y - gesture.start.y,
			})
			return
		}
		if (gesture.kind === "direct") {
			if (gesture.pointerId !== event.evt.pointerId) return
			const current = pagePoint(event)
			const preview = translateDirectSelection(
				gesture.original,
				gesture.selection,
				{
					x: current.x - gesture.start.x,
					y: current.y - gesture.start.y,
				},
			)
			const changed = preview.objects.filter(
				(object, index) => object !== gesture.original.objects[index],
			)
			previewObjectsRef.current = changed
			setPreviewObjects(changed)
			return
		}
		if (gesture.kind === "artboard") {
			if (gesture.pointerId !== event.evt.pointerId) return
			previewArtboardGesture(gesture, pagePoint(event))
			return
		}
		if (gesture.kind === "guide") {
			if (gesture.pointerId !== event.evt.pointerId) return
			const current = pagePoint(event)
			const value =
				gesture.value +
				(gesture.axis === "x"
					? current.x - gesture.start.x
					: current.y - gesture.start.y)
			gestureRef.current = { ...gesture, start: current, value }
			setGuidePreview({ id: gesture.id, value })
			return
		}
		if (gesture.state.pointerId !== event.evt.pointerId) return
		const transition = reduceVectorGesture(
			gesture.state,
			{
				type: "pointer-move",
				pointerId: event.evt.pointerId,
				pointer: gesturePointer(event),
			},
			gesturePolicy,
		)
		if (transition.state === null) return
		gestureRef.current = { ...gesture, state: transition.state }
		setGesturePreview(transition.preview)
		if (gesture.kind !== "move" && gesture.kind !== "transform") return
		const resolved = resolveDesignGestureObject(
			document,
			gesture,
			transition.preview,
			worldScale,
			snapSettings,
		)
		if (resolved === null) return
		previewObjectsRef.current = resolved.objects
		setPreviewObjects(resolved.objects)
		setActiveSnapGuides(designSnapGuides(resolved.snap, activeArtboard))
	}

	const pointerUp = (event: KonvaEventObject<PointerEvent>): void => {
		const gesture = gestureRef.current
		if (gesture === null) return
		if (gesture.kind === "pan") {
			if (gesture.pointerId !== event.evt.pointerId) return
			releaseDesignPointer(event.evt.currentTarget, event.evt.pointerId)
			gestureRef.current = null
			return
		}
		if (gesture.kind === "direct") {
			if (gesture.pointerId !== event.evt.pointerId) return
			releaseDesignPointer(event.evt.currentTarget, event.evt.pointerId)
			gestureRef.current = null
			const changed = previewObjectsRef.current
			previewObjectsRef.current = []
			setPreviewObjects([])
			if (changed.length > 0) {
				const byId = new Map(changed.map((object) => [object.id, object]))
				commit({
					...document,
					objects: document.objects.map(
						(object) => byId.get(object.id) ?? object,
					),
				})
				setStatus(`Edited ${directSelectionDescription(gesture.selection)}.`)
			}
			return
		}
		if (gesture.kind === "artboard") {
			if (gesture.pointerId !== event.evt.pointerId) return
			releaseDesignPointer(event.evt.currentTarget, event.evt.pointerId)
			gestureRef.current = null
			const preview = previewArtboardDocumentRef.current
			previewArtboardDocumentRef.current = null
			setPreviewArtboardDocument(null)
			if (preview !== null && preview !== document) {
				commit(preview)
				setActiveArtboardId(gesture.original.id)
				setStatus(
					gesture.mode === "create"
						? "Created an artboard."
						: `${gesture.mode === "move" ? "Moved" : "Resized"} ${gesture.original.name}.`,
				)
			} else if (gesture.mode !== "create")
				setStatus(`Selected ${gesture.original.name}.`)
			return
		}
		if (gesture.kind === "guide") {
			if (gesture.pointerId !== event.evt.pointerId) return
			releaseDesignPointer(event.evt.currentTarget, event.evt.pointerId)
			gestureRef.current = null
			setGuidePreview(null)
			commit(
				updateDesignGuide(gesture.original, gesture.id, {
					value: gesture.value,
				}),
			)
			setStatus(
				`Moved ${gesture.axis === "x" ? "vertical" : "horizontal"} guide to ${Number(gesture.value.toFixed(2))} pt.`,
			)
			return
		}
		if (gesture.state.pointerId !== event.evt.pointerId) return
		const transition = reduceVectorGesture(
			gesture.state,
			{
				type: "pointer-up",
				pointerId: event.evt.pointerId,
				pointer: gesturePointer(event, activeSnapGuides),
			},
			gesturePolicy,
		)
		releaseDesignPointer(event.evt.currentTarget, event.evt.pointerId)
		gestureRef.current = null
		setGesturePreview(null)
		setActiveSnapGuides([])
		if (transition.intent?.kind === "pen-node") {
			const intent = transition.intent
			const points = [
				...penPointsRef.current,
				{
					...intent.point,
					id: `point:${nextId()}`,
					...(intent.handles === null ? {} : intent.handles),
				},
			]
			penPointsRef.current = points
			setPenPoints(points)
			return
		}
		if (transition.intent?.kind === "shape") {
			const bounds = transition.intent.bounds
			const object: DesignObject = {
				id: `object:${nextId()}`,
				name: `${transition.intent.shape === "rect" ? "Rectangle" : "Ellipse"} ${document.objects.length + 1}`,
				geometry:
					transition.intent.shape === "rect"
						? {
								kind: "rectangle",
								x: bounds.minX,
								y: bounds.minY,
								width: bounds.maxX - bounds.minX,
								height: bounds.maxY - bounds.minY,
							}
						: {
								kind: "ellipse",
								centerX: (bounds.minX + bounds.maxX) / 2,
								centerY: (bounds.minY + bounds.maxY) / 2,
								radiusX: (bounds.maxX - bounds.minX) / 2,
								radiusY: (bounds.maxY - bounds.minY) / 2,
							},
				transform: IDENTITY_DESIGN_TRANSFORM,
				appearance: authoredAppearance,
			}
			commit({ ...document, objects: [...document.objects, object] })
			setSelection([object.id])
			setStatus(`Created ${object.name}.`)
			return
		}
		if (transition.intent?.kind === "select-marquee") {
			const intent = transition.intent
			if (tool === "direct") {
				const targets = marqueeDirectSelection(document, intent.bounds)
				setDirectSelection((current) => {
					const next = intent.additive
						? [
								...new Map(
									[...current, ...targets].map((target) => [
										directSelectionKey(target),
										target,
									]),
								).values(),
							]
						: targets
					setSelection([...new Set(next.map((target) => target.objectId))])
					return next
				})
				return
			}
			const ids = marqueeObjectIds(document.objects, intent.bounds)
			setSelection((current) =>
				intent.additive ? [...new Set([...current, ...ids])] : ids,
			)
			setDirectSelection([])
			return
		}
		const committedPreviews = previewObjectsRef.current
		previewObjectsRef.current = []
		if (committedPreviews.length > 0) {
			const byId = new Map(
				committedPreviews.map((object) => [object.id, object]),
			)
			commit({
				...document,
				objects: document.objects.map(
					(object) => byId.get(object.id) ?? object,
				),
			})
			setPreviewObjects([])
		}
	}
	const cancelPointer = useCallback(
		(pointerId: number, captureTarget: unknown): void => {
			const gesture = gestureRef.current
			if (gesture === null) return
			const activePointerId =
				gesture.kind === "pan" ||
				gesture.kind === "direct" ||
				gesture.kind === "artboard" ||
				gesture.kind === "guide"
					? gesture.pointerId
					: gesture.state.pointerId
			if (activePointerId !== pointerId) return
			if (
				gesture.kind !== "pan" &&
				gesture.kind !== "direct" &&
				gesture.kind !== "artboard" &&
				gesture.kind !== "guide"
			)
				reduceVectorGesture(
					gesture.state,
					{ type: "pointer-cancel", pointerId },
					gesturePolicy,
				)
			releaseDesignPointer(captureTarget, pointerId)
			gestureRef.current = null
			previewObjectsRef.current = []
			setPreviewObjects([])
			setGesturePreview(null)
			setActiveSnapGuides([])
			setPreviewArtboardDocument(null)
			previewArtboardDocumentRef.current = null
			setGuidePreview(null)
			if (gesture.kind === "vector" && gesture.state.tool === "pen") {
				penPointsRef.current = []
				setPenPoints([])
			}
		},
		[gesturePolicy],
	)
	const pointerCancel = (event: KonvaEventObject<PointerEvent>): void => {
		cancelPointer(event.evt.pointerId, event.evt.currentTarget)
	}
	useEffect(() => {
		const element = artboardWrapRef.current
		if (element === null) return
		const listener = (event: PointerEvent): void => {
			cancelPointer(event.pointerId, event.currentTarget)
		}
		element.addEventListener("pointercancel", listener, { capture: true })
		element.addEventListener("lostpointercapture", listener, { capture: true })
		return () => {
			element.removeEventListener("pointercancel", listener, { capture: true })
			element.removeEventListener("lostpointercapture", listener, {
				capture: true,
			})
		}
	}, [cancelPointer])

	const startScale = (
		handle: VectorTransformHandle,
		event: KonvaEventObject<PointerEvent>,
	): void => {
		if (
			selectedObjects.length === 0 ||
			selectedObjects.some((object) => object.locked || object.hidden)
		)
			return
		const bounds = combinedSelectionBounds(selectedObjects)
		if (bounds === null) return
		event.cancelBubble = true
		beginVectorGesture(
			event,
			{
				tool: "transform",
				targetId: selectedObjects[0]!.id,
				bounds,
				handle,
			},
			selectedObjects,
		)
	}

	const canvasDocument = previewArtboardDocument ?? document
	const canvasActiveArtboardId =
		gestureRef.current?.kind === "artboard" &&
		gestureRef.current.mode === "create"
			? gestureRef.current.original.id
			: activeArtboardId
	const canvasActiveArtboard = canvasDocument.artboards.find(
		({ id }) => id === canvasActiveArtboardId,
	)
	const previewById = new Map(
		previewObjects.map((object) => [object.id, object]),
	)
	const displayedObjects = canvasDocument.objects.map(
		(object) => previewById.get(object.id) ?? object,
	)
	const previewSwatch = document.swatches.find(
		(swatch) =>
			swatch.id ===
			(authoredAppearance.fill?.swatchId ??
				authoredAppearance.stroke?.swatchId),
	)
	const selectionBounds =
		(tool === "select" || tool === "transform") && selectedObjects.length > 0
			? combinedSelectionBounds(
					selectedObjects.map((object) => previewById.get(object.id) ?? object),
				)
			: null

	const recoverDraft = (): void => {
		const draft = persistence.recoveryDraft
		if (draft === null) return
		const revision = persistence.localRevision + 1
		serializedDocumentRef.current = JSON.stringify(draft.document)
		saveDocumentsRef.current.set(revision, draft.document)
		dispatch({ type: "reset", document: draft.document })
		setSelection([])
		dispatchPersistence({ type: "recover-draft" })
	}
	const discardDraft = (): void => {
		const storage = browserLocalStorage()
		if (storage !== null) clearDesignRecoveryDraft(storage)
		if (sourceSession === undefined)
			dispatchPersistence({ type: "discard-draft" })
		else void reloadExternal()
	}
	const reloadExternal = async (): Promise<void> => {
		if (sourceSession === undefined) return
		try {
			const update = await sourceSession.reload()
			if (!update.ok) {
				dispatchPersistence({
					type: "external-invalid",
					diagnostics: update.diagnostics,
				})
				return
			}
			serializedDocumentRef.current = JSON.stringify(update.document)
			dispatch({ type: "reset", document: update.document })
			setSelection([])
			const storage = browserLocalStorage()
			if (storage !== null) clearDesignRecoveryDraft(storage)
			dispatchPersistence({
				type: "external-loaded",
				durableRevision: update.revision,
			})
		} catch (error) {
			dispatchPersistence({
				type: "external-conflict",
				message:
					error instanceof Error
						? error.message
						: "Could not reload external source.",
			})
		}
	}
	const saveLocalCopy = (): void => {
		const url = URL.createObjectURL(
			new Blob([JSON.stringify(document, null, 2)], {
				type: "application/json",
			}),
		)
		const link = window.document.createElement("a")
		link.href = url
		link.download = `${document.title.replaceAll(/[^a-z0-9]+/gi, "-").replaceAll(/^-|-$/g, "") || "untitled"}-conflicted-copy.json`
		link.click()
		URL.revokeObjectURL(url)
	}

	return (
		<design-application className={css.class}>
			<header>
				<brand-lockup>
					<svg viewBox="0 0 28 28" aria-hidden="true">
						<path d="M4 4h20v20H4z" />
						<circle cx="18" cy="10" r="5" />
					</svg>
					<strong>create-design</strong>
					<span>PDF proof of concept</span>
				</brand-lockup>
				<label>
					<span data-screen-reader>Document title</span>
					<input
						value={document.title}
						onInput={(event) =>
							commit({ ...document, title: event.currentTarget.value })
						}
					/>
				</label>
				<header-actions>
					<button
						type="button"
						data-command-trigger
						onClick={() => setPaletteOpen(true)}
					>
						Commands <kbd>⇧⌘P</kbd>
					</button>
					<button type="button" data-export onClick={() => exportDocument()}>
						<svg.DownloadIcon aria-hidden="true" /> Export PDF
					</button>
				</header-actions>
			</header>

			<main>
				{sourceSession === undefined ||
				(persistence.status !== "recoverable-draft" &&
					persistence.status !== "conflicted" &&
					persistence.status !== "invalid-external-source") ? null : (
					<persistence-alert role="region" aria-label="Document recovery">
						<strong>{persistenceLabel(persistence)}</strong>
						{persistence.status !== "invalid-external-source" ? null : (
							<ul>
								{persistence.diagnostics.map((diagnostic) => (
									<li key={`${diagnostic.unitPath}:${diagnostic.path}`}>
										<code>
											{diagnostic.unitPath ?? "source"} {diagnostic.path}
										</code>
										: {diagnostic.message}
									</li>
								))}
							</ul>
						)}
						<alert-actions>
							{persistence.status !== "recoverable-draft" ? null : (
								<>
									<button type="button" onClick={recoverDraft}>
										Recover draft
									</button>
									<button type="button" onClick={discardDraft}>
										Discard draft
									</button>
								</>
							)}
							{persistence.status !== "conflicted" ? null : (
								<button
									type="button"
									onClick={() => dispatchPersistence({ type: "retry" })}
								>
									Retry save
								</button>
							)}
							{persistence.status === "recoverable-draft" ? null : (
								<>
									<button type="button" onClick={() => void reloadExternal()}>
										Reload external source
									</button>
									<button type="button" onClick={saveLocalCopy}>
										{persistence.status === "conflicted"
											? "Save conflicted copy"
											: "Save local copy"}
									</button>
								</>
							)}
						</alert-actions>
					</persistence-alert>
				)}
				<design-canvas>
					<canvas-meta>
						<span>{DESIGN_TOOLS[tool].label}</span>
						<span>
							{activeArtboard.width} × {activeArtboard.height} pt ·{" "}
							{Math.round(canvasView.zoom * 100)}%
						</span>
					</canvas-meta>
					<artboard-wrap
						ref={artboardWrapRef}
						role="application"
						aria-label="Design artboard"
						aria-describedby="design-selection-status"
						tabIndex={-1}
					>
						<span
							id="design-selection-status"
							data-screen-reader
							aria-live="polite"
						>
							{tool === "direct"
								? directSelectionDescription(directSelection)
								: selection.length === 0
									? "No objects selected."
									: `${selection.length} object${selection.length === 1 ? "" : "s"} selected.`}
						</span>
						<ruler-corner aria-hidden="true" />
						<ruler-horizontal
							role="button"
							tabIndex={0}
							aria-label="Horizontal ruler; click to create a vertical guide"
							onPointerDown={(event: PointerEvent) =>
								createGuideFromRuler("x", event)
							}
						>
							{horizontalRulerTicks.map((tick) => (
								<i
									key={tick.value}
									data-major={tick.major || undefined}
									style={{ left: canvasView.x + tick.value * worldScale - 20 }}
								>
									{tick.major ? Number(tick.value.toFixed(2)) : ""}
								</i>
							))}
						</ruler-horizontal>
						<ruler-vertical
							role="button"
							tabIndex={0}
							aria-label="Vertical ruler; click to create a horizontal guide"
							onPointerDown={(event: PointerEvent) =>
								createGuideFromRuler("y", event)
							}
						>
							{verticalRulerTicks.map((tick) => (
								<i
									key={tick.value}
									data-major={tick.major || undefined}
									style={{ top: canvasView.y + tick.value * worldScale - 20 }}
								>
									{tick.major ? Number(tick.value.toFixed(2)) : ""}
								</i>
							))}
						</ruler-vertical>
						<div.Stage
							width={canvasViewport.width}
							height={canvasViewport.height}
							style={{
								cursor: canvasToolCursor(
									tool === "direct"
										? "select"
										: tool === "artboard"
											? "rect"
											: tool,
									{
										dragging: gestureRef.current?.kind === "pan",
									},
								),
							}}
							onPointerDown={pointerDown}
							onPointerMove={pointerMove}
							onPointerUp={pointerUp}
							onPointerCancel={pointerCancel}
							onLostPointerCapture={pointerCancel}
							onWheel={(event: KonvaEventObject<WheelEvent>) => {
								event.evt.preventDefault()
								const pointer =
									event.target.getStage()?.getPointerPosition() ?? null
								if (pointer === null) return
								setCanvasView((current) =>
									reduceCanvasWheel(current, event.evt, pointer, viewOptions),
								)
							}}
						>
							<Layer>
								<Group
									x={canvasView.x}
									y={canvasView.y}
									scaleX={worldScale}
									scaleY={worldScale}
								>
									{canvasDocument.artboards.map((artboard) => (
										<Rect
											key={artboard.id}
											name={`design-paper ${artboard.id}`}
											x={artboard.x}
											y={artboard.y}
											width={artboard.width}
											height={artboard.height}
											fill="#fff"
											shadowColor="#000"
											shadowBlur={24 / worldScale}
											shadowOpacity={0.36}
											shadowOffsetY={9 / worldScale}
											stroke={
												artboard.id === canvasActiveArtboardId
													? "#e17352"
													: "#8e8c85"
											}
											strokeWidth={
												(artboard.id === canvasActiveArtboardId ? 2 : 1) /
												worldScale
											}
											dash={
												artboard.id === canvasActiveArtboardId
													? []
													: [4 / worldScale, 4 / worldScale]
											}
										/>
									))}
									{tool !== "artboard" || canvasActiveArtboard === undefined
										? null
										: (
												[
													[canvasActiveArtboard.x, canvasActiveArtboard.y],
													[
														canvasActiveArtboard.x + canvasActiveArtboard.width,
														canvasActiveArtboard.y,
													],
													[
														canvasActiveArtboard.x,
														canvasActiveArtboard.y +
															canvasActiveArtboard.height,
													],
													[
														canvasActiveArtboard.x + canvasActiveArtboard.width,
														canvasActiveArtboard.y +
															canvasActiveArtboard.height,
													],
												] as const
											).map(([x, y], index) => (
												<Rect
													key={`artboard-handle:${index}`}
													name="design-artboard-handle"
													x={x - 4 / worldScale}
													y={y - 4 / worldScale}
													width={8 / worldScale}
													height={8 / worldScale}
													fill="#fff"
													stroke="#e17352"
													strokeWidth={1 / worldScale}
													listening={false}
												/>
											))}
									{displayedObjects.map((object) => {
										const fill = document.swatches.find(
											(candidate) =>
												candidate.id === object.appearance.fill?.swatchId,
										)
										const stroke = document.swatches.find(
											(candidate) =>
												candidate.id === object.appearance.stroke?.swatchId,
										)
										const strokeStyle = object.appearance.stroke
										return object.hidden ||
											((fill === undefined ||
												object.appearance.fill === undefined) &&
												(stroke === undefined ||
													strokeStyle === undefined ||
													strokeStyle.width === 0)) ? null : (
											<VectorContourPath
												key={object.id}
												name={`design-object ${object.id}`}
												object={projectDesignVectorObject(
													canvasDocument,
													object,
												)}
												{...(fill === undefined
													? {}
													: { fill: swatchCss(fill) })}
												fillEnabled={fill !== undefined}
												{...(stroke === undefined ||
												strokeStyle === undefined ||
												strokeStyle.width === 0
													? {}
													: {
															stroke: swatchCss(stroke),
															strokeWidth: strokeStyle.width,
															lineCap: strokeStyle.cap,
															lineJoin: strokeStyle.join,
															miterLimit: strokeStyle.miterLimit,
															dash: [...strokeStyle.dashArray],
															dashOffset: strokeStyle.dashOffset,
														})}
												fillRule="evenodd"
												selected={selection.includes(object.id)}
												onPointerDown={(event) =>
													startObjectGesture(event, object)
												}
												onPointerEnter={(event) => {
													if (
														object.locked ||
														(tool !== "select" &&
															tool !== "direct" &&
															tool !== "transform")
													)
														return
													const container = event.target.getStage()?.container()
													if (container !== undefined)
														container.style.cursor = canvasToolCursor(
															tool === "direct" ? "select" : tool,
															{
																overObject: true,
															},
														)
												}}
												onPointerLeave={(event) => {
													const container = event.target.getStage()?.container()
													if (container !== undefined)
														container.style.cursor = canvasToolCursor(
															tool === "direct"
																? "select"
																: tool === "artboard"
																	? "rect"
																	: tool,
														)
												}}
											/>
										)
									})}
									{document.guides.map((guide) => {
										const value =
											guidePreview !== null && guidePreview.id === guide.id
												? guidePreview.value
												: guide.value
										return (
											<Line
												key={guide.id}
												name={`design-guide ${guide.id}`}
												points={
													guide.axis === "x"
														? [
																value,
																visibleDocumentBounds.minY,
																value,
																visibleDocumentBounds.maxY,
															]
														: [
																visibleDocumentBounds.minX,
																value,
																visibleDocumentBounds.maxX,
																value,
															]
												}
												stroke={
													selectedGuideId === guide.id ? "#e17352" : "#36a8e0"
												}
												strokeWidth={1 / worldScale}
												{...(guide.locked
													? { dash: [4 / worldScale, 3 / worldScale] }
													: {})}
												hitStrokeWidth={12 / worldScale}
												onPointerDown={(event) =>
													startGuideGesture(event, guide)
												}
												onDblClick={(event) => {
													event.cancelBubble = true
													commit(
														updateDesignGuide(document, guide.id, {
															locked: !guide.locked,
														}),
													)
													setStatus(
														guide.locked ? "Guide unlocked." : "Guide locked.",
													)
												}}
											/>
										)
									})}
									{tool !== "direct"
										? null
										: selectedObjects.flatMap((selected) => {
												const object = previewById.get(selected.id) ?? selected
												if (
													object.hidden ||
													object.locked ||
													object.geometry.kind !== "path"
												)
													return []
												return projectDesignVectorObject(
													document,
													object,
												).contours.flatMap((contour) =>
													contour.nodes.map((node, nodeIndex) => {
														const nodeTarget = {
															kind: "node" as const,
															objectId: object.id,
															contourId: contour.id,
															pointId: node.id,
														}
														const selectedHandles = (
															["incoming", "outgoing"] as const
														).filter((handle) =>
															directSelection.some(
																(target) =>
																	target.kind === "handle" &&
																	target.objectId === object.id &&
																	target.contourId === contour.id &&
																	target.pointId === node.id &&
																	target.handle === handle,
															),
														)
														return (
															<VectorControlHandles
																key={`${object.id}:${node.id}`}
																node={node}
																inverseScale={1 / worldScale}
																color="#e17352"
																listening
																nodeHitRadius={9 / worldScale}
																handleHitRadius={{
																	incoming: 9 / worldScale,
																	outgoing: 9 / worldScale,
																}}
																selected={directSelection.some(
																	(target) =>
																		target.objectId === object.id &&
																		target.contourId === contour.id &&
																		(target.kind === "contour" ||
																			(target.kind === "node" &&
																				target.pointId === node.id) ||
																			(target.kind === "segment" &&
																				(target.segmentIndex === nodeIndex ||
																					(target.segmentIndex + 1) %
																						contour.nodes.length ===
																						nodeIndex))),
																)}
																selectedHandles={selectedHandles}
																onNodePointerDown={(event) =>
																	startDirectGesture(event, nodeTarget)
																}
																onHandlePointerDown={(handle, event) =>
																	startDirectGesture(event, {
																		kind: "handle",
																		objectId: object.id,
																		contourId: contour.id,
																		pointId: node.id,
																		handle,
																	})
																}
															/>
														)
													}),
												)
											})}
									{gesturePreview?.kind !== "shape" ? null : (
										<VectorShapePreview
											preview={gesturePreview}
											inverseScale={1 / worldScale}
											color="#e17352"
											{...(previewSwatch === undefined
												? {}
												: { fill: swatchCss(previewSwatch) })}
										/>
									)}
									{gesturePreview?.kind === "pen" ? (
										<VectorPenPreview
											preview={gesturePreview}
											preceding={penPoints}
											inverseScale={1 / worldScale}
											color="#e17352"
										/>
									) : penPoints.length === 0 ? null : (
										<VectorPenPreview
											preview={{
												kind: "pen",
												point: penPoints.at(-1)!,
												mode:
													penPoints.at(-1)?.incoming === undefined &&
													penPoints.at(-1)?.outgoing === undefined
														? "hard"
														: "soft",
												handles: {
													...(penPoints.at(-1)?.incoming === undefined
														? {}
														: { incoming: penPoints.at(-1)!.incoming }),
													...(penPoints.at(-1)?.outgoing === undefined
														? {}
														: { outgoing: penPoints.at(-1)!.outgoing }),
												},
												distancePixels: 0,
												snaps: [],
											}}
											preceding={penPoints.slice(0, -1)}
											inverseScale={1 / worldScale}
											color="#e17352"
										/>
									)}
									<VectorSnapGuides
										guides={activeSnapGuides}
										inverseScale={1 / worldScale}
										color="#36a8e0"
									/>
									{gesturePreview?.kind === "select-marquee" ? (
										<VectorSelectionBounds
											bounds={gesturePreview.bounds}
											inverseScale={1 / worldScale}
											color="#e17352"
											handles={[]}
										/>
									) : null}
									{selectionBounds === null ? null : (
										<VectorSelectionBounds
											bounds={selectionBounds}
											inverseScale={1 / worldScale}
											color="#e17352"
											rotation={tool === "transform"}
											{...(tool === "transform"
												? { onHandlePointerDown: startScale }
												: { handles: [], listening: false })}
										/>
									)}
								</Group>
							</Layer>
						</div.Stage>
					</artboard-wrap>
					<canvas-hint>
						{tool === "pen"
							? "Click for corners · Drag for curves · Click start to close · Enter finishes open · Esc cancels"
							: tool === "rect" || tool === "ellipse"
								? "Drag to draw · Shift constrains · Alt draws from center"
								: "Drag objects to move · F shows transform handles"}
					</canvas-hint>
				</design-canvas>
				<TilingWorkspace
					context={designTileContext}
					registry={DESIGN_TILE_REGISTRY}
					defaultLayout={DEFAULT_DESIGN_TILING_LAYOUT}
					storageKey={DESIGN_TILING_STORAGE_KEY}
					commandRequest={tileCommandRequest}
					enabled={!paletteOpen}
				/>
			</main>

			<footer>
				<span>{status}</span>
				<span role="status" aria-live="polite" aria-atomic="true">
					{persistenceLabel(persistence)}
				</span>
				<span>
					{document.objects.length} objects · {document.swatches.length}{" "}
					swatches
				</span>
			</footer>

			{paletteOpen ? (
				<CommandPalette
					commands={commands}
					onCancel={() => setPaletteOpen(false)}
					onExecute={(command) => {
						command.do()
						setPaletteOpen(false)
					}}
					onAssign={() => {
						setStatus("Hotbar assignment is reserved for the full workspace.")
					}}
				/>
			) : null}
		</design-application>
	)
}
