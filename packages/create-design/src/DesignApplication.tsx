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
import type { ComponentChildren } from "preact"

import { readDesignClipboard, writeDesignClipboard } from "./clipboard.ts"
import { swatchCss } from "./color.ts"
import {
	createInitialDocument,
	DESIGN_STORAGE_KEY,
	parseDesignDocument,
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
	clampToPage,
	DESIGN_MAX_ZOOM,
	DESIGN_MIN_ZOOM,
	designBaseScale,
	initialDesignCanvasView,
	nearestDesignObject,
	releaseDesignPointer,
	snapDesignObject,
} from "./design-canvas.ts"
import {
	createDesignHistory,
	reduceDesignHistory,
	type DesignHistory,
} from "./design-history.ts"
import { createDesignPenObject } from "./design-pen.ts"
import { DESIGN_TOOLS } from "./design-tools.ts"
import css from "./DesignApplication.module.css"
import {
	IDENTITY_DESIGN_TRANSFORM,
	objectBounds,
	rotateObject,
	scaleObject,
	translateObject,
} from "./geometry.ts"
import {
	applyDesignVectorIntent,
	designVectorAdapter,
	importDesignVectorClipboard,
	importDesignObjects,
	projectDesignVectorObject,
} from "./design-vector-adapter.ts"
import { downloadPdf } from "./pdf.ts"
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
	DesignDocument,
	DesignObject,
	DesignPoint,
	DesignSwatch,
	DesignTool,
} from "./types.ts"

const svg = {
	DownloadIcon,
}
const div = {
	Stage,
}

type CanvasGesture =
	| {
			readonly kind: "move"
			readonly original: DesignObject
			readonly state: VectorGestureState
	  }
	| {
			readonly kind: "pan"
			readonly pointerId: number
			readonly start: DesignPoint
			readonly original: Readonly<{ x: number; y: number; zoom: number }>
	  }
	| {
			readonly kind: "vector"
			readonly state: VectorGestureState
	  }
	| {
			readonly kind: "transform"
			readonly original: DesignObject
			readonly state: VectorGestureState
	  }

type DesignObjectGesture = Extract<
	CanvasGesture,
	{ readonly kind: "move" | "transform" }
>

interface DesignGestureObjectPreview {
	readonly object: DesignObject
	readonly snap: {
		readonly x: number | null
		readonly y: number | null
	}
}

function resolveDesignGestureObject(
	document: DesignDocument,
	gesture: DesignObjectGesture,
	preview: VectorGesturePreview | null,
	worldScale: number,
): DesignGestureObjectPreview | null {
	if (gesture.kind === "move" && preview?.kind === "select-move") {
		const rawObject = translateObject(
			gesture.original,
			preview.delta.x,
			preview.delta.y,
		)
		const snapped = snapDesignObject(rawObject, document, worldScale)
		return {
			object: snapped.object,
			snap: { x: snapped.x, y: snapped.y },
		}
	}
	if (gesture.kind !== "transform" || preview?.kind !== "transform") return null
	const transformed =
		preview.handle === "rotation"
			? rotateObject(
					gesture.original,
					preview.anchor,
					preview.rotationDegrees,
				)
			: preview.handle === "move"
				? translateObject(
						gesture.original,
						preview.delta.x,
						preview.delta.y,
					)
				: scaleObject(
						gesture.original,
						preview.anchor,
						preview.scale.x,
						preview.scale.y,
					)
	return {
		object: transformed,
		snap: { x: null, y: null },
	}
}

function designSnapGuides(
	snap: Readonly<{ x: number | null; y: number | null }>,
	page: Readonly<{ width: number; height: number }>,
): readonly VectorSnapGuide[] {
	return [
		...(snap.x === null
			? []
			: [
					{
						id: `design-snap-x:${snap.x}`,
						axis: "x" as const,
						points: [snap.x, 0, snap.x, page.height] as const,
					},
				]),
		...(snap.y === null
			? []
			: [
					{
						id: `design-snap-y:${snap.y}`,
						axis: "y" as const,
						points: [0, snap.y, page.width, snap.y] as const,
					},
				]),
	]
}

function initialHistory(initialDocument?: DesignDocument): DesignHistory {
	let document = initialDocument ?? createInitialDocument()
	if (initialDocument !== undefined) return createDesignHistory(initialDocument)
	const storage = browserLocalStorage()
	if (storage !== null)
		document =
			parseDesignDocument(storage.getItem(DESIGN_STORAGE_KEY)) ?? document
	return createDesignHistory(document)
}

function browserLocalStorage(): Storage | null {
	try {
		return typeof localStorage === "undefined" ? null : localStorage
	} catch {
		return null
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
	const [history, dispatch] = useReducer(
		reduceDesignHistory,
		initialDocument,
		initialHistory,
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
	const [currentSwatchId, setCurrentSwatchId] = useState("swatch:coral")
	const [selectedSwatchId, setSelectedSwatchId] = useState("swatch:coral")
	const [paletteOpen, setPaletteOpen] = useState(false)
	const [tileCommandRequest, setTileCommandRequest] =
		useState<TileCommandRequest<DesignTileKind> | null>(null)
	const [status, setStatus] = useState(
		"Ready — draw a shape or press ⇧⌘P for commands.",
	)
	const [previewObject, setPreviewObject] = useState<DesignObject | null>(null)
	const [gesturePreview, setGesturePreview] =
		useState<VectorGesturePreview | null>(null)
	const [penPoints, setPenPoints] = useState<readonly DesignPoint[]>([])
	const [canvasViewport, setCanvasViewport] = useState({
		width: 0,
		height: 0,
	})
	const [canvasView, setCanvasView] = useState({ x: 0, y: 0, zoom: 1 })
	const [activeSnapGuides, setActiveSnapGuides] = useState<
		readonly VectorSnapGuide[]
	>([])
	const artboardWrapRef = useRef<HTMLElement>(null)
	const gestureRef = useRef<CanvasGesture | null>(null)
	const penPointsRef = useRef<readonly DesignPoint[]>([])
	const previewObjectRef = useRef<DesignObject | null>(null)
	const documentRef = useRef(document)
	const persistenceRef = useRef(persistence)
	const serializedDocumentRef = useRef(JSON.stringify(document))
	const saveDocumentsRef = useRef(new Map<number, DesignDocument>())
	const sequence = useRef(0)
	const tileCommandSequence = useRef(0)
	const nextId = useCallback(() => {
		sequence.current += 1
		return `${Date.now().toString(36)}:${sequence.current.toString(36)}`
	}, [])
	documentRef.current = document
	persistenceRef.current = persistence
	const selectedObject =
		document.objects.find((object) => selection.includes(object.id)) ?? null
	const selectedSwatch =
		document.swatches.find((swatch) => swatch.id === selectedSwatchId) ??
		document.swatches[0]
	const baseScale = designBaseScale(canvasViewport, document.page)
	const viewOptions = useMemo(
		() => ({
			baseScale,
			minZoom: DESIGN_MIN_ZOOM,
			maxZoom: DESIGN_MAX_ZOOM,
		}),
		[baseScale],
	)
	const worldScale = canvasScale(canvasView, viewOptions)
	const gesturePolicy = useMemo(
		() => ({ yAxis: "down" as const, rotationSnapDegrees: 15 }),
		[],
	)

	const commit = useCallback((next: DesignDocument): void => {
		dispatch({ type: "commit", document: next })
	}, [])
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
		(event: KonvaEventObject<PointerEvent | MouseEvent>): DesignPoint => {
			const pointer = event.target.getStage()?.getPointerPosition() ?? {
				x: 0,
				y: 0,
			}
			return clampToPage(
				screenToDocument(pointer, canvasView, viewOptions),
				document.page,
			)
		},
		[canvasView, document.page, viewOptions],
	)

	const cancelCanvasGesture = useCallback((): void => {
		const gesture = gestureRef.current
		if (gesture !== null && gesture.kind !== "pan")
			reduceVectorGesture(
				gesture.state,
				{
					type: "pointer-cancel",
					pointerId: gesture.state.pointerId,
				},
				gesturePolicy,
			)
		gestureRef.current = null
		previewObjectRef.current = null
		penPointsRef.current = []
		setPreviewObject(null)
		setGesturePreview(null)
		setPenPoints([])
		setActiveSnapGuides([])
	}, [gesturePolicy])

	const selectTool = useCallback(
		(nextTool: DesignTool): void => {
			cancelCanvasGesture()
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

	const finishPen = useCallback(
		(closed = false): void => {
			const points = penPointsRef.current
			const object = createDesignPenObject({
				id: `object:${nextId()}`,
				name: `Pen path ${document.objects.length + 1}`,
				fillId: currentSwatchId,
				points,
				closed,
			})
			if (object === null) {
				cancelCanvasGesture()
				return
			}
			if (
				!commitVectorIntent({
					kind: "create-object",
					object: projectDesignVectorObject(document, object),
				})
			)
				return
			penPointsRef.current = []
			setPenPoints([])
			setGesturePreview(null)
			gestureRef.current = null
			setStatus(
				`Created ${closed ? "closed" : "open"} ${object.name.toLowerCase()}.`,
			)
		},
		[
			cancelCanvasGesture,
			commitVectorIntent,
			currentSwatchId,
			document,
			nextId,
		],
	)

	const exportDocument = useCallback((): void => {
		downloadPdf(document)
		setStatus(
			`Exported ${document.title}.pdf with ${document.objects.length} vector objects.`,
		)
	}, [document])

	const setObjectProperty = (
		object: DesignObject,
		property: Partial<DesignObject>,
	): void => {
		if (property.appearance?.fill !== undefined) {
			const swatch = document.swatches.find(
				(candidate) =>
					candidate.id === property.appearance?.fill?.swatchId,
			)
			if (swatch !== undefined)
				commitVectorIntent({
					kind: "set-style",
					objectId: object.id,
					style: projectDesignVectorObject(document, {
						...object,
						appearance: {
							...object.appearance,
							fill: { swatchId: swatch.id },
						},
					}).style,
				})
			return
		}
		commitVectorIntent({
			kind: "set-object-properties",
			objectId: object.id,
			...(property.name === undefined ? {} : { name: property.name }),
			...(property.hidden === undefined ? {} : { hidden: property.hidden }),
			...(property.locked === undefined ? {} : { locked: property.locked }),
		})
	}

	const updateSwatch = (swatch: DesignSwatch): void => {
		commit({
			...document,
			swatches: document.swatches.map((candidate) =>
				candidate.id === swatch.id ? swatch : candidate,
			),
		})
	}

	const addSwatch = (): void => {
		const swatch: DesignSwatch = {
			id: `swatch:${nextId()}`,
			name: `Color ${document.swatches.length + 1}`,
			source: { space: "rgb", r: 128, g: 128, b: 128 },
		}
		commit({ ...document, swatches: [...document.swatches, swatch] })
		setSelectedSwatchId(swatch.id)
		setCurrentSwatchId(swatch.id)
	}

	const designTileContext: DesignTileContext = {
		addSwatch,
		deleteSelection,
		document,
		exportDocument,
		focusCanvas: () => artboardWrapRef.current?.focus(),
		selectObject: (object) => setSelection([object.id]),
		selectSwatch: (swatch) => {
			setSelectedSwatchId(swatch.id)
			setCurrentSwatchId(swatch.id)
			if (selectedObject !== null)
				setObjectProperty(selectedObject, {
					appearance: {
						...selectedObject.appearance,
						fill: { swatchId: swatch.id },
					},
				})
		},
		selectTool,
		selectedObject,
		selectedSwatch,
		selectedSwatchId,
		setObjectProperty,
		tool,
		updateSwatch,
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
				do: () => dispatch({ type: "undo" }),
			},
			{
				id: "redo",
				displayName: "Redo",
				category: "Edit",
				icon: "DoubleArrowRightIcon",
				shortcut: "⇧⌘ Z",
				disabled: history.future.length === 0,
				do: () => dispatch({ type: "redo" }),
			},
			...tileRegistryCommands(DESIGN_TILE_REGISTRY, designTileContext).map(
				(command): PaletteCommand => ({
					...command,
					do: () => {
						tileCommandSequence.current += 1
						setTileCommandRequest({
							id: tileCommandSequence.current,
							kind: command.kind,
						})
					},
				}),
			),
		],
		[
			deleteSelection,
			exportDocument,
			history.future.length,
			history.past.length,
			selectTool,
			selection.length,
			selectedObject?.id,
			selectedSwatchId,
			tool,
			document,
		],
	)

	useEffect(() => {
		const serialized = JSON.stringify(document)
		if (serialized === serializedDocumentRef.current) {
			if (sourceSession === undefined)
				browserLocalStorage()?.setItem(DESIGN_STORAGE_KEY, serialized)
			window.document.title = `${history.present.title} — create-design`
			return
		}
		serializedDocumentRef.current = serialized
		if (sourceSession === undefined) {
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
		setCanvasView(initialDesignCanvasView(canvasViewport, document.page))
	}, [canvasViewport.height, canvasViewport.width, document.page])

	useEffect(() => {
		const updateGestureModifiers = (event: KeyboardEvent): void => {
			if (event.key !== "Shift" && event.key !== "Alt") return
			const gesture = gestureRef.current
			if (gesture === null || gesture.kind === "pan") return
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
				)
				if (resolved !== null) {
					previewObjectRef.current = resolved.object
					setPreviewObject(resolved.object)
					setActiveSnapGuides(designSnapGuides(resolved.snap, document.page))
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
			if (mod && event.key.toLowerCase() === "e") {
				event.preventDefault()
				exportDocument()
				return
			}
			if (mod && event.key.toLowerCase() === "z") {
				event.preventDefault()
				dispatch({ type: event.shiftKey ? "redo" : "undo" })
				return
			}
			if (event.key === "Enter" && tool === "pen") {
				event.preventDefault()
				finishPen()
				return
			}
			if (event.key === "Escape") {
				cancelCanvasGesture()
				return
			}
			if (event.key === "Backspace" || event.key === "Delete") {
				if (tool === "pen" && penPoints.length > 0) {
					event.preventDefault()
					const points = penPointsRef.current.slice(0, -1)
					penPointsRef.current = points
					setPenPoints(points)
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
		cancelCanvasGesture,
		document,
		exportDocument,
		finishPen,
		gesturePolicy,
		paletteOpen,
		penPoints.length,
		selectTool,
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
			const vector = readVectorClipboard(event.clipboardData)
			if (vector !== null) {
				const result = importDesignVectorClipboard(
					document,
					selection,
					vector,
					nextId,
					currentSwatchId,
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
			const addition = readDesignClipboard(
				event.clipboardData,
				document,
				nextId,
			)
			if (addition === null || addition.objects.length === 0) return
			const result = importDesignObjects(document, selection, addition)
			if (!result.ok) {
				setStatus(result.error)
				return
			}
			event.preventDefault()
			commit(result.document)
			setSelection(result.selection)
			setStatus(
				`Pasted ${addition.objects.length} vector object${addition.objects.length === 1 ? "" : "s"}.`,
			)
		}
		window.addEventListener("copy", copy)
		window.addEventListener("paste", paste)
		return () => {
			window.removeEventListener("copy", copy)
			window.removeEventListener("paste", paste)
		}
	}, [commit, currentSwatchId, document, nextId, selection])

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
		original?: DesignObject,
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
			original === undefined
				? { kind: "vector", state: transition.state }
				: down.tool === "transform"
					? { kind: "transform", original, state: transition.state }
					: { kind: "move", original, state: transition.state }
		setGesturePreview(transition.preview)
		captureDesignPointer(event.evt.currentTarget, event.evt.pointerId)
	}

	const startObjectGesture = (
		event: KonvaEventObject<PointerEvent>,
		object: DesignObject,
	): void => {
		if (object.locked || (tool !== "select" && tool !== "transform")) return
		event.cancelBubble = true
		setSelection([object.id])
		beginVectorGesture(event, { tool: "select", targetId: object.id }, object)
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
		const hit = nearestDesignObject(
			previewObjects,
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
		)
		if (resolved === null) return
		previewObjectRef.current = resolved.object
		setPreviewObject(resolved.object)
		setActiveSnapGuides(designSnapGuides(resolved.snap, document.page))
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
				appearance: { fill: { swatchId: currentSwatchId } },
			}
			commit({ ...document, objects: [...document.objects, object] })
			setSelection([object.id])
			setStatus(`Created ${object.name}.`)
			return
		}
		if (transition.intent?.kind === "select-marquee") {
			const intent = transition.intent
			const ids = document.objects.flatMap((object) => {
				const bounds = objectBounds(object)
				if (bounds === null) return []
				const intersects =
					bounds.maxX >= intent.bounds.minX &&
					bounds.minX <= intent.bounds.maxX &&
					bounds.maxY >= intent.bounds.minY &&
					bounds.minY <= intent.bounds.maxY
				return intersects ? [object.id] : []
			})
			setSelection((current) =>
				intent.additive ? [...new Set([...current, ...ids])] : ids,
			)
			return
		}
		const committedPreview = previewObjectRef.current
		previewObjectRef.current = null
		if (committedPreview !== null) {
			commit({
				...document,
				objects: document.objects.map((object) =>
					object.id === committedPreview.id ? committedPreview : object,
				),
			})
			setPreviewObject(null)
		}
	}
	const cancelPointer = useCallback(
		(pointerId: number, captureTarget: unknown): void => {
			const gesture = gestureRef.current
			if (gesture === null) return
			const activePointerId =
				gesture.kind === "pan" ? gesture.pointerId : gesture.state.pointerId
			if (activePointerId !== pointerId) return
			if (gesture.kind !== "pan")
				reduceVectorGesture(
					gesture.state,
					{ type: "pointer-cancel", pointerId },
					gesturePolicy,
				)
			releaseDesignPointer(captureTarget, pointerId)
			gestureRef.current = null
			previewObjectRef.current = null
			setPreviewObject(null)
			setGesturePreview(null)
			setActiveSnapGuides([])
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
		if (selectedObject === null) return
		const bounds = objectBounds(selectedObject)
		if (bounds === null) return
		event.cancelBubble = true
		beginVectorGesture(
			event,
			{
				tool: "transform",
				targetId: selectedObject.id,
				bounds,
				handle,
			},
			selectedObject,
		)
	}

	const previewObjects =
		previewObject === null
			? document.objects
			: document.objects.map((object) =>
					object.id === previewObject.id ? previewObject : object,
				)
	const currentSwatch =
		document.swatches.find((swatch) => swatch.id === currentSwatchId) ??
		document.swatches[0]
	const selectionBounds =
		tool === "transform" && selectedObject !== null
			? objectBounds(previewObject ?? selectedObject)
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
					<button type="button" data-export onClick={exportDocument}>
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
						<span>612 × 792 pt · {Math.round(canvasView.zoom * 100)}%</span>
					</canvas-meta>
					<artboard-wrap
						ref={artboardWrapRef}
						role="application"
						aria-label="Design artboard"
						tabIndex={-1}
					>
						<div.Stage
							width={canvasViewport.width}
							height={canvasViewport.height}
							style={{
								cursor: canvasToolCursor(tool, {
									dragging: gestureRef.current?.kind === "pan",
								}),
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
									clipX={-30 / worldScale}
									clipY={-30 / worldScale}
									clipWidth={document.page.width + 60 / worldScale}
									clipHeight={document.page.height + 60 / worldScale}
								>
									<Rect
										name="design-paper"
										width={document.page.width}
										height={document.page.height}
										fill="#fff"
										shadowColor="#000"
										shadowBlur={24 / worldScale}
										shadowOpacity={0.36}
										shadowOffsetY={9 / worldScale}
									/>
									{previewObjects.map((object) => {
										const fill = document.swatches.find(
											(candidate) =>
												candidate.id === object.appearance.fill?.swatchId,
										)
										const stroke = document.swatches.find(
											(candidate) =>
												candidate.id === object.appearance.stroke?.swatchId,
										)
										return object.hidden ||
											(fill === undefined && stroke === undefined) ? null : (
											<VectorContourPath
												key={object.id}
												name={`design-object ${object.id}`}
												object={projectDesignVectorObject(document, object)}
												{...(fill === undefined
													? {}
													: { fill: swatchCss(fill) })}
												fillEnabled={fill !== undefined}
												{...(stroke === undefined
													? {}
													: {
															stroke: swatchCss(stroke),
															strokeWidth:
																object.appearance.stroke?.width ?? 0,
														})}
												fillRule="evenodd"
												onPointerDown={(event) =>
													startObjectGesture(event, object)
												}
												onPointerEnter={(event) => {
													if (
														object.locked ||
														(tool !== "select" && tool !== "transform")
													)
														return
													const container = event.target.getStage()?.container()
													if (container !== undefined)
														container.style.cursor = canvasToolCursor(tool, {
															overObject: true,
														})
												}}
												onPointerLeave={(event) => {
													const container = event.target.getStage()?.container()
													if (container !== undefined)
														container.style.cursor = canvasToolCursor(tool)
												}}
											/>
										)
									})}
									{selectedObject === null ||
									(tool !== "select" && tool !== "transform")
										? null
										: projectDesignVectorObject(
												document,
												previewObject ?? selectedObject,
											).contours.flatMap((contour) =>
												contour.nodes.map((node) => (
													<VectorControlHandles
														key={node.id}
														node={node}
														inverseScale={1 / worldScale}
														color="#e17352"
													/>
												)),
											)}
									{gesturePreview?.kind !== "shape" ||
									currentSwatch === undefined ? null : (
										<VectorShapePreview
											preview={gesturePreview}
											inverseScale={1 / worldScale}
											color="#e17352"
											fill={swatchCss(currentSwatch)}
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
											onHandlePointerDown={startScale}
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
