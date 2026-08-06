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
	type CanvasCursor,
	type CanvasPoint,
	type VectorGestureDown,
	type VectorGestureDownInput,
	type VectorGesturePreview,
	type VectorGestureState,
	type VectorEditIntent,
	type VectorSnapGuide,
	type VectorTransformHandle,
	type TileCommandRequest,
} from "@create-art/editor"
import {
	Group,
	Image as CanvasImage,
	type KonvaEventObject,
	Layer,
	Line,
	Rect,
	Stage,
	Text,
} from "@create-art/editor"
import {
	Cross2Icon,
	MagnifyingGlassIcon,
	QuestionMarkCircledIcon,
} from "@radix-ui/react-icons"
import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react"
import type { ReactNode, ComponentProps } from "react"
import { StoreProvider, useO, useTL } from "atom.io/react"

import {
	defaultDesignAppearance,
	setDesignAppearancePaint,
	summarizeDesignAppearance,
	swapDesignAppearancePaints,
	updateDesignStroke,
	validDesignAppearance,
	type AppearancePaintTarget,
} from "./appearance.ts"
import {
	activeDesignArtboard,
	copyDesignBlendSelection,
	designBlendBounds,
	pasteDesignBlendSelection,
	resolveDesignBlend,
} from "@create-design/model"
import {
	allDesignArtboardsBounds,
	createDesignArtboard,
	deleteDesignArtboard,
	designArtboardsAtPoint,
	duplicateDesignArtboard,
	reorderDesignArtboard,
	updateDesignArtboard,
	type DesignArtboardProperties,
} from "./artboard-operations.ts"
import { designArtboardCanvasChrome } from "./artboard-canvas-appearance.ts"
import {
	duplicateDesignObjects,
	readDesignClipboard,
	writeDesignClipboard,
} from "./clipboard.ts"
import { swatchCss } from "@create-design/model"
import { canvasToDocumentPoint } from "@create-design/model"
import { useDesignCanvasTheme } from "./design-canvas-theme.ts"
import { designLayerUiColorCss } from "./design-layer-ui-color.ts"
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
	snapDesignPoint,
	type DesignPointSnapResult,
	type DesignSnapSettings,
	type DesignSnapMatch,
} from "./design-canvas.ts"
import {
	addDesignGuide,
	deleteDesignGuide,
	designRulerTicks,
	updateDesignGuide,
} from "./design-guides.ts"
import {
	createDesignEditorState,
	type DesignEditorState,
} from "./design-editor-state.ts"
import {
	alignDesignObjects,
	distributeDesignObjects,
	transformDesignSelection,
	type DesignAlignment,
	type DesignAlignmentTarget,
} from "./design-arrangement.ts"
import {
	appendDesignHierarchyObjects,
	defaultDesignHierarchyScope,
	designGroupSelectionUnit,
	designHierarchySelectionBounds,
	designLayerIdForObject,
	designParentGroupId,
	designSelectInteraction,
	designSelectionUnits,
	designSelectionUnitAtObject,
	designSelectionUnitForIds,
	groupDesignSelection,
	makeDesignClippingMask,
	moveDesignHierarchyNode,
	normalizeDesignSelection,
	replaceDesignHierarchyObject,
	stackDesignSelection,
	ungroupDesignSelection,
	releaseDesignClippingMask,
	type DesignHierarchyScope,
	type DesignStackCommand,
} from "./design-hierarchy.ts"
import {
	createDesignLayer,
	deleteDesignLayer,
	duplicateDesignLayer,
	renameDesignLayer,
	reorderDesignLayer,
	setDesignLayerLocked,
	setDesignLayerUiColor,
	setDesignLayerVisibility,
} from "./design-layer-operations.ts"
import { createDesignPenObject, type DesignPenPoint } from "./design-pen.ts"
import { placeDesignImage } from "./placed-images.ts"
import {
	directSelectionDescription,
	directSelectionKey,
	marqueeDirectSelection,
	marqueeObjectIds,
	nearestDirectSelectionTarget,
	selectableObjectIds,
	toggleDirectSelection,
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
	designObjectFillRule,
	objectBounds,
	projectDesignObjectContours,
	projectDesignEffectiveHierarchy,
	projectDesignOutput,
	rotateObject,
	scaleObject,
	translateObject,
	type Bounds,
	type DesignEffectiveHierarchyEntry,
} from "@create-design/model"
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
	createPathfinderWorkerClient,
	type PathfinderWorkerClient,
	type PathfinderWorkerTask,
} from "./pathfinder-worker-client.ts"
import {
	isDesignPartitionPathfinderCommand,
	type DesignPartitionPathfinderCommand,
	type PathfinderWorkerProgress,
} from "./pathfinder-worker-protocol.ts"
import {
	expandDesignStroke,
	strokeExpansionEligibility,
} from "./stroke-expansion.ts"
import {
	applyDesignVectorIntent,
	createDesignVectorAdapter,
	importDesignVectorClipboard,
	importDesignObjects,
	projectDesignVectorObject,
} from "./design-vector-adapter.ts"
import { createPdfDownloadManager } from "./pdf-download.ts"
import { createSvgDownloadManager } from "./svg-download.ts"
import { createPngDownloadManager } from "./png-download.ts"
import type { PngExportRequest } from "@create-design/png"
import {
	DESIGN_BLEND_MIME,
	designBlendEligibility,
	expandDesignBlend,
	makeDesignBlend,
	reverseDesignBlendEndpoint,
	setDesignBlendFirstPoint,
	updateDesignBlend,
} from "./blend-operations.ts"
import type { PdfExportTarget } from "@create-design/pdf"
import {
	createDesignTextService,
	type DesignTextService,
} from "@create-design/text"
import {
	exportPreflightAllowsOutput,
	type ExportPreflightPreferences,
} from "@create-design/pdf"
import {
	importSvg,
	type SvgExportTarget,
	type SvgImportResult,
} from "@create-design/svg"
import type {
	DesignExternalSourceUpdate,
	DesignSourceFontResource,
	DesignSourceSession,
} from "./source-session.ts"
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
	DesignBlend,
	DesignDocument,
	DesignFontReference,
	DesignGeometry,
	DesignGuide,
	DesignImageResource,
	DesignObject,
	DesignStroke,
	DesignSwatch,
	DesignTextGeometry,
	DesignTextTypography,
	DesignTool,
} from "./types.ts"
import { TextEditingSurface } from "./TextEditingSurface.tsx"
import {
	createDesignTextObject,
	DEFAULT_DESIGN_TEXT_TYPOGRAPHY,
	DESIGN_TEXT_INITIAL_DRAFT,
	designTextBrowserFontFamily,
	designTextCssFontFamily,
	designTextFamilyId,
	designObjectInteractionBounds,
	designTextKonvaTransform,
	estimateDesignTextLayout,
	scaleDesignTextObject,
	updateDesignAreaTextFrame,
	updateDesignText,
	updateDesignTextTypography,
} from "./design-text.ts"

const svg = {
	Cross2Icon,
	MagnifyingGlassIcon,
	QuestionMarkCircledIcon,
}

const MAC_LIKE =
	typeof navigator !== "undefined" &&
	/Mac|iPhone|iPad|iPod/i.test(navigator.platform)
const MOD_KEY_LABEL = MAC_LIKE ? "⌘" : "Ctrl"

/* eslint-disable lasertag/render-tag-with-own-name -- This renderer guard must return the shared Konva Stage rather than a DOM custom element. */
function MeasuredStage({
	width,
	height,
	...props
}: ComponentProps<typeof Stage>) {
	if (
		width === undefined ||
		height === undefined ||
		!(width > 0) ||
		!(height > 0)
	)
		return null
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
			readonly copy: DesignMoveCopyPlan | null
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

interface DesignMoveCopyPlan {
	readonly document: DesignDocument
	readonly selection: readonly string[]
	readonly originals: readonly DesignObject[]
}

const GROUP_DOUBLE_CLICK_MS = 500
const GROUP_DOUBLE_CLICK_SLOP_PIXELS = 8
const GROUP_DRAG_THRESHOLD_PIXELS = 4

interface GroupClickCandidate {
	readonly groupId: string
	readonly screen: CanvasPoint
	readonly timeStamp: number
}

interface GroupPointerPress {
	readonly pointerId: number
	readonly groupId: string
	readonly startScreen: CanvasPoint
	readonly secondClick: boolean
	dragged: boolean
}

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
	boundsForObject: (object: DesignObject) => Bounds | null,
): DesignGestureObjectPreview | null {
	if (gesture.kind === "move" && preview?.kind === "select-move") {
		const rawObjects = gesture.originals.map((object) =>
			translateObject(object, preview.delta.x, preview.delta.y),
		)
		const snapped =
			rawObjects.length === 1
				? snapDesignObject(
						rawObjects[0]!,
						document,
						worldScale,
						snapSettings,
						boundsForObject(rawObjects[0]!),
					)
				: snapDesignObjects(
						rawObjects,
						document,
						worldScale,
						snapSettings,
						designHierarchySelectionBounds(
							document,
							rawObjects,
							boundsForObject,
						),
					)
		const movedObjects =
			"object" in snapped ? [snapped.object] : snapped.objects
		const copyObjects = gesture.copy?.originals
		const objects =
			gesture.state.modifiers.altKey &&
			copyObjects !== undefined &&
			copyObjects.length === movedObjects.length
				? copyObjects.map((object, index) => {
						const original = gesture.originals[index]!
						const moved = movedObjects[index]!
						return translateObject(
							object,
							moved.transform.e - original.transform.e,
							moved.transform.f - original.transform.f,
						)
					})
				: movedObjects
		return {
			objects,
			snap: { x: snapped.x, y: snapped.y, matches: snapped.matches ?? [] },
		}
	}
	if (gesture.kind !== "transform" || preview?.kind !== "transform") return null
	let scaleX = preview.scale.x
	let scaleY = preview.scale.y
	if (
		preview.handle !== "rotation" &&
		preview.handle !== "move" &&
		gesture.originals.some(({ geometry }) => geometry.kind === "text")
	) {
		const factor =
			preview.handle === "n" || preview.handle === "s"
				? scaleY
				: preview.handle === "e" || preview.handle === "w"
					? scaleX
					: Math.abs(scaleX - 1) >= Math.abs(scaleY - 1)
						? scaleX
						: scaleY
		scaleX = factor
		scaleY = factor
	}
	const transformed = gesture.originals.map((object) =>
		preview.handle === "rotation"
			? rotateObject(object, preview.anchor, preview.rotationDegrees)
			: preview.handle === "move"
				? translateObject(object, preview.delta.x, preview.delta.y)
				: object.geometry.kind === "text"
					? scaleDesignTextObject(object, preview.anchor, scaleX)
					: scaleObject(object, preview.anchor, scaleX, scaleY),
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

function shapeAlignedPointSnap(
	snap: DesignPointSnapResult,
	preview: Extract<VectorGesturePreview, { readonly kind: "shape" }>,
): DesignPointSnapResult {
	const matches = snap.matches.filter(({ axis, target }) => {
		const bounds = preview.bounds
		return axis === "x"
			? Math.abs(bounds.minX - target) < 1e-7 ||
					Math.abs(bounds.maxX - target) < 1e-7
			: Math.abs(bounds.minY - target) < 1e-7 ||
					Math.abs(bounds.maxY - target) < 1e-7
	})
	return {
		...snap,
		x: matches.find(({ axis }) => axis === "x")?.target ?? null,
		y: matches.find(({ axis }) => axis === "y")?.target ?? null,
		matches,
	}
}

function initialDesignLoad(
	initialDocument?: DesignDocument,
): InitialDesignLoad {
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

function initialDesignPersistence(
	initialDocument: DesignDocument | undefined,
	sourceSession: DesignSourceSession | undefined,
): DesignPersistenceState {
	const state = createDesignPersistenceState(
		sourceSession?.initialRevision ?? null,
	)
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

function contextualHelp(tool: DesignTool, editingGroup: boolean): string {
	if (tool === "pen")
		return "Click for corners · Drag for curves · Click start to close · Enter finishes open · Escape cancels"
	if (tool === "rect" || tool === "ellipse")
		return "Drag to draw · Shift constrains · Alt draws from center"
	if (tool === "transform")
		return "Drag corner handles to resize both axes · Drag side handles to resize one axis · Shift preserves proportions · Alt resizes from center · Use numeric Transform controls for keyboard access"
	if (tool === "text")
		return "Click to insert point text · Type in the native editor · Escape exits text editing"
	if (tool === "area-text")
		return "Drag to create a text frame · Type in the native editor · Escape exits text editing"
	if (editingGroup)
		return "Editing group contents · Double-click nested groups · Escape exits group"
	return `Drag objects to move · Alt/Option-drag to copy · ${MOD_KEY_LABEL}+D duplicates with offset · Double-click a group to edit contents · F shows transform handles · X targets fill or stroke · Shift-X swaps one object's paints · ${MOD_KEY_LABEL}+X cuts`
}

const DESIGN_TRANSFORM_HANDLES = [
	"nw",
	"n",
	"ne",
	"e",
	"se",
	"s",
	"sw",
	"w",
] as const satisfies readonly Exclude<
	VectorTransformHandle,
	"move" | "rotation"
>[]

function designTransformHandleCursor(
	handle: VectorTransformHandle,
): CanvasCursor {
	switch (handle) {
		case "n":
		case "s":
			return "ns-resize"
		case "e":
		case "w":
			return "ew-resize"
		case "nw":
		case "se":
			return "nwse-resize"
		case "ne":
		case "sw":
			return "nesw-resize"
		case "rotation":
			return "grab"
		case "move":
			return "move"
	}
}

function uniqueTextFonts(
	fonts: readonly DesignFontReference[],
): readonly DesignFontReference[] {
	return [
		...new Map(
			fonts.map((font) => [font.id, Object.freeze({ ...font })]),
		).values(),
	].toSorted((left, right) =>
		left.family.localeCompare(right.family, undefined, { sensitivity: "base" }),
	)
}

function registerDesignTextFontResources(
	textService: DesignTextService,
	resources: readonly DesignSourceFontResource[],
): Readonly<{
	resources: readonly DesignSourceFontResource[]
	errors: readonly string[]
}> {
	const errors: string[] = []
	const registered = resources.filter(({ bytes, reference }) => {
		const error = textService
			.registerFont(reference, bytes)
			.find(({ severity }) => severity === "error")
		if (error === undefined) return true
		errors.push(`Could not load ${reference.family}: ${error.message}`)
		return false
	})
	return { resources: registered, errors }
}

function useDesignCanvasImages(
	document: DesignDocument,
	resources: readonly DesignImageResource[],
): ReadonlyMap<string, HTMLImageElement> {
	const [images, setImages] = useState<ReadonlyMap<string, HTMLImageElement>>(
		new Map(),
	)
	useEffect(() => {
		const next = new Map<string, HTMLImageElement>()
		const urls: string[] = []
		let active = true
		const resourcesById = new Map(
			resources.map((resource) => [resource.id, resource]),
		)
		const sources = new Map(
			document.objects.flatMap((object) =>
				object.geometry.kind === "image"
					? [[object.geometry.source.id, object.geometry.source] as const]
					: [],
			),
		)
		for (const [id, source] of sources) {
			const resource = resourcesById.get(id)
			const url =
				resource === undefined
					? source.kind === "linked"
						? source.href
						: null
					: URL.createObjectURL(
							new Blob([resource.bytes.slice().buffer], {
								type: resource.mediaType,
							}),
						)
			if (url === null) continue
			if (resource !== undefined) urls.push(url)
			const image = new globalThis.Image()
			image.onload = () => {
				if (!active) return
				next.set(id, image)
				setImages(new Map(next))
			}
			image.src = url
		}
		return () => {
			active = false
			for (const url of urls) URL.revokeObjectURL(url)
		}
	}, [document, resources])
	return images
}

function imageTransform(object: DesignObject): Readonly<{
	x: number
	y: number
	rotation: number
	scaleX: number
	scaleY: number
	skewX: number
}> {
	const { a, b, c, d, e, f } = object.transform
	const scaleX = Math.hypot(a, b) || 1
	const determinant = a * d - b * c
	return {
		x: e,
		y: f,
		rotation: (Math.atan2(b, a) * 180) / Math.PI,
		scaleX,
		scaleY: determinant / scaleX,
		skewX: (Math.atan2(a * c + b * d, scaleX * scaleX) * 180) / Math.PI,
	}
}

/* eslint-disable lasertag/render-tag-with-own-name -- Konva clipping groups must remain renderer nodes rather than DOM custom elements. */
function DesignCanvasMasks({
	children,
	masks,
	index = 0,
}: Readonly<{
	children: ReactNode
	masks: readonly DesignObject[]
	index?: number
}>) {
	const mask = masks[index]
	if (mask === undefined) return children
	return (
		<Group
			clipFunc={(context) => {
				context.beginPath()
				for (const contour of projectDesignObjectContours(mask)) {
					const first = contour.points[0]
					if (first === undefined) continue
					context.moveTo(first.x, first.y)
					const segment = (
						from: (typeof contour.points)[number],
						to: (typeof contour.points)[number],
					) => {
						if (from.outgoing === undefined && to.incoming === undefined)
							context.lineTo(to.x, to.y)
						else {
							const outgoing = from.outgoing ?? { x: 0, y: 0 }
							const incoming = to.incoming ?? { x: 0, y: 0 }
							context.bezierCurveTo(
								from.x + outgoing.x,
								from.y + outgoing.y,
								to.x + incoming.x,
								to.y + incoming.y,
								to.x,
								to.y,
							)
						}
					}
					for (
						let pointIndex = 1;
						pointIndex < contour.points.length;
						pointIndex += 1
					)
						segment(
							contour.points[pointIndex - 1]!,
							contour.points[pointIndex]!,
						)
					if (contour.closed) {
						segment(contour.points.at(-1)!, first)
						context.closePath()
					}
				}
			}}
		>
			<DesignCanvasMasks masks={masks} index={index + 1}>
				{children}
			</DesignCanvasMasks>
		</Group>
	)
}
/* eslint-enable lasertag/render-tag-with-own-name */

export type DesignApplicationProps = Readonly<{
	children?: ReactNode
	imageResources?: readonly DesignImageResource[]
	initialDocument?: DesignDocument
	pathfinderWorkerClient?: PathfinderWorkerClient
	sourceSession?: DesignSourceSession
	textService?: DesignTextService
}>

type InitialDesignLoad = Readonly<{
	document: DesignDocument
	preserveInvalidStorage: boolean
}>

type ActivePathfinderOperation = Readonly<{
	cancellationRequested: boolean
	command: DesignPartitionPathfinderCommand
	label: string
	progress: PathfinderWorkerProgress | null
}>

function pathfinderOperationLabel(
	command: DesignPartitionPathfinderCommand,
): string {
	switch (command) {
		case "pathfinder-divide":
			return "Divide"
		case "pathfinder-trim":
			return "Trim"
		case "pathfinder-merge":
			return "Merge"
		case "pathfinder-crop":
			return "Crop"
		case "pathfinder-outline":
			return "Outline"
	}
}

const sameStringSelection = (
	left: readonly string[],
	right: readonly string[],
): boolean =>
	left.length === right.length &&
	left.every((value, index) => value === right[index])

const sameDirectSelection = (
	left: readonly DesignDirectSelectionTarget[],
	right: readonly DesignDirectSelectionTarget[],
): boolean =>
	left.length === right.length &&
	left.every(
		(value, index) =>
			directSelectionKey(value) === directSelectionKey(right[index]!),
	)

function effectiveStateReason(
	entry: DesignEffectiveHierarchyEntry,
	action: string,
): string | null {
	const blocker = entry.hiddenBy ?? entry.lockedBy
	if (blocker === null) return null
	const subject =
		blocker.kind === "layer" ? `${blocker.name} layer` : blocker.name
	return `${entry.hiddenBy === blocker ? "Show" : "Unlock"} ${subject} before ${action}.`
}

export function DesignApplication(props: DesignApplicationProps) {
	const [initialLoad] = useState(() => initialDesignLoad(props.initialDocument))
	const [textRuntime] = useState(() => {
		const service = props.textService ?? createDesignTextService()
		const registration = registerDesignTextFontResources(
			service,
			props.sourceSession?.fonts ?? [],
		)
		return { service, registration }
	})
	const [editorState] = useState(() =>
		createDesignEditorState({
			document: initialLoad.document,
			persistence: initialDesignPersistence(
				props.initialDocument,
				props.sourceSession,
			),
		}),
	)
	return (
		// The provider is an implementation wrapper; the child owns the custom root.
		// eslint-disable-next-line lasertag/render-tag-with-own-name
		<StoreProvider store={editorState.silo.store}>
			<DesignApplicationContent
				{...props}
				editorState={editorState}
				initialLoad={initialLoad}
				initialTextFontRegistration={textRuntime.registration}
				textService={textRuntime.service}
			/>
		</StoreProvider>
	)
}

type DesignApplicationContentProps = Omit<
	DesignApplicationProps,
	"textService"
> &
	Readonly<{
		editorState: DesignEditorState
		initialLoad: InitialDesignLoad
		initialTextFontRegistration: ReturnType<
			typeof registerDesignTextFontResources
		>
		textService: DesignTextService
	}>

function DesignApplicationContent(props: DesignApplicationContentProps) {
	const { pathfinderWorkerClient, sourceSession } = props
	const canvasTheme = useDesignCanvasTheme()
	const { editorState, initialLoad } = props
	const versionControl = useDesignVersionControl(sourceSession?.versionControl)
	const document = useO(editorState.states.documentSelector)
	const persistence = useO(editorState.states.persistenceAtom)
	const {
		at: historyAt,
		length: historyLength,
		redo: redoDocument,
		undo: undoDocument,
	} = useTL(editorState.documentTimeline)
	const history = {
		canRedo: historyAt < historyLength,
		canUndo: historyAt > 0,
	}
	const updatePersistence = editorState.actions.updatePersistence
	const [tool, setTool] = useState<DesignTool>("select")
	const [selection, setSelection] = useState<readonly string[]>([])
	const [imageResources, setImageResources] = useState<
		readonly DesignImageResource[]
	>(() => props.imageResources ?? sourceSession?.images ?? [])
	const canvasImages = useDesignCanvasImages(document, imageResources)
	const [selectedBlendId, setSelectedBlendId] = useState<string | null>(null)
	const [editingTextId, setEditingTextId] = useState<string | null>(null)
	const [textSelectionRange, setTextSelectionRange] = useState<Readonly<{
		start: number
		end: number
	}> | null>(null)
	const [groupScope, setGroupScope] = useState<readonly string[]>([])
	const [selectedLayerId, setSelectedLayerId] = useState(
		() => defaultDesignHierarchyScope(initialLoad.document).layerId,
	)
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
				blendId?: string
				layerId?: string
				groupScope?: readonly string[]
			}>
		>(),
	)
	const historySelectionsRef = useRef(
		new Map<
			number,
			Readonly<{
				objectSelection: readonly string[]
				directSelection: readonly DesignDirectSelectionTarget[]
				blendId?: string
				layerId?: string
				groupScope?: readonly string[]
			}>
		>(),
	)
	const pendingHistorySelectionRef = useRef<number | null>(null)
	const restoringHistorySelectionRef = useRef(false)
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
	const [helpOpen, setHelpOpen] = useState(false)
	const [transformCursor, setTransformCursor] = useState<CanvasCursor | null>(
		null,
	)
	const [tileCommandRequest, setTileCommandRequest] =
		useState<TileCommandRequest<DesignTileKind> | null>(null)
	const [status, setStatus] = useState(
		`Ready — draw a shape or press ${MOD_KEY_LABEL}+Shift+P for commands.`,
	)
	const [activePathfinder, setActivePathfinder] =
		useState<ActivePathfinderOperation | null>(null)
	const [announcement, setAnnouncement] = useState(() =>
		persistenceLabel(persistence),
	)
	const announcedStatusRef = useRef(status)
	useEffect(() => {
		if (announcedStatusRef.current === status) return
		announcedStatusRef.current = status
		setAnnouncement(status)
	}, [status])
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
	const commandCenterRef = useRef<HTMLButtonElement>(null)
	const helpButtonRef = useRef<HTMLButtonElement>(null)
	const gestureRef = useRef<CanvasGesture | null>(null)
	const creationSnapStatusRef = useRef(false)
	const groupClickCandidateRef = useRef<GroupClickCandidate | null>(null)
	const groupPointerPressRef = useRef<GroupPointerPress | null>(null)
	const pendingGroupEntryRef = useRef<string | null>(null)
	const penPointsRef = useRef<readonly DesignPenPoint[]>([])
	const previewObjectsRef = useRef<readonly DesignObject[]>([])
	const previewArtboardDocumentRef = useRef<DesignDocument | null>(null)
	const documentRef = useRef(document)
	const selectionRef = useRef(selection)
	const directSelectionRef = useRef(directSelection)
	const currentGroupScopeRef = useRef<string | null>(null)
	const persistenceRef = useRef(persistence)
	const announcedPersistenceStatusRef = useRef(persistence.status)
	const serializedDocumentRef = useRef(JSON.stringify(document))
	const preserveInvalidStorageRef = useRef(initialLoad.preserveInvalidStorage)
	const saveDocumentsRef = useRef(new Map<number, DesignDocument>())
	const pathfinderTaskRef = useRef<Readonly<{
		generation: number
		sourceDocument: DesignDocument
		task: PathfinderWorkerTask
	}> | null>(null)
	const pathfinderGenerationRef = useRef(0)
	const sequence = useRef(0)
	const tileCommandSequence = useRef(0)
	const textService = props.textService
	const initialTextFontResources = props.initialTextFontRegistration.resources
	const initialTextFonts = uniqueTextFonts(
		initialTextFontResources.map(({ reference }) => reference),
	)
	const browserFontLoadingSupported =
		typeof globalThis.FontFace !== "undefined" &&
		globalThis.document?.fonts !== undefined
	const [textFontResources, setTextFontResources] = useState<
		readonly DesignSourceFontResource[]
	>(initialTextFontResources)
	const [availableTextFonts, setAvailableTextFonts] = useState<
		readonly DesignFontReference[]
	>(browserFontLoadingSupported ? [] : initialTextFonts)
	const [activeTextFontId, setActiveTextFontId] = useState<string | null>(
		browserFontLoadingSupported ? null : (initialTextFonts[0]?.id ?? null),
	)
	const registeredTextFontIdsRef = useRef<ReadonlySet<string>>(
		new Set(initialTextFontResources.map(({ reference }) => reference.id)),
	)
	const browserTextFontsRef = useRef(
		new Map<
			string,
			Readonly<{
				cssFamily: string
				face: FontFace
				fontSet: FontFaceSet
				revision: string
			}>
		>(),
	)
	const sourceTextFontResourcesRef = useRef(props.sourceSession?.fonts)
	const browserTextFontGenerationRef = useRef(0)
	const [textFontRevision, setTextFontRevision] = useState(0)
	const unregisterBrowserTextFont = useCallback((fontId: string): void => {
		const browserFont = browserTextFontsRef.current.get(fontId)
		if (browserFont === undefined) return
		browserFont.fontSet.delete(browserFont.face)
		browserTextFontsRef.current.delete(fontId)
	}, [])
	const loadBrowserTextFont = useCallback(
		async (
			reference: DesignFontReference,
			bytes: Uint8Array,
		): Promise<Readonly<{
			cssFamily: string
			face: FontFace
			fontSet: FontFaceSet
			revision: string
		}> | null> => {
			const FontFaceConstructor = globalThis.FontFace
			const fontSet = globalThis.document?.fonts
			if (typeof FontFaceConstructor === "undefined" || fontSet === undefined)
				return null
			const cssFamily = designTextBrowserFontFamily(reference)
			const face = new FontFaceConstructor(cssFamily, bytes.slice().buffer, {
				style: "normal",
				weight: "1 1000",
			})
			const loadedFace = await face.load()
			return {
				cssFamily: loadedFace.family,
				face: loadedFace,
				fontSet,
				revision: String(reference.revision ?? "unversioned"),
			}
		},
		[],
	)
	const activateBrowserTextFont = useCallback(
		(
			reference: DesignFontReference,
			browserFont: Awaited<ReturnType<typeof loadBrowserTextFont>>,
		): void => {
			if (browserFont === null) return
			unregisterBrowserTextFont(reference.id)
			browserFont.fontSet.add(browserFont.face)
			const declaration = `1px ${designTextCssFontFamily(browserFont.cssFamily)}`
			if (
				typeof browserFont.fontSet.check === "function" &&
				!browserFont.fontSet.check(declaration, "Hamburgefontsiv")
			) {
				browserFont.fontSet.delete(browserFont.face)
				throw new Error(
					`The browser did not make ${reference.family} ready for text rendering.`,
				)
			}
			browserTextFontsRef.current.set(reference.id, browserFont)
		},
		[unregisterBrowserTextFont],
	)
	const registerHeadlessTextFontResources = useCallback(
		(resources: readonly DesignSourceFontResource[]): void => {
			const registration = registerDesignTextFontResources(
				textService,
				resources,
			)
			const nextIds = new Set(
				registration.resources.map(({ reference }) => reference.id),
			)
			for (const fontId of registeredTextFontIdsRef.current) {
				if (nextIds.has(fontId)) continue
				textService.unregisterFont(fontId)
				unregisterBrowserTextFont(fontId)
			}
			registeredTextFontIdsRef.current = nextIds
			setTextFontResources(registration.resources)
			if (!browserFontLoadingSupported) {
				const references = uniqueTextFonts(
					registration.resources.map(({ reference }) => reference),
				)
				setAvailableTextFonts(references)
				setActiveTextFontId((current) =>
					references.some(({ id }) => id === current)
						? current
						: (references[0]?.id ?? null),
				)
			}
			setTextFontRevision((revision) => revision + 1)
			if (registration.errors.length > 0)
				setStatus(registration.errors.join(" "))
		},
		[browserFontLoadingSupported, textService, unregisterBrowserTextFont],
	)
	useEffect(() => {
		const resources = props.sourceSession?.fonts
		if (sourceTextFontResourcesRef.current === resources) return
		sourceTextFontResourcesRef.current = resources
		registerHeadlessTextFontResources(resources ?? [])
	}, [props.sourceSession?.fonts, registerHeadlessTextFontResources])
	useEffect(() => {
		if (!browserFontLoadingSupported) return
		const generation = browserTextFontGenerationRef.current + 1
		browserTextFontGenerationRef.current = generation
		const resourceKeys = new Map(
			textFontResources.map(({ reference }) => [
				reference.id,
				String(reference.revision ?? "unversioned"),
			]),
		)
		const alreadyReady = uniqueTextFonts(
			textFontResources.flatMap(({ reference }) => {
				const browserFont = browserTextFontsRef.current.get(reference.id)
				return browserFont?.revision === resourceKeys.get(reference.id)
					? [reference]
					: []
			}),
		)
		setAvailableTextFonts(alreadyReady)
		setActiveTextFontId((current) =>
			alreadyReady.some(({ id }) => id === current)
				? current
				: (alreadyReady[0]?.id ?? null),
		)
		void (async () => {
			const readyResources = await Promise.all(
				textFontResources.map(async (resource) => {
					const current = browserTextFontsRef.current.get(resource.reference.id)
					if (
						current?.revision ===
						String(resource.reference.revision ?? "unversioned")
					)
						return { resource, browserFont: current, alreadyActive: true }
					try {
						const browserFont = await loadBrowserTextFont(
							resource.reference,
							resource.bytes,
						)
						return { resource, browserFont, alreadyActive: false }
					} catch (error) {
						return { resource, error }
					}
				}),
			)
			if (generation !== browserTextFontGenerationRef.current) return
			const failures: string[] = []
			const activated: typeof readyResources = []
			for (const result of readyResources) {
				if ("error" in result) {
					failures.push(
						`Could not load ${result.resource.reference.family} in the browser: ${result.error instanceof Error ? result.error.message : String(result.error)}`,
					)
					continue
				}
				try {
					if (!result.alreadyActive)
						activateBrowserTextFont(
							result.resource.reference,
							result.browserFont,
						)
					activated.push(result)
				} catch (error) {
					failures.push(
						`Could not load ${result.resource.reference.family} in the browser: ${error instanceof Error ? error.message : String(error)}`,
					)
				}
			}
			for (const fontId of [...browserTextFontsRef.current.keys()])
				if (!resourceKeys.has(fontId)) unregisterBrowserTextFont(fontId)
			const references = uniqueTextFonts(
				activated.map(({ resource }) => resource.reference),
			)
			setAvailableTextFonts(references)
			setActiveTextFontId((current) =>
				references.some(({ id }) => id === current)
					? current
					: (references[0]?.id ?? null),
			)
			setTextFontRevision((revision) => revision + 1)
			if (failures.length > 0) setStatus(failures.join(" "))
		})()
	}, [
		activateBrowserTextFont,
		browserFontLoadingSupported,
		loadBrowserTextFont,
		textFontResources,
		unregisterBrowserTextFont,
	])
	useEffect(() => {
		if (props.initialTextFontRegistration.errors.length > 0)
			setStatus(props.initialTextFontRegistration.errors.join(" "))
	}, [props.initialTextFontRegistration.errors])
	useEffect(
		() => () => {
			for (const fontId of browserTextFontsRef.current.keys())
				unregisterBrowserTextFont(fontId)
		},
		[unregisterBrowserTextFont],
	)
	const pdfDownloadManager = useMemo(
		() =>
			createPdfDownloadManager(undefined, {
				textService,
				imageResources: new Map(
					imageResources.map((resource) => [resource.id, resource]),
				),
			}),
		[imageResources, textService],
	)
	const svgDownloadManager = useMemo(
		() =>
			createSvgDownloadManager(undefined, {
				imageResources: new Map(
					imageResources.map((resource) => [resource.id, resource]),
				),
			}),
		[imageResources],
	)
	const pngDownloadManager = useMemo(() => createPngDownloadManager(), [])
	const pathfinderClient = useMemo(
		() => pathfinderWorkerClient ?? createPathfinderWorkerClient(),
		[pathfinderWorkerClient],
	)
	useEffect(() => () => pdfDownloadManager.dispose(), [pdfDownloadManager])
	useEffect(() => () => svgDownloadManager.dispose(), [svgDownloadManager])
	useEffect(() => () => pngDownloadManager.dispose(), [pngDownloadManager])
	useEffect(
		() => () => {
			pathfinderGenerationRef.current += 1
			pathfinderTaskRef.current?.task.cancel()
			pathfinderTaskRef.current = null
		},
		[],
	)
	useEffect(() => {
		if (announcedPersistenceStatusRef.current === persistence.status) return
		announcedPersistenceStatusRef.current = persistence.status
		if (
			persistence.status === "saved" ||
			persistence.status === "conflicted" ||
			persistence.status === "invalid-external-source" ||
			persistence.status === "recoverable-draft"
		)
			setAnnouncement(persistenceLabel(persistence))
	}, [persistence])
	const openTile = useCallback((kind: DesignTileKind): void => {
		tileCommandSequence.current += 1
		setTileCommandRequest({ id: tileCommandSequence.current, kind })
	}, [])
	const openCommandPalette = useCallback((): void => {
		setHelpOpen(false)
		setPaletteOpen(true)
	}, [])
	const closeCommandPalette = useCallback((): void => {
		setPaletteOpen(false)
		requestAnimationFrame(() => commandCenterRef.current?.focus())
	}, [])
	const closeHelp = useCallback((): void => {
		setHelpOpen(false)
		requestAnimationFrame(() => helpButtonRef.current?.focus())
	}, [])
	const nextId = useCallback(() => {
		sequence.current += 1
		return `${Date.now().toString(36)}:${sequence.current.toString(36)}`
	}, [])
	documentRef.current = document
	selectionRef.current = selection
	directSelectionRef.current = directSelection
	persistenceRef.current = persistence
	const activeArtboard = activeDesignArtboard(document, activeArtboardId)
	const currentGroupScope = groupScope.at(-1) ?? null
	const activeLayerId = document.layers.some(
		(layer) => layer.id === selectedLayerId,
	)
		? selectedLayerId
		: defaultDesignHierarchyScope(document).layerId
	const activeHierarchyScope = useMemo<DesignHierarchyScope>(
		() => ({ layerId: activeLayerId, groupId: currentGroupScope }),
		[activeLayerId, currentGroupScope],
	)
	const effectiveHierarchy = useMemo(
		() => projectDesignEffectiveHierarchy(document),
		[document],
	)
	const effectivePolicyDocument = useMemo<DesignDocument>(
		() => ({
			...document,
			objects: effectiveHierarchy.entries.map((entry) =>
				entry.visible && entry.locked === Boolean(entry.object.locked)
					? entry.object
					: {
							...entry.object,
							...(entry.visible ? {} : { hidden: true }),
							...(entry.locked ? { locked: true } : {}),
						},
			),
		}),
		[document, effectiveHierarchy],
	)
	const effectiveEditableObjectIds = useMemo(
		() =>
			new Set(effectiveHierarchy.editableObjects.map((object) => object.id)),
		[effectiveHierarchy],
	)
	const activeLayer = document.layers.find(
		(layer) => layer.id === activeLayerId,
	)!
	const activeLayerUnavailableReason = activeLayer.hidden
		? `Show ${activeLayer.name} layer before adding artwork to it.`
		: activeLayer.locked
			? `Unlock ${activeLayer.name} layer before adding artwork to it.`
			: null
	const activeLayerPasteUnavailableReason = activeLayer.hidden
		? `Show ${activeLayer.name} layer before pasting into it.`
		: activeLayer.locked
			? `Unlock ${activeLayer.name} layer before pasting into it.`
			: null
	currentGroupScopeRef.current = currentGroupScope
	const selectedUnit = designSelectionUnitForIds(
		document,
		selection,
		currentGroupScope,
	)
	const selectedObjects = document.objects.filter((object) =>
		selection.includes(object.id),
	)
	const selectedUnavailableEntry = selection
		.map((id) => effectiveHierarchy.byObjectId.get(id))
		.find(
			(entry): entry is DesignEffectiveHierarchyEntry =>
				entry !== undefined && (!entry.visible || entry.locked),
		)
	const selectedInheritedUnavailableEntry = selection
		.map((id) => effectiveHierarchy.byObjectId.get(id))
		.find(
			(entry): entry is DesignEffectiveHierarchyEntry =>
				entry?.hiddenBy?.kind === "layer" || entry?.lockedBy?.kind === "layer",
		)
	const selectedBlend =
		document.blends?.find(({ id }) => id === selectedBlendId) ?? null
	const selectedBlendUnavailableEntry =
		selectedBlend === null
			? undefined
			: [selectedBlend.startObjectId, selectedBlend.endObjectId]
					.map((id) => effectiveHierarchy.byObjectId.get(id))
					.find(
						(entry): entry is DesignEffectiveHierarchyEntry =>
							entry !== undefined && (!entry.visible || entry.locked),
					)
	useEffect(() => {
		if (selection.length > 0) setSelectedBlendId(null)
	}, [selection])
	useEffect(() => {
		if (selectedBlendId !== null && selectedBlend === null)
			setSelectedBlendId(null)
	}, [selectedBlend, selectedBlendId])
	useEffect(() => {
		const layerIds = new Set(
			selection.flatMap((objectId) => {
				const layerId = designLayerIdForObject(document, objectId)
				return layerId === null ? [] : [layerId]
			}),
		)
		if (layerIds.size === 1) setSelectedLayerId([...layerIds][0]!)
	}, [document, selection])
	const selectedObject =
		selectedUnit?.kind === "group" ? null : (selectedObjects[0] ?? null)
	const selectedObjectEffectiveEntry =
		selectedObject === null
			? undefined
			: effectiveHierarchy.byObjectId.get(selectedObject.id)
	const editingTextObject:
		| (DesignObject & { readonly geometry: DesignTextGeometry })
		| null =
		editingTextId === null
			? null
			: ((document.objects.find(
					(object) =>
						object.id === editingTextId && object.geometry.kind === "text",
				) as
					| (DesignObject & { readonly geometry: DesignTextGeometry })
					| undefined) ?? null)
	const editingTextLayout =
		editingTextObject === null ? null : textService.layout(editingTextObject)
	const editingTextRegisteredFamily =
		editingTextObject === null
			? null
			: (browserTextFontsRef.current.get(
					editingTextObject.geometry.typography.font.id,
				)?.cssFamily ??
				(browserFontLoadingSupported
					? null
					: editingTextObject.geometry.typography.font.family))
	const selectedGroup = selectedUnit?.kind === "group" ? selectedUnit : null
	const selectedLockedObject = selection
		.map((id) => effectiveHierarchy.byObjectId.get(id))
		.find((entry) => entry?.locked)?.object
	const selectionArrangementUnitCount = designSelectionUnits(
		document,
		selection,
	).length
	const selectionTransformDisabledReason =
		selectedObjects.length === 0
			? "Select one or more objects to transform or arrange."
			: selectedUnavailableEntry === undefined
				? null
				: effectiveStateReason(
						selectedUnavailableEntry,
						"transforming the selection",
					)
	const selectionDescription =
		selectedBlend !== null
			? `${selectedBlend.name}, live blend with ${selectedBlend.steps} specified step${selectedBlend.steps === 1 ? "" : "s"}, selected.`
			: selectedGroup === null
				? selection.length === 0
					? "No objects selected."
					: `${selection.length} object${selection.length === 1 ? "" : "s"} selected.`
				: `${selectedGroup.name}, group with ${selectedGroup.objectIds.length} object${selectedGroup.objectIds.length === 1 ? "" : "s"}, selected${selectedLockedObject === undefined ? "" : "; contains locked artwork"}.`
	const selectionAnnouncement =
		tool === "direct"
			? directSelectionDescription(directSelection)
			: selectionDescription
	const announcedSelectionRef = useRef(selectionAnnouncement)
	const selectionStatusRef = useRef(status)
	useEffect(() => {
		if (announcedSelectionRef.current === selectionAnnouncement) return
		announcedSelectionRef.current = selectionAnnouncement
		if (selectionStatusRef.current !== status) return
		setAnnouncement(selectionAnnouncement)
	}, [selectionAnnouncement, status])
	useEffect(() => {
		selectionStatusRef.current = status
	})
	useEffect(() => {
		setGroupScope((current) => {
			const validIds = new Set(document.groups?.map(({ id }) => id) ?? [])
			const valid = current.filter((id) => validIds.has(id))
			return valid.length === current.length ? current : valid
		})
	}, [document.groups])
	useEffect(() => {
		const objectIds = new Set(document.objects.map(({ id }) => id))
		setSelection((current) => {
			const valid = current.filter((id) => objectIds.has(id))
			return valid.length === current.length ? current : valid
		})
		setDirectSelection((current) => {
			const valid = current.filter((target) => objectIds.has(target.objectId))
			return valid.length === current.length ? current : valid
		})
	}, [document.objects])
	useEffect(() => {
		if (editingTextId !== null && editingTextObject === null) {
			setEditingTextId(null)
			setTextSelectionRange(null)
		}
	}, [editingTextId, editingTextObject])
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
	const appearanceDisabledReason =
		selectedUnavailableEntry === undefined
			? document.swatches.length === 0
				? "Add a document swatch before assigning paint."
				: null
			: effectiveStateReason(
					selectedUnavailableEntry,
					"editing the selection appearance",
				)
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
	const expansionEligibility =
		selectedUnavailableEntry === undefined
			? shapeExpansionEligibility(effectivePolicyDocument, selection)
			: {
					eligible: false as const,
					reason:
						effectiveStateReason(
							selectedUnavailableEntry,
							"expanding the selected shape",
						) ?? "The selected shape is unavailable.",
				}
	const strokeEligibility =
		selectedUnavailableEntry === undefined
			? strokeExpansionEligibility(effectivePolicyDocument, selection)
			: {
					eligible: false as const,
					reason:
						effectiveStateReason(
							selectedUnavailableEntry,
							"expanding the selected stroke",
						) ?? "The selected stroke is unavailable.",
				}
	const blendEligibility =
		selectedUnavailableEntry === undefined
			? designBlendEligibility(effectivePolicyDocument, selection)
			: {
					eligible: false as const,
					reason:
						effectiveStateReason(
							selectedUnavailableEntry,
							"making a live blend",
						) ?? "The selection is unavailable.",
				}
	const blendDiagnostics =
		selectedBlend === null
			? []
			: resolveDesignBlend(document, selectedBlend).diagnostics.map(
					({ message }) => message,
				)
	const selectedTextObject:
		| (DesignObject & {
				readonly geometry: DesignTextGeometry
		  })
		| null =
		selectedObject?.geometry.kind === "text"
			? (selectedObject as DesignObject & {
					readonly geometry: DesignTextGeometry
				})
			: null
	const selectedTextEffectiveEntry =
		selectedTextObject === null
			? undefined
			: effectiveHierarchy.byObjectId.get(selectedTextObject.id)
	const textToolsDisabledReason =
		availableTextFonts.length === 0
			? "Add an OpenType font to this workspace before using Point Type or Area Type."
			: null
	const activeTextFont =
		availableTextFonts.find(({ id }) => id === activeTextFontId) ??
		availableTextFonts[0] ??
		null
	const selectedTextLayout = useMemo(
		() =>
			selectedTextObject === null
				? null
				: textService.layout(selectedTextObject),
		[selectedTextObject, textFontRevision, textService],
	)
	const interactionBoundsForObject = (object: DesignObject) =>
		(effectiveHierarchy.byObjectId.get(object.id)?.clippingForGroupId ??
			null) === null
			? designObjectInteractionBounds(object, textService)
			: objectBounds(object)
	const selectedTextEstimate =
		selectedTextObject === null
			? null
			: estimateDesignTextLayout(selectedTextObject.geometry)
	const textOverset =
		selectedTextLayout?.overset ?? selectedTextEstimate?.overset ?? false
	const textExpansionDisabledReason =
		selectedTextObject === null
			? "Select one text object to expand it."
			: selectedTextEffectiveEntry !== undefined &&
				  (!selectedTextEffectiveEntry.visible ||
						selectedTextEffectiveEntry.locked)
				? effectiveStateReason(
						selectedTextEffectiveEntry,
						"expanding the text object",
					)
				: availableTextFonts.some(
							({ id }) => id === selectedTextObject.geometry.typography.font.id,
					  )
					? null
					: `Load ${selectedTextObject.geometry.typography.font.family} into this workspace before expanding it.`
	const pathCommandContext = {
		document,
		objectSelection: selection,
		directSelection,
		scopeGroupId: currentGroupScope,
		editingDisabledReason:
			selectedUnavailableEntry === undefined
				? null
				: effectiveStateReason(
						selectedUnavailableEntry,
						"editing the selected paths",
					),
	}
	const pathCommandPolicyContext = {
		...pathCommandContext,
		document: effectivePolicyDocument,
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

	const commit = useCallback(
		(next: DesignDocument): void => {
			editorState.actions.commitDocument(next)
		},
		[editorState],
	)
	const placeImageFile = useCallback(
		async (file: File): Promise<void> => {
			const mediaType =
				file.type === "image/png" || /\.png$/iu.test(file.name)
					? "image/png"
					: file.type === "image/jpeg" || /\.jpe?g$/iu.test(file.name)
						? "image/jpeg"
						: null
			if (mediaType === null) {
				setStatus("Place Image supports PNG and JPEG files.")
				return
			}
			if (sourceSession?.installImage === undefined) {
				setStatus("Connect a source workspace before placing an image.")
				return
			}
			try {
				const [bytes, bitmap] = await Promise.all([
					file.arrayBuffer().then((buffer) => new Uint8Array(buffer)),
					globalThis.createImageBitmap(file),
				])
				const intrinsicWidth = bitmap.width
				const intrinsicHeight = bitmap.height
				bitmap.close()
				const id = `asset:${nextId()}`
				const resource = await sourceSession.installImage(
					id,
					bytes,
					file.name,
					mediaType,
				)
				const scale = Math.min(
					1,
					activeArtboard.width / intrinsicWidth,
					activeArtboard.height / intrinsicHeight,
				)
				const placed = placeDesignImage(
					documentRef.current,
					{
						name: file.name.replace(/\.[^.]+$/u, "") || "Placed image",
						source: { kind: "embedded", id },
						mediaType,
						intrinsicWidth,
						intrinsicHeight,
						scale,
						x:
							activeArtboard.x +
							(activeArtboard.width - intrinsicWidth * scale) / 2,
						y:
							activeArtboard.y +
							(activeArtboard.height - intrinsicHeight * scale) / 2,
					},
					activeHierarchyScope,
					nextId,
				)
				setImageResources((current) => [
					...current.filter((candidate) => candidate.id !== resource.id),
					resource,
				])
				commit(placed.document)
				setSelectedBlendId(null)
				setDirectSelection([])
				setSelection([placed.object.id])
				setStatus(`Placed ${file.name} as an embedded image.`)
			} catch (error) {
				setStatus(
					`Could not place ${file.name}: ${error instanceof Error ? error.message : String(error)}`,
				)
			}
		},
		[activeArtboard, activeHierarchyScope, commit, nextId, sourceSession],
	)
	const chooseImageFile = useCallback((): void => {
		const input = globalThis.document.createElement("input")
		input.type = "file"
		input.accept = ".jpg,.jpeg,.png,image/jpeg,image/png"
		input.addEventListener(
			"change",
			() => {
				const file = input.files?.[0]
				if (file !== undefined) void placeImageFile(file)
			},
			{ once: true },
		)
		input.click()
	}, [placeImageFile])
	const beginTextEditing = useCallback(
		(object: DesignObject, selectAll = false): void => {
			if (object.geometry.kind !== "text") return
			const geometry = object.geometry
			const effective = effectiveHierarchy.byObjectId.get(object.id)
			if (effective !== undefined && (!effective.visible || effective.locked)) {
				setStatus(
					effectiveStateReason(effective, "editing its text") ??
						"The text object is unavailable.",
				)
				return
			}
			if (
				!availableTextFonts.some(({ id }) => id === geometry.typography.font.id)
			) {
				setStatus(
					`Load ${geometry.typography.font.family} into this workspace before editing ${object.name}.`,
				)
				return
			}
			setSelection([object.id])
			setDirectSelection([])
			setEditingTextId(object.id)
			setTextSelectionRange({
				start: selectAll ? 0 : geometry.text.length,
				end: geometry.text.length,
			})
			setStatus(`Editing ${object.name}. Escape returns to object selection.`)
		},
		[availableTextFonts, effectiveHierarchy],
	)
	const finishTextEditing = useCallback((): void => {
		if (editingTextId === null) return
		setEditingTextId(null)
		setTextSelectionRange(null)
		setTool("select")
		requestAnimationFrame(() => artboardWrapRef.current?.focus())
		setStatus("Finished editing text.")
	}, [editingTextId])
	const setEditingText = useCallback(
		(text: string): void => {
			if (editingTextId === null) return
			const object = document.objects.find(
				(candidate) => candidate.id === editingTextId,
			)
			if (object?.geometry.kind !== "text" || object.geometry.text === text)
				return
			commit({
				...document,
				objects: document.objects.map((candidate) =>
					candidate.id === object.id
						? updateDesignText(candidate, text)
						: candidate,
				),
			})
		},
		[commit, document, editingTextId],
	)
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
		(property: DesignArtboardProperties): void => {
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
			if (
				intent.kind === "create-object" &&
				activeLayerUnavailableReason !== null
			) {
				setStatus(activeLayerUnavailableReason)
				return false
			}
			const authoredStateIntent =
				intent.kind === "set-object-properties" &&
				intent.name === undefined &&
				(intent.hidden !== undefined || intent.locked !== undefined)
			if (
				intent.kind !== "create-object" &&
				selectedUnavailableEntry !== undefined &&
				(!authoredStateIntent ||
					selectedInheritedUnavailableEntry !== undefined)
			) {
				setStatus(
					effectiveStateReason(
						selectedUnavailableEntry,
						"editing the selection",
					) ?? "The selection is unavailable.",
				)
				return false
			}
			const result = applyDesignVectorIntent(
				document,
				selection,
				intent,
				activeHierarchyScope,
			)
			if (!result.ok) {
				setStatus(result.error)
				return false
			}
			commit(result.document)
			setSelection(result.selection)
			return true
		},
		[
			activeHierarchyScope,
			activeLayerUnavailableReason,
			commit,
			document,
			selectedInheritedUnavailableEntry,
			selectedUnavailableEntry,
			selection,
		],
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
		creationSnapStatusRef.current = false
		setPreviewArtboardDocument(null)
		previewArtboardDocumentRef.current = null
		setGuidePreview(null)
		setTransformCursor(null)
	}, [gesturePolicy])
	useEffect(() => {
		const activeScopeUnavailable =
			(activeLayer.hidden || activeLayer.locked) &&
			(currentGroupScope !== null ||
				gestureRef.current !== null ||
				penPointsRef.current.length > 0)
		if (
			selectedInheritedUnavailableEntry === undefined &&
			selectedBlendUnavailableEntry === undefined &&
			!activeScopeUnavailable
		)
			return
		cancelCanvasGesture()
		const activeTask = pathfinderTaskRef.current
		if (activeTask !== null) {
			pathfinderGenerationRef.current += 1
			activeTask.task.cancel()
			pathfinderTaskRef.current = null
			setActivePathfinder(null)
		}
		setSelection((current) =>
			current.filter((id) => {
				const entry = effectiveHierarchy.byObjectId.get(id)
				return entry?.visible === true && !entry.locked
			}),
		)
		setDirectSelection((current) =>
			current.filter((target) => {
				const entry = effectiveHierarchy.byObjectId.get(target.objectId)
				return entry?.visible === true && !entry.locked
			}),
		)
		if (selectedBlendUnavailableEntry !== undefined) setSelectedBlendId(null)
		if (activeScopeUnavailable) setGroupScope([])
		const editingEntry =
			editingTextId === null
				? undefined
				: effectiveHierarchy.byObjectId.get(editingTextId)
		if (
			editingEntry !== undefined &&
			(!editingEntry.visible || editingEntry.locked)
		) {
			setEditingTextId(null)
			setTextSelectionRange(null)
		}
		setStatus(
			(selectedInheritedUnavailableEntry === undefined
				? selectedBlendUnavailableEntry === undefined
					? activeLayerUnavailableReason
					: effectiveStateReason(
							selectedBlendUnavailableEntry,
							"editing the live blend",
						)
				: effectiveStateReason(
						selectedInheritedUnavailableEntry,
						"continuing the edit",
					)) ?? "The active hierarchy scope is unavailable.",
		)
	}, [
		activeLayer.hidden,
		activeLayer.locked,
		activeLayerUnavailableReason,
		cancelCanvasGesture,
		currentGroupScope,
		editingTextId,
		effectiveHierarchy,
		selectedBlendUnavailableEntry,
		selectedInheritedUnavailableEntry,
	])

	const selectTool = useCallback(
		(nextTool: DesignTool): void => {
			if (
				(nextTool === "text" || nextTool === "area-text") &&
				textToolsDisabledReason !== null
			) {
				setStatus(textToolsDisabledReason)
				return
			}
			cancelCanvasGesture()
			if (editingTextId !== null) {
				setEditingTextId(null)
				setTextSelectionRange(null)
			}
			if (nextTool !== "direct") setDirectSelection([])
			if (nextTool === "select" || nextTool === "transform")
				setSelection((current) =>
					normalizeDesignSelection(
						document,
						current,
						currentGroupScope,
						effectiveEditableObjectIds,
					),
				)
			setTool(nextTool)
			setStatus(`${DESIGN_TOOLS[nextTool].label} tool`)
		},
		[
			cancelCanvasGesture,
			currentGroupScope,
			document,
			editingTextId,
			effectiveEditableObjectIds,
			textToolsDisabledReason,
		],
	)
	useEffect(() => {
		if (
			textToolsDisabledReason === null ||
			(tool !== "text" && tool !== "area-text")
		)
			return
		cancelCanvasGesture()
		setTool("select")
		setStatus(textToolsDisabledReason)
	}, [cancelCanvasGesture, textToolsDisabledReason, tool])
	useEffect(() => {
		if (
			editingTextObject === null ||
			editingTextObject.geometry.kind !== "text"
		)
			return
		const geometry = editingTextObject.geometry
		if (availableTextFonts.some(({ id }) => id === geometry.typography.font.id))
			return
		setEditingTextId(null)
		setTextSelectionRange(null)
		setTool("select")
		setStatus(
			`Text editing stopped because ${geometry.typography.font.family} is no longer available in this workspace.`,
		)
	}, [availableTextFonts, editingTextObject])

	const deleteSelection = useCallback((): void => {
		if (selectedBlend !== null) {
			if (selectedBlend.locked) {
				setStatus(`Unlock ${selectedBlend.name} before deleting it.`)
				return
			}
			const next = {
				...document,
				blends: (document.blends ?? []).filter(
					({ id }) => id !== selectedBlend.id,
				),
			}
			pathCommandSelectionsRef.current.set(document, {
				objectSelection: [],
				directSelection: [],
				blendId: selectedBlend.id,
			})
			pathCommandSelectionsRef.current.set(next, {
				objectSelection: [],
				directSelection: [],
			})
			commit(next)
			setSelectedBlendId(null)
			setStatus("Deleted live blend; endpoint objects were retained.")
			return
		}
		if (selection.length === 0) return
		if (selectedUnavailableEntry !== undefined) {
			setStatus(
				effectiveStateReason(
					selectedUnavailableEntry,
					"deleting the complete selection",
				) ?? "The selection is unavailable.",
			)
			return
		}
		if (
			commitVectorIntent({
				kind: "delete",
				objectIds: selection,
			})
		)
			setStatus("Deleted selection.")
	}, [
		commit,
		commitVectorIntent,
		document,
		selectedBlend,
		selectedUnavailableEntry,
		selection,
	])

	const duplicateSelection = useCallback((): void => {
		if (selectedUnavailableEntry !== undefined) {
			setStatus(
				effectiveStateReason(
					selectedUnavailableEntry,
					"duplicating the selection",
				) ?? "The selection is unavailable.",
			)
			return
		}
		const result = duplicateDesignObjects(document, selection, nextId)
		if (result === null) return
		commit(result.document)
		setSelection(result.selection)
		setDirectSelection([])
		setStatus(
			`Duplicated ${selectedGroup?.name ?? `${result.selection.length} object${result.selection.length === 1 ? "" : "s"}`} with offset.`,
		)
	}, [
		commit,
		document,
		nextId,
		selectedGroup?.name,
		selectedUnavailableEntry,
		selection,
	])

	const groupSelection = useCallback((): void => {
		if (selectedUnavailableEntry !== undefined) {
			setStatus(
				effectiveStateReason(
					selectedUnavailableEntry,
					"grouping the selection",
				) ?? "The selection is unavailable.",
			)
			return
		}
		const result = groupDesignSelection(document, selection, nextId)
		if (result === null) {
			setStatus("Select at least two sibling objects to group.")
			return
		}
		commit(result.document)
		setSelection(result.selection)
		setDirectSelection([])
		setStatus("Grouped selection.")
	}, [commit, document, nextId, selectedUnavailableEntry, selection])

	const ungroupSelection = useCallback((): void => {
		if (selectedUnavailableEntry !== undefined) {
			setStatus(
				effectiveStateReason(
					selectedUnavailableEntry,
					"ungrouping the selection",
				) ?? "The selection is unavailable.",
			)
			return
		}
		const result = ungroupDesignSelection(document, selection)
		if (result === null) {
			setStatus("Select every object in one group to ungroup it.")
			return
		}
		commit(result.document)
		setSelection(result.selection)
		setDirectSelection([])
		setStatus("Ungrouped selection.")
	}, [commit, document, selectedUnavailableEntry, selection])

	const makeClippingMask = useCallback((): void => {
		const result = makeDesignClippingMask(document, selection, nextId)
		if (result === null) {
			setStatus(
				"Select sibling artwork with a topmost vector object to make a clipping mask.",
			)
			return
		}
		commit(result.document)
		setSelection(result.selection)
		setDirectSelection([])
		setStatus(
			"Created clipping mask; double-click it to edit the path and contents separately.",
		)
	}, [commit, document, nextId, selection])

	const releaseClippingMask = useCallback((): void => {
		if (selectedGroup === null) return
		const result = releaseDesignClippingMask(document, selectedGroup.id)
		if (result === null) {
			setStatus("Select a clipping-mask group to release it.")
			return
		}
		commit(result.document)
		setSelection(result.selection)
		setStatus("Released clipping mask; the path is ordinary artwork again.")
	}, [commit, document, selectedGroup])

	const stackSelection = useCallback(
		(command: DesignStackCommand): void => {
			if (selectedUnavailableEntry !== undefined) {
				setStatus(
					effectiveStateReason(
						selectedUnavailableEntry,
						"changing the selection stacking order",
					) ?? "The selection is unavailable.",
				)
				return
			}
			const result = stackDesignSelection(document, selection, command)
			if (result === null) {
				setStatus("The selection is already at that stacking position.")
				return
			}
			commit(result.document)
			setSelection(result.selection)
			setStatus("Changed selection stacking order.")
		},
		[commit, document, selectedUnavailableEntry, selection],
	)

	const alignSelection = useCallback(
		(
			alignment: DesignAlignment,
			target: DesignAlignmentTarget,
			keyObjectId?: string,
		): void => {
			if (selectionTransformDisabledReason !== null) {
				setStatus(selectionTransformDisabledReason)
				return
			}
			const next = alignDesignObjects(
				document,
				selection,
				alignment,
				target,
				activeArtboard,
				keyObjectId,
			)
			if (next === null) return
			commit(next)
			setStatus(`Aligned selection ${alignment}.`)
		},
		[
			activeArtboard,
			commit,
			document,
			selection,
			selectionTransformDisabledReason,
		],
	)

	const distributeSelection = useCallback(
		(axis: "x" | "y"): void => {
			if (selectionTransformDisabledReason !== null) {
				setStatus(selectionTransformDisabledReason)
				return
			}
			const next = distributeDesignObjects(document, selection, axis)
			if (next === null) return
			commit(next)
			setStatus(
				`Distributed selection ${axis === "x" ? "horizontally" : "vertically"}.`,
			)
		},
		[commit, document, selection, selectionTransformDisabledReason],
	)

	const transformSelection = useCallback(
		(input: Parameters<typeof transformDesignSelection>[2]): void => {
			if (selectionTransformDisabledReason !== null) {
				setStatus(selectionTransformDisabledReason)
				return
			}
			const next = transformDesignSelection(document, selection, input)
			if (next === null) return
			commit(next)
			setStatus("Transformed selection numerically.")
		},
		[commit, document, selection, selectionTransformDisabledReason],
	)

	const expandSelection = useCallback((): void => {
		if (!expansionEligibility.eligible) {
			setStatus(expansionEligibility.reason)
			return
		}
		const expanded = expandDesignShape(expansionEligibility.object, nextId)
		commit({
			...document,
			objects: document.objects.map((object) =>
				object.id === expanded.id ? expanded : object,
			),
		})
		setSelection([expanded.id])
		setStatus(`Expanded ${expanded.name} to ordinary path geometry.`)
	}, [commit, document, expansionEligibility, nextId])

	const expandStrokeSelection = useCallback((): void => {
		if (!strokeEligibility.eligible) {
			setStatus(strokeEligibility.reason)
			return
		}
		const result = expandDesignStroke(strokeEligibility.object, nextId)
		if (!result.ok) {
			setStatus(result.error)
			return
		}
		const index = document.objects.findIndex(
			(object) => object.id === strokeEligibility.object.id,
		)
		if (index < 0) {
			setStatus("The selected object is unavailable.")
			return
		}
		commit(
			replaceDesignHierarchyObject(
				{
					...document,
					objects: [
						...document.objects.slice(0, index),
						...result.objects,
						...document.objects.slice(index + 1),
					],
				},
				strokeEligibility.object.id,
				result.objects.map((object) => object.id),
			),
		)
		setSelection([result.selectedObjectId])
		setDirectSelection([])
		setStatus(
			`Expanded ${strokeEligibility.object.name}'s stroke to filled contours.`,
		)
	}, [commit, document, nextId, strokeEligibility])

	const makeBlend = useCallback((): void => {
		if (!blendEligibility.eligible) {
			setStatus(blendEligibility.reason)
			return
		}
		const result = makeDesignBlend(document, selection, nextId)
		if (result === null) return
		pathCommandSelectionsRef.current.set(document, {
			objectSelection: selection,
			directSelection,
		})
		pathCommandSelectionsRef.current.set(result.document, {
			objectSelection: [],
			directSelection: [],
			blendId: result.blendId,
		})
		commit(result.document)
		setSelection([])
		setDirectSelection([])
		setSelectedBlendId(result.blendId)
		setStatus(
			blendEligibility.warnings.length === 0
				? "Created live blend with 5 specified steps."
				: `Created live blend. ${blendEligibility.warnings.join(" ")}`,
		)
	}, [commit, directSelection, document, blendEligibility, nextId, selection])

	const setBlendProperty = useCallback(
		(
			blend: DesignBlend,
			property: Partial<Pick<DesignBlend, "name" | "steps">>,
		): void => {
			const next = updateDesignBlend(document, blend.id, property)
			if (next === null) {
				setStatus("Specified steps must be an integer from 1 through 10000.")
				return
			}
			pathCommandSelectionsRef.current.set(document, {
				objectSelection: [],
				directSelection: [],
				blendId: blend.id,
			})
			pathCommandSelectionsRef.current.set(next, {
				objectSelection: [],
				directSelection: [],
				blendId: blend.id,
			})
			commit(next)
			setStatus(
				property.steps === undefined
					? "Renamed live blend."
					: `Updated live blend to ${property.steps} specified steps.`,
			)
		},
		[commit, document],
	)

	const reverseBlendEndpoint = useCallback(
		(endpoint: "start" | "end"): void => {
			if (selectedBlend === null) return
			const next = reverseDesignBlendEndpoint(
				document,
				selectedBlend.id,
				endpoint,
			)
			if (next === null) {
				setStatus("Direction editing requires an unlocked path endpoint.")
				return
			}
			pathCommandSelectionsRef.current.set(document, {
				objectSelection: [],
				directSelection: [],
				blendId: selectedBlend.id,
			})
			pathCommandSelectionsRef.current.set(next, {
				objectSelection: [],
				directSelection: [],
				blendId: selectedBlend.id,
			})
			commit(next)
			setStatus(`Reversed ${endpoint} endpoint direction.`)
		},
		[commit, document, selectedBlend],
	)

	const setBlendFirstPoint = useCallback(
		(endpoint: "start" | "end", contourId: string, pointId: string): void => {
			if (selectedBlend === null) return
			const next = setDesignBlendFirstPoint(
				document,
				selectedBlend.id,
				endpoint,
				contourId,
				pointId,
			)
			if (next === null) {
				setStatus(
					"First-point editing requires an unlocked closed path contour.",
				)
				return
			}
			pathCommandSelectionsRef.current.set(document, {
				objectSelection: [],
				directSelection: [],
				blendId: selectedBlend.id,
			})
			pathCommandSelectionsRef.current.set(next, {
				objectSelection: [],
				directSelection: [],
				blendId: selectedBlend.id,
			})
			commit(next)
			setStatus(`Updated ${endpoint} endpoint correspondence first point.`)
		},
		[commit, document, selectedBlend],
	)

	const expandBlend = useCallback((): void => {
		if (selectedBlend === null) return
		const result = expandDesignBlend(document, selectedBlend.id, nextId)
		if (result === null) {
			setStatus("Resolve blend diagnostics before expanding the live blend.")
			return
		}
		pathCommandSelectionsRef.current.set(document, {
			objectSelection: [],
			directSelection: [],
			blendId: selectedBlend.id,
		})
		pathCommandSelectionsRef.current.set(result.document, {
			objectSelection: result.selection,
			directSelection: [],
		})
		commit(result.document)
		setSelectedBlendId(null)
		setSelection(result.selection)
		setDirectSelection([])
		setStatus(
			`Expanded ${selectedBlend.name} into ${result.selection.length} selected ordinary path${result.selection.length === 1 ? "" : "s"}; endpoints were retained.`,
		)
	}, [commit, document, nextId, selectedBlend])
	const applyTextTypography = useCallback(
		(properties: Partial<DesignTextTypography>): void => {
			if (selectedTextObject === null) {
				setStatus("Select one text object before editing typography.")
				return
			}
			if (
				selectedTextEffectiveEntry !== undefined &&
				(!selectedTextEffectiveEntry.visible ||
					selectedTextEffectiveEntry.locked)
			) {
				setStatus(
					effectiveStateReason(
						selectedTextEffectiveEntry,
						"editing typography",
					) ?? "The text object is unavailable.",
				)
				return
			}
			const merged = {
				...selectedTextObject.geometry.typography,
				...properties,
			}
			if (
				!Number.isFinite(merged.size) ||
				merged.size <= 0 ||
				!Number.isFinite(merged.leading) ||
				merged.leading <= 0 ||
				!Number.isFinite(merged.tracking) ||
				(merged.kerning !== "auto" && !Number.isFinite(merged.kerning))
			) {
				setStatus(
					"Type size and leading must be positive; all typography values must be finite.",
				)
				return
			}
			commit({
				...document,
				objects: document.objects.map((object) =>
					object.id === selectedTextObject.id
						? updateDesignTextTypography(object, properties)
						: object,
				),
			})
			setStatus(
				`Updated typography for the complete ${selectedTextObject.name} object.`,
			)
		},
		[commit, document, selectedTextEffectiveEntry, selectedTextObject],
	)
	const selectTextFont = useCallback(
		(fontId: string): void => {
			const font = availableTextFonts.find(({ id }) => id === fontId)
			if (font === undefined) {
				setStatus("Choose a font that is loaded in this workspace.")
				return
			}
			setActiveTextFontId(font.id)
			if (selectedTextObject !== null) applyTextTypography({ font })
			else setStatus(`${font.family} will be used for new text.`)
		},
		[applyTextTypography, availableTextFonts, selectedTextObject],
	)
	const registerTextFont = useCallback(
		async (file: File): Promise<void> => {
			const family =
				file.name.replace(/\.(?:otf|ttf|woff2?)$/iu, "").trim() || "Font"
			const requestedReference = {
				id: designTextFamilyId(family),
				family,
				revision: file.lastModified || file.size,
			}
			const bytes = new Uint8Array(await file.arrayBuffer())
			const wasRegistered = registeredTextFontIdsRef.current.has(
				requestedReference.id,
			)
			const diagnostics = textService.registerFont(requestedReference, bytes)
			const error = diagnostics.find(({ severity }) => severity === "error")
			if (error !== undefined) {
				setStatus(`Could not load ${file.name}: ${error.message}`)
				return
			}
			let reference: DesignFontReference
			try {
				reference =
					props.sourceSession?.installFont === undefined
						? requestedReference
						: await props.sourceSession.installFont(
								requestedReference,
								bytes,
								file.name,
								file.type,
							)
			} catch (error) {
				if (!wasRegistered) textService.unregisterFont(requestedReference.id)
				setStatus(
					`Could not add ${file.name} to the workspace: ${error instanceof Error ? error.message : String(error)}`,
				)
				return
			}
			if (reference.id !== requestedReference.id)
				textService.unregisterFont(requestedReference.id)
			const persistedDiagnostics = textService.registerFont(reference, bytes)
			const persistedError = persistedDiagnostics.find(
				({ severity }) => severity === "error",
			)
			if (persistedError !== undefined) {
				setStatus(`Could not load ${file.name}: ${persistedError.message}`)
				return
			}
			registeredTextFontIdsRef.current = new Set([
				...registeredTextFontIdsRef.current,
				reference.id,
			])
			let browserFont: Awaited<ReturnType<typeof loadBrowserTextFont>>
			try {
				browserFont = await loadBrowserTextFont(reference, bytes)
				activateBrowserTextFont(reference, browserFont)
			} catch (error) {
				setTextFontResources((current) => [
					...current.filter(({ reference: item }) => item.id !== reference.id),
					{ reference, bytes },
				])
				setTextFontRevision((revision) => revision + 1)
				setStatus(
					`Installed ${file.name}, but could not load it in the browser: ${error instanceof Error ? error.message : String(error)}`,
				)
				return
			}
			setTextFontResources((current) => [
				...current.filter(({ reference: item }) => item.id !== reference.id),
				{ reference, bytes },
			])
			setAvailableTextFonts((current) =>
				uniqueTextFonts([...current, reference]),
			)
			setActiveTextFontId(reference.id)
			setTextFontRevision((revision) => revision + 1)
			if (selectedTextObject !== null) applyTextTypography({ font: reference })
			setStatus(
				`Loaded ${family} for canonical canvas, PDF, and expansion output.`,
			)
		},
		[
			activateBrowserTextFont,
			applyTextTypography,
			loadBrowserTextFont,
			props.sourceSession,
			selectedTextObject,
			textService,
		],
	)
	const applyAreaTextFrame = useCallback(
		(properties: Partial<NonNullable<DesignTextGeometry["frame"]>>): void => {
			if (
				selectedTextObject?.geometry.mode !== "area" ||
				selectedTextObject.geometry.frame === undefined
			)
				return
			if (
				selectedTextEffectiveEntry !== undefined &&
				(!selectedTextEffectiveEntry.visible ||
					selectedTextEffectiveEntry.locked)
			) {
				setStatus(
					effectiveStateReason(
						selectedTextEffectiveEntry,
						"resizing the text frame",
					) ?? "The text object is unavailable.",
				)
				return
			}
			const frame = { ...selectedTextObject.geometry.frame, ...properties }
			if (
				!Number.isFinite(frame.width) ||
				!Number.isFinite(frame.height) ||
				frame.width <= 0 ||
				frame.height <= 0
			) {
				setStatus("Area text frame dimensions must be positive finite values.")
				return
			}
			commit({
				...document,
				objects: document.objects.map((object) =>
					object.id === selectedTextObject.id
						? updateDesignAreaTextFrame(object, properties)
						: object,
				),
			})
			setStatus(
				`Resized ${selectedTextObject.name}; source text was preserved and reflowed.`,
			)
		},
		[commit, document, selectedTextEffectiveEntry, selectedTextObject],
	)
	const areaTextConversionDisabledReason =
		textToolsDisabledReason ??
		(selectedObject === null
			? "Select one live rectangle to convert it to Area Type."
			: selectedObjectEffectiveEntry !== undefined &&
				  (!selectedObjectEffectiveEntry.visible ||
						selectedObjectEffectiveEntry.locked)
				? effectiveStateReason(
						selectedObjectEffectiveEntry,
						"converting the object",
					)
				: selectedObject.geometry.kind !== "rectangle"
					? "Initial Area Type conversion supports live rectangular frames; concave and compound paths are explicitly unsupported."
					: null)
	const convertSelectionToAreaText = useCallback((): void => {
		if (
			activeTextFont === null ||
			selectedObject?.geometry.kind !== "rectangle" ||
			(selectedObjectEffectiveEntry !== undefined &&
				(!selectedObjectEffectiveEntry.visible ||
					selectedObjectEffectiveEntry.locked))
		) {
			setStatus(
				areaTextConversionDisabledReason ?? "Cannot convert this object.",
			)
			return
		}
		const rectangle = selectedObject.geometry
		const converted = createDesignTextObject({
			id: selectedObject.id,
			name: `${selectedObject.name} area text`,
			mode: "area",
			x: rectangle.x,
			y: rectangle.y,
			width: rectangle.width,
			height: rectangle.height,
			appearance: selectedObject.appearance,
			text: DESIGN_TEXT_INITIAL_DRAFT,
			typography: {
				...DEFAULT_DESIGN_TEXT_TYPOGRAPHY,
				font: activeTextFont,
			},
		})
		const object = { ...converted, transform: selectedObject.transform }
		commit({
			...document,
			objects: document.objects.map((candidate) =>
				candidate.id === selectedObject.id ? object : candidate,
			),
		})
		beginTextEditing(object, true)
		setStatus(
			`Converted ${selectedObject.name} to a rectangular Area Type frame.`,
		)
	}, [
		areaTextConversionDisabledReason,
		activeTextFont,
		beginTextEditing,
		commit,
		document,
		selectedObject,
		selectedObjectEffectiveEntry,
	])
	const expandTextSelection = useCallback((): void => {
		if (selectedTextObject === null) {
			setStatus("Select one text object to expand it.")
			return
		}
		if (
			selectedTextEffectiveEntry !== undefined &&
			(!selectedTextEffectiveEntry.visible || selectedTextEffectiveEntry.locked)
		) {
			setStatus(
				effectiveStateReason(
					selectedTextEffectiveEntry,
					"expanding the text object",
				) ?? "The text object is unavailable.",
			)
			return
		}
		const expanded = textService.expand(
			selectedTextObject,
			`expanded:${nextId()}`,
		)
		if (expanded === null || expanded.objects.length === 0) {
			setStatus(
				"Could not expand text. Register its font and resolve every missing glyph or unavailable outline first.",
			)
			return
		}
		const index = document.objects.findIndex(
			(object) => object.id === selectedTextObject.id,
		)
		if (index < 0) return
		const replacement = replaceDesignHierarchyObject(
			{
				...document,
				objects: [
					...document.objects.slice(0, index),
					...expanded.objects,
					...document.objects.slice(index + 1),
				],
			},
			selectedTextObject.id,
			expanded.objects.map(({ id }) => id),
		)
		const grouped =
			expanded.objects.length > 1
				? groupDesignSelection(
						replacement,
						expanded.objects.map(({ id }) => id),
						nextId,
					)
				: null
		commit(grouped?.document ?? replacement)
		setSelection(grouped?.selection ?? expanded.objects.map(({ id }) => id))
		setEditingTextId(null)
		setTextSelectionRange(null)
		setStatus(`Expanded ${selectedTextObject.name} to editable glyph paths.`)
	}, [
		commit,
		document,
		nextId,
		selectedTextEffectiveEntry,
		selectedTextObject,
		textService,
	])

	const executePartitionPathfinder = useCallback(
		(command: DesignPartitionPathfinderCommand): void => {
			if (pathfinderTaskRef.current !== null) {
				setStatus(
					"Cancel the active Pathfinder operation before starting another.",
				)
				return
			}
			const sourceDocument = document
			const sourceScopeGroupId = currentGroupScope
			const label = pathfinderOperationLabel(command)
			const generation = ++pathfinderGenerationRef.current
			setActivePathfinder({
				cancellationRequested: false,
				command,
				label,
				progress: null,
			})
			setStatus(`${label}: preparing off-thread geometry…`)
			let task: PathfinderWorkerTask
			try {
				task = pathfinderClient.run(
					{
						command,
						context: pathCommandContext,
						idSeed: nextId(),
					},
					(progress) => {
						if (generation !== pathfinderGenerationRef.current) return
						setActivePathfinder((current) =>
							current?.command !== command ? current : { ...current, progress },
						)
						setStatus(
							progress.phase === "materializing"
								? `${label}: materializing from ${progress.pieceCount} partition pieces…`
								: `${label}: partitioning ${progress.completedRegions} of ${progress.totalRegions} regions · ${progress.pieceCount} pieces…`,
						)
					},
				)
			} catch (error) {
				setActivePathfinder(null)
				setStatus(
					error instanceof Error
						? error.message
						: "Pathfinder worker could not start.",
				)
				return
			}
			pathfinderTaskRef.current = { generation, sourceDocument, task }
			void task.result.then((outcome) => {
				if (generation !== pathfinderGenerationRef.current) return
				pathfinderTaskRef.current = null
				setActivePathfinder(null)
				if (outcome.status === "cancelled") {
					setStatus(`${label} was cancelled; the document was not changed.`)
					return
				}
				if (outcome.status === "failed") {
					setStatus(outcome.error)
					return
				}
				if (
					documentRef.current !== sourceDocument ||
					!sameStringSelection(selectionRef.current, selection) ||
					!sameDirectSelection(directSelectionRef.current, directSelection) ||
					currentGroupScopeRef.current !== sourceScopeGroupId
				) {
					setStatus(
						`${label} finished, but its result was discarded because the document, selection, or editing scope changed.`,
					)
					return
				}
				const result = outcome.result
				if (!result.ok) {
					setStatus(result.error)
					return
				}
				pathCommandSelectionsRef.current.set(sourceDocument, {
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
			})
		},
		[
			commit,
			currentGroupScope,
			directSelection,
			document,
			nextId,
			pathCommandContext,
			pathfinderClient,
			selection,
		],
	)

	const cancelPartitionPathfinder = useCallback((): void => {
		const active = pathfinderTaskRef.current
		if (active === null) return
		active.task.cancel()
		setActivePathfinder((current) =>
			current === null ? null : { ...current, cancellationRequested: true },
		)
		setStatus("Cancelling Pathfinder; the document remains unchanged…")
	}, [])

	const executePathCommand = useCallback(
		(command: DesignPathCommand): void => {
			const eligibility = designPathCommandEligibility(
				command,
				pathCommandPolicyContext,
			)
			if (!eligibility.eligible) {
				setStatus(eligibility.reason)
				return
			}
			if (isDesignPartitionPathfinderCommand(command)) {
				executePartitionPathfinder(command)
				return
			}
			const result = applyDesignPathCommand(command, pathCommandContext, {
				nextId,
			})
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
		[
			commit,
			directSelection,
			document,
			executePartitionPathfinder,
			nextId,
			pathCommandContext,
			pathCommandPolicyContext,
			selection,
		],
	)

	const navigateDesignHistory = useCallback(
		(type: "redo" | "undo"): void => {
			if (type === "undo") {
				if (historyAt === 0) return
				pendingHistorySelectionRef.current = historyAt - 1
				undoDocument()
			} else {
				if (historyAt === historyLength) return
				pendingHistorySelectionRef.current = historyAt + 1
				redoDocument()
			}
		},
		[historyAt, historyLength, redoDocument, undoDocument],
	)
	useEffect(() => {
		if (pendingHistorySelectionRef.current !== historyAt) return
		restoringHistorySelectionRef.current = true
		pendingHistorySelectionRef.current = null
		const recorded =
			historySelectionsRef.current.get(historyAt) ??
			pathCommandSelectionsRef.current.get(document)
		if (recorded === undefined) return
		setSelection(recorded.objectSelection)
		setDirectSelection(recorded.directSelection)
		setSelectedBlendId(recorded.blendId ?? null)
		if (
			recorded.layerId !== undefined &&
			document.layers.some((layer) => layer.id === recorded.layerId)
		)
			setSelectedLayerId(recorded.layerId)
		if (recorded.groupScope !== undefined) setGroupScope(recorded.groupScope)
	}, [document, historyAt])
	useEffect(() => {
		if (restoringHistorySelectionRef.current) {
			restoringHistorySelectionRef.current = false
			return
		}
		if (pendingHistorySelectionRef.current !== null) return
		historySelectionsRef.current.set(historyAt, {
			objectSelection: selection,
			directSelection,
			...(selectedBlendId === null ? {} : { blendId: selectedBlendId }),
			layerId: activeLayerId,
			groupScope,
		})
	}, [
		activeLayerId,
		directSelection,
		groupScope,
		historyAt,
		selectedBlendId,
		selection,
	])

	const finishPen = useCallback(
		(closed = false): void => {
			if (activeLayerUnavailableReason !== null) {
				cancelCanvasGesture()
				setStatus(activeLayerUnavailableReason)
				return
			}
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
			commit(
				appendDesignHierarchyObjects(
					{ ...document, objects: [...document.objects, object] },
					[object.id],
					activeHierarchyScope,
				),
			)
			setSelection([object.id])
			penPointsRef.current = []
			setPenPoints([])
			setGesturePreview(null)
			gestureRef.current = null
			setStatus(
				`Created ${closed ? "closed" : "open"} ${object.name.toLowerCase()}.`,
			)
		},
		[
			activeHierarchyScope,
			activeLayerUnavailableReason,
			cancelCanvasGesture,
			commit,
			authoredAppearance,
			document,
			nextId,
		],
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
	const exportSvgDocument = useCallback(
		(target: SvgExportTarget): void => {
			const preflight = svgDownloadManager.preflight(document, target)
			if (preflight.decision === "blocked") {
				void svgDownloadManager.request(document, target)
				openTile("export")
				setStatus(
					`SVG export blocked by ${preflight.summary.errors} preflight error${preflight.summary.errors === 1 ? "" : "s"}.`,
				)
				return
			}
			setStatus(`Preparing ${document.title}.svg…`)
			void svgDownloadManager.request(document, target).then(
				(downloaded) => {
					if (downloaded)
						setStatus(
							`Exported ${document.title}.svg with ${document.objects.length} vector objects.`,
						)
				},
				(error) =>
					setStatus(
						`SVG export failed: ${error instanceof Error ? error.message : String(error)}`,
					),
			)
		},
		[document, openTile, svgDownloadManager],
	)
	const exportPngDocument = useCallback(
		(request: PngExportRequest): void => {
			const preflight = pngDownloadManager.preflight(document, request)
			if (preflight.decision === "blocked") {
				void pngDownloadManager.request(document, request)
				openTile("export")
				setStatus(
					`PNG export blocked by ${preflight.summary.errors} preflight error${preflight.summary.errors === 1 ? "" : "s"}.`,
				)
				return
			}
			setStatus(
				`Rasterizing ${preflight.artboards.length} PNG ${preflight.artboards.length === 1 ? "image" : "images"}…`,
			)
			void pngDownloadManager.request(document, request).then(
				(downloaded) => {
					if (downloaded)
						setStatus(
							`Exported ${preflight.artboards.length} PNG ${preflight.artboards.length === 1 ? "image" : "images"}.`,
						)
				},
				(error) =>
					setStatus(
						`PNG export failed: ${error instanceof Error ? error.message : String(error)}`,
					),
			)
		},
		[document, openTile, pngDownloadManager],
	)
	const importSvgDocument = useCallback(
		(source: string): SvgImportResult => {
			if (activeLayerUnavailableReason !== null) {
				setStatus(activeLayerUnavailableReason)
				return {
					diagnostics: [
						{
							code: "svg.import.active-layer",
							message: activeLayerUnavailableReason,
							severity: "error",
							stage: "import",
						},
					],
					document,
					importedObjectIds: [],
					ok: false,
				}
			}
			const result = importSvg(source, document, {
				artboardId: activeArtboard.id,
				hierarchyScope: activeHierarchyScope,
				nextId,
			})
			if (result.ok && result.importedObjectIds.length > 0) {
				// The complete import is one document commit and therefore one history entry.
				commit(result.document)
				setSelection(result.importedObjectIds)
			}
			const warnings = result.diagnostics.filter(
				({ severity }) => severity === "warning",
			).length
			setStatus(
				result.ok
					? `Imported ${result.importedObjectIds.length} SVG object${result.importedObjectIds.length === 1 ? "" : "s"}${warnings === 0 ? "." : ` with ${warnings} warning${warnings === 1 ? "" : "s"}.`}`
					: `SVG import failed: ${result.diagnostics[0]?.message ?? "No supported content was found."}`,
			)
			return result
		},
		[
			activeArtboard.id,
			activeHierarchyScope,
			activeLayerUnavailableReason,
			commit,
			document,
			nextId,
		],
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
		const effective = effectiveHierarchy.byObjectId.get(object.id)
		if (effective !== undefined && (!effective.visible || effective.locked)) {
			setStatus(
				effectiveStateReason(effective, "editing its shape parameters") ??
					"The shape is unavailable.",
			)
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

	const activateAppearanceTarget = useCallback(
		(target: AppearancePaintTarget): void => {
			setAppearanceTarget(target)
			const value = appearanceSummary[target]
			if (value !== null && value !== "mixed") setSelectedSwatchId(value)
			setStatus(`${target === "fill" ? "Fill" : "Stroke"} paint target active.`)
		},
		[appearanceSummary],
	)

	const swapSingleObjectAppearance = useCallback((): void => {
		if (gestureRef.current !== null || penPointsRef.current.length > 0) {
			setStatus("Finish the active canvas gesture before swapping paints.")
			return
		}
		if (selection.length !== 1 || selectedObjects.length !== 1) {
			setStatus(
				"Select exactly one complete object to swap its fill and stroke.",
			)
			return
		}
		const object = selectedObjects[0]!
		if (selectedUnavailableEntry !== undefined) {
			setStatus(
				effectiveStateReason(
					selectedUnavailableEntry,
					"swapping its fill and stroke",
				) ?? "The object is unavailable.",
			)
			return
		}
		const swatchIds = new Set(document.swatches.map(({ id }) => id))
		const unavailable = [
			object.appearance.fill?.swatchId,
			object.appearance.stroke?.swatchId,
		].find((id) => id !== undefined && !swatchIds.has(id))
		if (unavailable !== undefined) {
			setStatus(
				`Paint ${unavailable} is unavailable; fill and stroke were not swapped.`,
			)
			return
		}
		const appearance = swapDesignAppearancePaints(object.appearance)
		if (JSON.stringify(appearance) === JSON.stringify(object.appearance)) {
			setStatus(
				object.appearance.fill === undefined &&
					object.appearance.stroke === undefined
					? `${object.name} has no fill or stroke to swap.`
					: `${object.name}'s fill and stroke are already the same.`,
			)
			return
		}
		commit({
			...document,
			objects: document.objects.map((candidate) =>
				candidate.id === object.id ? { ...candidate, appearance } : candidate,
			),
		})
		setStatus(`Swapped fill and stroke for ${object.name}.`)
	}, [
		commit,
		document,
		selectedObjects,
		selectedUnavailableEntry,
		selection.length,
	])

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
				setSelection(
					normalizeDesignSelection(document, [object.id], currentGroupScope),
				)
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
		activeLayerId,
		activeGroupScope: groupScope,
		selectedGroupId: selectedGroup?.id ?? null,
		createLayer: () => {
			const layerId = `layer:${nextId()}`
			const name = `Layer ${document.layers.length + 1}`
			commit(createDesignLayer(document, { id: layerId, name }))
			setSelectedLayerId(layerId)
			setGroupScope([])
			setSelection([])
			setDirectSelection([])
			setSelectedBlendId(null)
			setStatus(`${name} created and made the target layer.`)
		},
		deleteLayer: (layerId) => {
			const layer = document.layers.find(({ id }) => id === layerId)
			if (layer === undefined) return
			try {
				const deleted = deleteDesignLayer(document, layerId)
				commit(deleted.document)
				setSelection((current) =>
					current.filter((id) => !deleted.removedObjectIds.includes(id)),
				)
				setDirectSelection((current) =>
					current.filter(
						(target) => !deleted.removedObjectIds.includes(target.objectId),
					),
				)
				setSelectedBlendId(null)
				if (layerId === activeLayerId) {
					setSelectedLayerId(deleted.fallbackLayerId)
					setGroupScope([])
				}
				setStatus(
					`${layer.name} and ${deleted.removedObjectIds.length} descendant object${deleted.removedObjectIds.length === 1 ? "" : "s"} deleted.`,
				)
			} catch (error) {
				setStatus(error instanceof Error ? error.message : String(error))
			}
		},
		duplicateLayer: (layerId) => {
			const layer = document.layers.find(({ id }) => id === layerId)
			if (layer === undefined) return
			const duplicated = duplicateDesignLayer(
				document,
				layerId,
				(kind) => `${kind}:${nextId()}`,
			)
			commit(duplicated.document)
			setSelectedLayerId(duplicated.layerId)
			setGroupScope([])
			setSelection([])
			setDirectSelection([])
			setSelectedBlendId(null)
			setStatus(`${layer.name} duplicated as the target top layer.`)
		},
		renameLayer: (layerId, name) => {
			const layer = document.layers.find(({ id }) => id === layerId)
			if (layer === undefined || layer.name === name.trim()) return
			try {
				const renamed = renameDesignLayer(document, layerId, name)
				commit(renamed)
				setStatus(`${layer.name} renamed to ${name.trim()}.`)
			} catch (error) {
				setStatus(error instanceof Error ? error.message : String(error))
			}
		},
		reorderLayer: (layerId, direction) => {
			const layer = document.layers.find(({ id }) => id === layerId)
			if (layer === undefined) return
			const reordered = reorderDesignLayer(document, layerId, direction)
			if (reordered === document) {
				setStatus(
					`${layer.name} is already at the ${direction === "up" ? "top" : "bottom"}.`,
				)
				return
			}
			commit(reordered)
			setStatus(`${layer.name} moved ${direction}.`)
		},
		moveHierarchyNode: (node, parent, index) => {
			const name =
				node.kind === "group"
					? document.groups.find(({ id }) => id === node.id)?.name
					: document.objects.find(({ id }) => id === node.id)?.name
			try {
				const moved = moveDesignHierarchyNode(document, node, parent, index)
				if (moved === null) {
					setStatus(`${name ?? node.id} is already in that position.`)
					return
				}
				const parentScope: string[] = []
				if (parent.kind === "group") {
					let groupId: string | null = parent.id
					while (groupId !== null) {
						parentScope.unshift(groupId)
						groupId = designParentGroupId(moved.document, groupId)
					}
				}
				commit(moved.document)
				setSelectedLayerId(moved.layerId)
				setGroupScope(parentScope)
				setSelection(moved.selection)
				setDirectSelection([])
				setSelectedBlendId(null)
				const destinationName =
					parent.kind === "layer"
						? moved.document.layers.find(({ id }) => id === parent.id)?.name
						: moved.document.groups.find(({ id }) => id === parent.id)?.name
				setStatus(
					`${name ?? node.id} moved into ${destinationName ?? parent.id}.`,
				)
			} catch (error) {
				setStatus(error instanceof Error ? error.message : String(error))
			}
		},
		setLayerLocked: (layerId, locked) => {
			const layer = document.layers.find(({ id }) => id === layerId)
			if (layer === undefined || Boolean(layer.locked) === locked) return
			commit(setDesignLayerLocked(document, layerId, locked))
			if (locked) {
				setSelection((current) =>
					current.filter(
						(id) => designLayerIdForObject(document, id) !== layerId,
					),
				)
				setDirectSelection((current) =>
					current.filter(
						(target) =>
							designLayerIdForObject(document, target.objectId) !== layerId,
					),
				)
				if (layerId === activeLayerId) setGroupScope([])
			}
			setStatus(`${layer.name} ${locked ? "locked" : "unlocked"}.`)
		},
		setLayerUiColor: (layerId, uiColor) => {
			const layer = document.layers.find(({ id }) => id === layerId)
			if (layer === undefined || layer.uiColor === uiColor) return
			commit(setDesignLayerUiColor(document, layerId, uiColor))
			setStatus(`${layer.name} UI color changed to ${uiColor}.`)
		},
		setLayerVisibility: (layerId, visible) => {
			const layer = document.layers.find(({ id }) => id === layerId)
			if (layer === undefined || !layer.hidden === visible) return
			commit(setDesignLayerVisibility(document, layerId, visible))
			if (!visible) {
				setSelection((current) =>
					current.filter(
						(id) => designLayerIdForObject(document, id) !== layerId,
					),
				)
				setDirectSelection((current) =>
					current.filter(
						(target) =>
							designLayerIdForObject(document, target.objectId) !== layerId,
					),
				)
				if (layerId === activeLayerId) setGroupScope([])
			}
			setStatus(`${layer.name} ${visible ? "shown" : "hidden"}.`)
		},
		selectLayer: (layerId) => {
			const layer = document.layers.find(({ id }) => id === layerId)
			if (layer === undefined) return
			setSelectedLayerId(layer.id)
			setGroupScope([])
			setSelection([])
			setDirectSelection([])
			setSelectedBlendId(null)
			setStatus(`${layer.name} is now the target layer.`)
		},
		selectHierarchyGroup: (groupId, layerId, parentScope) => {
			const unit = designGroupSelectionUnit(document, groupId)
			if (unit === null) return
			const unavailable = unit.objectIds
				.map((id) => effectiveHierarchy.byObjectId.get(id))
				.find(
					(entry): entry is DesignEffectiveHierarchyEntry =>
						entry?.hiddenBy?.kind === "layer" ||
						entry?.lockedBy?.kind === "layer",
				)
			if (unavailable !== undefined) {
				setStatus(
					effectiveStateReason(unavailable, "selecting the group") ??
						"The group is unavailable.",
				)
				return
			}
			setSelectedLayerId(layerId)
			setGroupScope(parentScope)
			setSelection(unit.objectIds)
			setDirectSelection([])
			setSelectedBlendId(null)
			setStatus(
				`${unit.name} selected as one group with ${unit.objectIds.length} descendant object${unit.objectIds.length === 1 ? "" : "s"}.`,
			)
		},
		selectHierarchyObject: (object, layerId, parentScope, additive = false) => {
			const effective = effectiveHierarchy.byObjectId.get(object.id)
			if (
				effective?.hiddenBy?.kind === "layer" ||
				effective?.lockedBy?.kind === "layer"
			) {
				setStatus(
					effectiveStateReason(effective, "selecting the object") ??
						"The object is unavailable.",
				)
				return
			}
			const sameScope =
				parentScope.length === groupScope.length &&
				parentScope.every((id, index) => groupScope[index] === id)
			setSelectedLayerId(layerId)
			setGroupScope(parentScope)
			setSelectedBlendId(null)
			setSelection((current) =>
				additive && sameScope
					? current.includes(object.id)
						? current.filter((id) => id !== object.id)
						: [...current, object.id]
					: [object.id],
			)
			setDirectSelection([])
		},
		setHierarchyScope: (nextScope) => {
			if (
				nextScope.length === groupScope.length &&
				nextScope.every((id, index) => groupScope[index] === id)
			)
				return
			if (nextScope.length > groupScope.length) {
				const entered = designGroupSelectionUnit(document, nextScope.at(-1)!)
				setGroupScope(nextScope)
				setSelection([])
				setDirectSelection([])
				setSelectedBlendId(null)
				setStatus(
					`Editing inside ${entered?.name ?? "group"}. Use the Layers breadcrumb or Escape to exit.`,
				)
				return
			}
			const exitedGroupId = groupScope[nextScope.length]
			setGroupScope(nextScope)
			setDirectSelection([])
			setSelectedBlendId(null)
			if (exitedGroupId === undefined) {
				setSelection([])
				setStatus("Editing at the document layer level.")
				return
			}
			const unit = designGroupSelectionUnit(document, exitedGroupId)
			setSelection(unit?.objectIds ?? [])
			setStatus(`Exited ${unit?.name ?? "group"}; group selected.`)
		},
		activateArtboard,
		addSwatch,
		appearanceDisabledReason,
		appearanceSummary,
		appearanceTarget,
		applyAppearancePaint,
		applyStrokeProperties,
		alignSelection,
		canReviewSourceChange,
		createArtboard,
		deleteArtboard,
		deleteSelection,
		blendCreationDisabledReason: blendEligibility.eligible
			? null
			: blendEligibility.reason,
		makeBlend,
		selectedBlend,
		selectBlend: (blend) => {
			const unavailable = [blend.startObjectId, blend.endObjectId]
				.map((id) => effectiveHierarchy.byObjectId.get(id))
				.find(
					(entry): entry is DesignEffectiveHierarchyEntry =>
						entry?.hiddenBy?.kind === "layer" ||
						entry?.lockedBy?.kind === "layer",
				)
			if (unavailable !== undefined) {
				setStatus(
					effectiveStateReason(unavailable, "selecting the live blend") ??
						"The live blend is unavailable.",
				)
				return
			}
			setSelection([])
			setDirectSelection([])
			setSelectedBlendId(blend.id)
			setStatus(`${blend.name} selected as one live blend.`)
		},
		setBlendProperty,
		reverseBlendEndpoint,
		setBlendFirstPoint,
		expandBlend,
		blendDiagnosticMessages: blendDiagnostics,
		distributeSelection,
		document,
		expandSelection,
		expansionDisabledReason: expansionEligibility.eligible
			? null
			: expansionEligibility.reason,
		expandStrokeSelection,
		expandTextSelection,
		textExpansionDisabledReason,
		exportDocument,
		exportPngDocument,
		exportSvgDocument,
		importSvgDocument,
		fitAllArtboards,
		focusCanvas: focusActiveArtboard,
		activeArtboard,
		duplicateArtboard,
		moveArtworkWithArtboard,
		reorderArtboard,
		reviewSourceChange,
		selectObject: (object, additive = false) => {
			const effective = effectiveHierarchy.byObjectId.get(object.id)
			if (
				effective?.hiddenBy?.kind === "layer" ||
				effective?.lockedBy?.kind === "layer"
			) {
				setStatus(
					effectiveStateReason(effective, "selecting the object") ??
						"The object is unavailable.",
				)
				return
			}
			setSelectedBlendId(null)
			const unit = designSelectionUnitAtObject(
				document,
				object.id,
				currentGroupScope,
			)
			if (unit === null) return
			setSelection((current) => {
				const unitIds = new Set(unit.objectIds)
				const complete = unit.objectIds.every((id) => current.includes(id))
				if (!additive) return unit.objectIds
				return complete
					? current.filter((id) => !unitIds.has(id))
					: normalizeDesignSelection(
							document,
							[...current, ...unit.objectIds],
							currentGroupScope,
						)
			})
			setDirectSelection([])
		},
		selectSwatch: (swatch) => setSelectedSwatchId(swatch.id),
		selectTool,
		selectedObject,
		selectedObjectCount: selectedObjects.length,
		selectedObjectIds: selection,
		textSelectionRange,
		textOverset,
		availableTextFonts,
		activeTextFontId:
			selectedTextObject === null
				? activeTextFontId
				: selectedTextObject.geometry.typography.font.id,
		textToolsDisabledReason,
		textService,
		textFontRevision,
		beginTextEditing,
		applyTextTypography,
		selectTextFont,
		registerTextFont,
		applyAreaTextFrame,
		convertSelectionToAreaText,
		areaTextConversionDisabledReason,
		selectionBounds:
			selectedBlend === null
				? designHierarchySelectionBounds(
						document,
						selectedObjects,
						interactionBoundsForObject,
					)
				: designBlendBounds(document, selectedBlend),
		selectedObjectBounds:
			selectedObject === null
				? null
				: interactionBoundsForObject(selectedObject),
		selectionArrangementUnitCount,
		selectionTransformDisabledReason:
			selectedBlend === null
				? selectionTransformDisabledReason
				: "Edit a live blend through its endpoints or expand it before transforming.",
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
		setDocumentTitle: (title) => commit({ ...document, title }),
		setMoveArtworkWithArtboard,
		setAppearanceTarget: activateAppearanceTarget,
		swapAppearancePaints: swapAppearance,
		strokePropertiesDisabledReason,
		strokeExpansionDisabledReason: strokeEligibility.eligible
			? null
			: strokeEligibility.reason,
		tool,
		transformSelection,
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
			).map(([id, definition]) => {
				const disabledReason =
					id === "text" || id === "area-text" ? textToolsDisabledReason : null
				return {
					id: `tool-${id}`,
					displayName: definition.label,
					category: "Tools",
					description: `Activate the ${definition.label.toLowerCase()} tool.`,
					icon: definition.paletteIcon,
					shortcut: definition.key,
					checked: tool === id,
					...(disabledReason === null
						? {}
						: { disabled: true, disabledReason }),
					do: () => selectTool(id),
				}
			}),
			...(
				[
					["left", "Align Left"],
					["center", "Align Center"],
					["right", "Align Right"],
					["top", "Align Top"],
					["middle", "Align Middle"],
					["bottom", "Align Bottom"],
				] as const
			).map(([alignment, displayName]) => ({
				id: `align-${alignment}`,
				displayName,
				category: "Object",
				description: "Align selected objects within their combined bounds.",
				icon: "AlignCenterVerticallyIcon" as const,
				disabled: selection.length < 2,
				disabledReason: "Select at least two objects.",
				do: () => alignSelection(alignment, "selection"),
			})),
			...(["x", "y"] as const).map((axis) => ({
				id: `distribute-${axis}`,
				displayName: `Distribute ${axis === "x" ? "Horizontally" : "Vertically"}`,
				category: "Object",
				description: "Distribute selected objects with stable equal gaps.",
				icon: "ShuffleIcon" as const,
				disabled: selection.length < 3,
				disabledReason: "Select at least three objects.",
				do: () => distributeSelection(axis),
			})),
			{
				id: "place-image",
				displayName: "Place Image",
				category: "File",
				description:
					"Install and place an embedded PNG or JPEG in the active layer.",
				icon: "PlusIcon",
				disabled: sourceSession?.installImage === undefined,
				disabledReason: "Connect a source workspace before placing an image.",
				do: chooseImageFile,
			},
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
				id: "export-svg",
				displayName: "Export SVG",
				category: "File",
				description:
					"Export the active artboard as deterministic editable SVG.",
				icon: "DoubleArrowRightIcon",
				do: () => exportSvgDocument({ artboardId: activeArtboard.id }),
			},
			{
				id: "group-selection",
				displayName: "Group",
				category: "Object",
				description:
					"Group selected sibling objects without changing their appearance.",
				icon: "Link1Icon",
				shortcut: "⌘ G",
				disabled: selection.length < 2,
				disabledReason: "Select at least two objects.",
				do: groupSelection,
			},
			{
				id: "ungroup-selection",
				displayName: "Ungroup",
				category: "Object",
				description: "Release the selected group's children in place.",
				icon: "LinkBreak1Icon",
				shortcut: "⇧⌘ G",
				disabled: selection.length === 0,
				disabledReason: "Select a complete group first.",
				do: ungroupSelection,
			},
			{
				id: "make-clipping-mask",
				displayName: "Make Clipping Mask",
				category: "Object",
				description:
					"Use the topmost selected vector object to clip its selected siblings.",
				icon: "Link1Icon",
				disabled: selection.length < 2,
				disabledReason: "Select artwork and a topmost vector clipping path.",
				do: makeClippingMask,
			},
			{
				id: "release-clipping-mask",
				displayName: "Release Clipping Mask",
				category: "Object",
				description: "Restore the clipping path as ordinary grouped artwork.",
				icon: "LinkBreak1Icon",
				disabled:
					selectedGroup === null ||
					document.groups.find(({ id }) => id === selectedGroup.id)
						?.clippingPathId === undefined,
				disabledReason: "Select a clipping-mask group.",
				do: releaseClippingMask,
			},
			...(
				[
					["forward", "Bring Forward"],
					["backward", "Send Backward"],
					["front", "Bring to Front"],
					["back", "Send to Back"],
				] as const
			).map(([command, displayName]) => ({
				id: `stack-${command}`,
				displayName,
				category: "Object",
				description:
					"Change stacking only among siblings in the current group or layer.",
				icon: "ShuffleIcon" as const,
				disabled: selection.length === 0,
				disabledReason: "Select an object first.",
				do: () => stackSelection(command),
			})),
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
			{
				id: "make-blend",
				displayName: "Make Blend",
				category: "Object",
				description:
					"Create a live contour blend from exactly two compatible selected objects.",
				icon: "Link1Icon",
				disabled: !blendEligibility.eligible,
				...(blendEligibility.eligible
					? {}
					: { disabledReason: blendEligibility.reason }),
				do: makeBlend,
			},
			{
				id: "expand-blend",
				displayName: "Expand Blend",
				category: "Object",
				description:
					"Replace the selected live blend with ordinary editable intermediate paths while retaining endpoints.",
				icon: "HobbyKnifeIcon",
				disabled:
					selectedBlend === null ||
					selectedBlend.locked === true ||
					resolveDesignBlend(document, selectedBlend).status !== "ready",
				disabledReason: "Select a ready, unlocked live blend.",
				do: expandBlend,
			},
			{
				id: "expand-text",
				displayName: "Expand Text",
				category: "Object",
				description:
					"Convert the selected live text to grouped editable glyph paths.",
				icon: "HobbyKnifeIcon",
				disabled: textExpansionDisabledReason !== null,
				...(textExpansionDisabledReason === null
					? {}
					: { disabledReason: textExpansionDisabledReason }),
				do: expandTextSelection,
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
					[
						"pathfinder-divide",
						"Pathfinder: Divide",
						"Split selected fills into independently selectable coverage pieces.",
					],
					[
						"pathfinder-trim",
						"Pathfinder: Trim",
						"Keep topmost visible fill pieces and remove their strokes.",
					],
					[
						"pathfinder-merge",
						"Pathfinder: Merge",
						"Trim hidden coverage and unite visible pieces with the same fill.",
					],
					[
						"pathfinder-crop",
						"Pathfinder: Crop",
						"Use the topmost selected fill as a mask for the artwork below it.",
					],
					[
						"pathfinder-outline",
						"Pathfinder: Outline",
						"Convert unique selected-region boundaries into editable open paths.",
					],
				] as const
			).map(([id, displayName, description]) => {
				const eligibility = designPathCommandEligibility(
					id,
					pathCommandPolicyContext,
				)
				const workerBusy =
					activePathfinder !== null && isDesignPartitionPathfinderCommand(id)
				return {
					id,
					displayName,
					category: "Path",
					description,
					icon: "HobbyKnifeIcon" as const,
					disabled: workerBusy || !eligibility.eligible,
					...(workerBusy
						? { disabledReason: "A Pathfinder operation is already running." }
						: eligibility.eligible
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
				const eligibility = designPathCommandEligibility(
					id,
					pathCommandPolicyContext,
				)
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
				disabled:
					selectableObjectIds(effectivePolicyDocument.objects).length === 0,
				do: () => {
					setSelectedBlendId(null)
					const objectIds = normalizeDesignSelection(
						document,
						selectableObjectIds(effectivePolicyDocument.objects),
						currentGroupScope,
						effectiveEditableObjectIds,
					)
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
				disabled: selection.length === 0 && selectedBlend === null,
				disabledReason: "Select an object or live blend first.",
				do: deleteSelection,
			},
			{
				id: "undo",
				displayName: "Undo",
				category: "Edit",
				icon: "DoubleArrowLeftIcon",
				shortcut: "⌘ Z",
				disabled: !history.canUndo,
				do: () => navigateDesignHistory("undo"),
			},
			{
				id: "redo",
				displayName: "Redo",
				category: "Edit",
				icon: "DoubleArrowRightIcon",
				shortcut: "⇧⌘ Z",
				disabled: !history.canRedo,
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
			activePathfinder,
			alignSelection,
			deleteSelection,
			duplicateSelection,
			distributeSelection,
			groupSelection,
			expandSelection,
			expandStrokeSelection,
			expandBlend,
			executePathCommand,
			expansionEligibility,
			blendEligibility,
			chooseImageFile,
			makeBlend,
			makeClippingMask,
			exportDocument,
			exportSvgDocument,
			history.canRedo,
			history.canUndo,
			navigateDesignHistory,
			openTile,
			selectTool,
			selection.length,
			selection,
			directSelection,
			stackSelection,
			strokeEligibility,
			selectedObject?.id,
			selectedBlend,
			selectedSwatchId,
			selectedGroup,
			releaseClippingMask,
			tool,
			ungroupSelection,
			document,
			textToolsDisabledReason,
			sourceSession,
		],
	)

	useEffect(() => {
		const serialized = JSON.stringify(document)
		if (serialized === serializedDocumentRef.current) {
			if (sourceSession === undefined && !preserveInvalidStorageRef.current)
				browserLocalStorage()?.setItem(DESIGN_STORAGE_KEY, serialized)
			window.document.title = `${document.title} — create-design`
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
			updatePersistence({ type: "edit", recoveryDraft })
			const storage = browserLocalStorage()
			if (storage !== null) writeDesignRecoveryDraft(storage, recoveryDraft)
		}
		window.document.title = `${document.title} — create-design`
	}, [document, sourceSession, updatePersistence])

	useEffect(() => {
		if (sourceSession === undefined || persistence.status !== "dirty") return
		updatePersistence({ type: "queue" })
	}, [persistence.status, sourceSession, updatePersistence])

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
		updatePersistence({ type: "save-started", revision })
		void sourceSession.save(pendingDocument).then(
			(result) => {
				updatePersistence({
					type: "save-succeeded",
					revision,
					durableRevision: result.revision,
				})
				saveDocumentsRef.current.delete(revision)
			},
			(error: unknown) => {
				updatePersistence({
					type: "save-failed",
					revision,
					message:
						error instanceof Error ? error.message : "The source write failed.",
				})
			},
		)
	}, [
		persistence.queuedRevision,
		persistence.status,
		sourceSession,
		updatePersistence,
	])

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
				updatePersistence({
					type: "external-invalid",
					diagnostics: update.diagnostics,
				})
				return
			}
			if (!force && persistenceNeedsUnloadWarning(persistenceRef.current)) {
				updatePersistence({
					type: "external-conflict",
					message: "Source changed on disk while local work was pending.",
				})
				return
			}
			registerHeadlessTextFontResources(update.fonts)
			setImageResources(update.images ?? [])
			serializedDocumentRef.current = JSON.stringify(update.document)
			editorState.actions.loadExternalDocument({
				document: update.document,
				durableRevision: update.revision,
			})
			setSelection([])
			const storage = browserLocalStorage()
			if (storage !== null) clearDesignRecoveryDraft(storage)
		}
		return sourceSession.subscribeDocument((update) =>
			applyExternalUpdate(update),
		)
	}, [
		editorState,
		registerHeadlessTextFontResources,
		sourceSession,
		updatePersistence,
	])

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
				const nextGesture = { ...gesture, state: transition.state }
				const resolved = resolveDesignGestureObject(
					effectivePolicyDocument,
					nextGesture,
					transition.preview,
					worldScale,
					snapSettings,
					interactionBoundsForObject,
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
				openCommandPalette()
				return
			}
			if (paletteOpen || editableTarget(event.target)) return
			if (helpOpen && event.key === "Escape") {
				event.preventDefault()
				closeHelp()
				return
			}
			const mod = event.metaKey || event.ctrlKey
			const key = event.key.toLowerCase()
			// Leave Mod-X to the browser so it can dispatch the `cut` event.
			if (mod && key === "x") return
			if (mod && event.key.toLowerCase() === "a") {
				event.preventDefault()
				const objectIds = normalizeDesignSelection(
					document,
					selectableObjectIds(effectivePolicyDocument.objects),
					currentGroupScope,
					effectiveEditableObjectIds,
				)
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
			if (mod && event.key.toLowerCase() === "g") {
				event.preventDefault()
				if (event.shiftKey) ungroupSelection()
				else groupSelection()
				return
			}
			if (mod && event.key.toLowerCase() === "z") {
				event.preventDefault()
				navigateDesignHistory(event.shiftKey ? "redo" : "undo")
				return
			}
			if (key === "x" && !mod && !event.altKey) {
				event.preventDefault()
				if (event.shiftKey) swapSingleObjectAppearance()
				else
					activateAppearanceTarget(
						appearanceTarget === "fill" ? "stroke" : "fill",
					)
				return
			}
			if (event.key === "Enter" && tool === "pen") {
				event.preventDefault()
				finishPen()
				return
			}
			if (event.key === "Escape") {
				const canceledGesture = gestureRef.current !== null
				cancelCanvasGesture()
				if (canceledGesture) {
					event.preventDefault()
					setStatus("Canceled canvas gesture.")
					return
				}
				const exitedGroupId = groupScope.at(-1)
				if (exitedGroupId !== undefined) {
					const parentScope = groupScope.at(-2) ?? null
					const group = designGroupSelectionUnit(document, exitedGroupId)
					const descendantId = group?.objectIds[0]
					const unit =
						descendantId === undefined
							? null
							: designSelectionUnitAtObject(document, descendantId, parentScope)
					setGroupScope((current) => current.slice(0, -1))
					setSelection(unit?.objectIds ?? [])
					setDirectSelection([])
					setStatus(`Exited ${group?.name ?? "group"}; group selected.`)
					return
				}
				setSelection([])
				setSelectedBlendId(null)
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
						: selectedLockedObject !== undefined
							? document
							: {
									...document,
									objects: document.objects.map((object) =>
										selection.includes(object.id) && !object.locked
											? translateObject(object, delta.x, delta.y)
											: object,
									),
								}
				if (selectedLockedObject !== undefined && tool !== "direct") {
					event.preventDefault()
					setStatus(
						`Unlock ${selectedLockedObject.name} before nudging the complete selection.`,
					)
					return
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
		activateAppearanceTarget,
		appearanceTarget,
		deleteSelection,
		duplicateSelection,
		groupSelection,
		commit,
		deleteArtboard,
		cancelCanvasGesture,
		closeHelp,
		directSelection,
		document,
		exportDocument,
		finishPen,
		gesturePolicy,
		helpOpen,
		navigateDesignHistory,
		openCommandPalette,
		paletteOpen,
		penPoints.length,
		selectTool,
		selectedGuideId,
		selection,
		snapSettings,
		swapSingleObjectAppearance,
		tool,
		ungroupSelection,
		worldScale,
	])

	useEffect(() => {
		const writeSelection = (
			clipboard: DataTransfer,
			objectIds: readonly string[],
		): number =>
			writeDesignClipboard(
				clipboard,
				document,
				objectIds,
				createDesignVectorAdapter(activeHierarchyScope).clipboard(
					document,
					objectIds,
				),
			)
		const copy = (event: ClipboardEvent): void => {
			if (
				paletteOpen ||
				editableTarget(event.target) ||
				event.clipboardData === null
			)
				return
			if (selectedBlend !== null) {
				const payload = copyDesignBlendSelection(document, [selectedBlend.id])
				if (payload === null) return
				event.clipboardData.setData(DESIGN_BLEND_MIME, JSON.stringify(payload))
				event.preventDefault()
				setStatus(`Copied ${selectedBlend.name} with both endpoints.`)
				return
			}
			let count: number
			try {
				count = writeSelection(event.clipboardData, selection)
			} catch {
				setStatus("Could not write the selection to the clipboard.")
				return
			}
			if (count === 0) return
			event.preventDefault()
			setStatus(`Copied ${count} vector object${count === 1 ? "" : "s"}.`)
		}
		const cut = (event: ClipboardEvent): void => {
			if (paletteOpen || editableTarget(event.target)) return
			if (gestureRef.current !== null || penPointsRef.current.length > 0) {
				setStatus(
					"Finish the active canvas gesture before cutting the selection.",
				)
				return
			}
			if (event.clipboardData === null) {
				setStatus("Clipboard access is unavailable; the selection was not cut.")
				return
			}
			const capturedSelection = [...selection]
			if (capturedSelection.length === 0) {
				setStatus("Select one or more complete objects to cut.")
				return
			}
			if (selectedUnavailableEntry !== undefined) {
				setStatus(
					effectiveStateReason(
						selectedUnavailableEntry,
						"cutting the selection",
					) ?? "The selection is unavailable.",
				)
				return
			}
			const result = applyDesignVectorIntent(
				document,
				capturedSelection,
				{
					kind: "delete",
					objectIds: capturedSelection,
				},
				activeHierarchyScope,
			)
			if (!result.ok) {
				setStatus(result.error)
				return
			}
			let count: number
			try {
				count = writeSelection(event.clipboardData, capturedSelection)
			} catch {
				setStatus(
					"Could not write the selection to the clipboard; nothing was cut.",
				)
				return
			}
			if (count === 0) {
				setStatus("The selection could not be copied; nothing was cut.")
				return
			}
			event.preventDefault()
			const deletedIds = new Set(capturedSelection)
			pathCommandSelectionsRef.current.set(document, {
				objectSelection: capturedSelection,
				directSelection,
			})
			historySelectionsRef.current.set(historyAt, {
				objectSelection: capturedSelection,
				directSelection,
				layerId: activeLayerId,
				groupScope,
			})
			const nextDirectSelection = directSelection.filter(
				(target) => !deletedIds.has(target.objectId),
			)
			const remainingGroupIds = new Set(
				result.document.groups.map((group) => group.id),
			)
			const nextGroupScope = groupScope.filter((id) =>
				remainingGroupIds.has(id),
			)
			pathCommandSelectionsRef.current.set(result.document, {
				objectSelection: result.selection,
				directSelection: nextDirectSelection,
			})
			historySelectionsRef.current.set(historyAt + 1, {
				objectSelection: result.selection,
				directSelection: nextDirectSelection,
				layerId: activeLayerId,
				groupScope: nextGroupScope,
			})
			commit(result.document)
			setSelection(result.selection)
			setDirectSelection(nextDirectSelection)
			setStatus(`Cut ${count} vector object${count === 1 ? "" : "s"}.`)
		}
		const paste = (event: ClipboardEvent): void => {
			if (
				paletteOpen ||
				editableTarget(event.target) ||
				event.clipboardData === null
			)
				return
			if (activeLayerPasteUnavailableReason !== null) {
				setStatus(activeLayerPasteUnavailableReason)
				return
			}
			const serializedBlend = event.clipboardData.getData(DESIGN_BLEND_MIME)
			if (serializedBlend.length > 0) {
				try {
					const payload = JSON.parse(serializedBlend) as Parameters<
						typeof pasteDesignBlendSelection
					>[1]
					const result = pasteDesignBlendSelection(
						document,
						payload,
						nextId,
						undefined,
						activeHierarchyScope,
					)
					if (result !== null) {
						event.preventDefault()
						commit(result.document)
						setSelection([])
						setDirectSelection([])
						setSelectedBlendId(result.blendIds[0] ?? null)
						setStatus(
							"Pasted live blend with fresh endpoint and blend identities.",
						)
						return
					}
				} catch {
					setStatus("The clipboard live blend payload is invalid.")
					return
				}
			}
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
				const result = importDesignObjects(
					document,
					selection,
					nativeAddition,
					activeHierarchyScope,
				)
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
					activeHierarchyScope,
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
			const result = importDesignObjects(
				document,
				selection,
				fallbackAddition,
				activeHierarchyScope,
			)
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
		window.addEventListener("cut", cut)
		window.addEventListener("paste", paste)
		return () => {
			window.removeEventListener("copy", copy)
			window.removeEventListener("cut", cut)
			window.removeEventListener("paste", paste)
		}
	}, [
		activeArtboard,
		activeHierarchyScope,
		activeLayerPasteUnavailableReason,
		commit,
		directSelection,
		document,
		fallbackSwatchId,
		groupScope,
		historyAt,
		nextId,
		paletteOpen,
		selectedBlend,
		selectedUnavailableEntry,
		selection,
	])

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
		worldOverride?: CanvasPoint,
		rawWorldOverride?: CanvasPoint,
	) => {
		const screen = event.target.getStage()?.getPointerPosition() ?? {
			x: event.evt.offsetX,
			y: event.evt.offsetY,
		}
		const rawWorld = pagePoint(event)
		const world = worldOverride ?? rawWorld
		return {
			world,
			rawWorld: rawWorldOverride ?? rawWorld,
			screen,
			modifiers: gestureModifiers(event.evt),
			snaps,
		}
	}
	const resolveCreationPoint = (point: CanvasPoint): DesignPointSnapResult =>
		snapDesignPoint(point, effectivePolicyDocument, worldScale, snapSettings)
	const clearCreationSnapHint = (restoreToolStatus = true): void => {
		setActiveSnapGuides([])
		if (restoreToolStatus && creationSnapStatusRef.current)
			setStatus(`${DESIGN_TOOLS[tool].label} tool`)
		creationSnapStatusRef.current = false
	}
	const showCreationSnapHint = (
		snap: DesignPointSnapResult,
		preview?: Extract<VectorGesturePreview, { readonly kind: "shape" }>,
	): void => {
		const displayed =
			preview === undefined ? snap : shapeAlignedPointSnap(snap, preview)
		const guides = designSnapGuides(displayed, activeArtboard)
		setActiveSnapGuides(guides)
		if (guides.length === 0) {
			if (creationSnapStatusRef.current)
				setStatus(`${DESIGN_TOOLS[tool].label} tool`)
			creationSnapStatusRef.current = false
			return
		}
		const labels = [
			...new Set(
				displayed.matches
					.filter(({ axis }) => guides.some((guide) => guide.axis === axis))
					.map(({ label }) => label),
			),
		]
		setStatus(`Snap: ${labels.join(" · ")}.`)
		creationSnapStatusRef.current = true
	}
	const beginVectorGesture = (
		event: KonvaEventObject<PointerEvent>,
		down: VectorGestureDownInput,
		originals?: readonly DesignObject[],
		copySelection?: readonly string[],
		creationSnap?: DesignPointSnapResult,
	): void => {
		const creationGuides =
			creationSnap === undefined
				? []
				: designSnapGuides(creationSnap, activeArtboard)
		const transition = reduceVectorGesture(
			null,
			{
				...down,
				type: "pointer-down",
				pointerId: event.evt.pointerId,
				pointer:
					creationSnap === undefined
						? gesturePointer(event)
						: gesturePointer(event, creationGuides, creationSnap.point),
			} as VectorGestureDown,
			gesturePolicy,
		)
		if (transition.state === null) return
		const duplicate =
			originals === undefined || copySelection === undefined
				? null
				: duplicateDesignObjects(document, copySelection, nextId, 0, 0)
		const duplicateSelection = new Set(duplicate?.selection ?? [])
		const copy =
			duplicate === null
				? null
				: {
						document: duplicate.document,
						selection: duplicate.selection,
						originals: duplicate.document.objects.filter((object) =>
							duplicateSelection.has(object.id),
						),
					}
		gestureRef.current =
			originals === undefined
				? { kind: "vector", state: transition.state }
				: down.tool === "transform"
					? { kind: "transform", originals, state: transition.state }
					: { kind: "move", originals, copy, state: transition.state }
		setGesturePreview(transition.preview)
		if (creationSnap !== undefined) showCreationSnapHint(creationSnap)
		captureDesignPointer(event.evt.currentTarget, event.evt.pointerId)
	}

	const startObjectGesture = (
		event: KonvaEventObject<PointerEvent>,
		object: DesignObject,
	): void => {
		if (tool !== "select" && tool !== "transform") return
		const effective = effectiveHierarchy.byObjectId.get(object.id)
		if (effective !== undefined && (!effective.visible || effective.locked)) {
			event.cancelBubble = true
			setStatus(
				effectiveStateReason(effective, "selecting the object") ??
					"The object is unavailable.",
			)
			return
		}
		const interaction = designSelectInteraction(
			document,
			selection,
			object.id,
			currentGroupScope,
			gestureModifiers(event.evt).additive,
			effectiveEditableObjectIds,
		)
		if (interaction === null) return
		const { unit } = interaction
		event.cancelBubble = true
		if (unit.kind === "group") {
			const screen = gesturePointer(event).screen
			const candidate = groupClickCandidateRef.current
			const elapsed =
				candidate === null
					? Number.POSITIVE_INFINITY
					: event.evt.timeStamp - candidate.timeStamp
			const secondClick =
				candidate?.groupId === unit.id &&
				elapsed >= 0 &&
				elapsed <= GROUP_DOUBLE_CLICK_MS &&
				Math.hypot(
					screen.x - candidate.screen.x,
					screen.y - candidate.screen.y,
				) <= GROUP_DOUBLE_CLICK_SLOP_PIXELS
			groupPointerPressRef.current = {
				pointerId: event.evt.pointerId,
				groupId: unit.id,
				startScreen: screen,
				secondClick,
				dragged: false,
			}
			if (secondClick) groupClickCandidateRef.current = null
			else {
				groupClickCandidateRef.current = null
				pendingGroupEntryRef.current = null
			}
		} else {
			groupClickCandidateRef.current = null
			groupPointerPressRef.current = null
			pendingGroupEntryRef.current = null
		}
		const additive = gestureModifiers(event.evt).additive
		setSelection(interaction.selection)
		setDirectSelection([])
		setStatus(
			unit.kind === "group"
				? `${unit.name} selected as one group. Double-click to edit its contents.`
				: `${unit.name} selected.`,
		)
		if (additive) return
		const originals = interaction.objects
		const locked = interaction.lockedObject
		if (locked !== null) {
			setStatus(
				`Selected ${unit.name}, but ${locked.name} is locked; unlock it to move the complete unit.`,
			)
			return
		}
		beginVectorGesture(
			event,
			{ tool: "select", targetId: object.id },
			originals,
			interaction.selection,
		)
	}

	const selectBlendFromCanvas = (
		event: KonvaEventObject<PointerEvent>,
		blendId: string,
	): void => {
		if (tool !== "select" && tool !== "transform") return
		const blend = document.blends?.find(({ id }) => id === blendId)
		if (blend === undefined || blend.hidden || blend.locked) return
		const unavailable = [blend.startObjectId, blend.endObjectId]
			.map((id) => effectiveHierarchy.byObjectId.get(id))
			.find(
				(entry): entry is DesignEffectiveHierarchyEntry =>
					entry !== undefined && (!entry.visible || entry.locked),
			)
		if (unavailable !== undefined) {
			setStatus(
				effectiveStateReason(unavailable, "selecting the live blend") ??
					"The live blend is unavailable.",
			)
			return
		}
		event.cancelBubble = true
		setSelection([])
		setDirectSelection([])
		setSelectedBlendId(blend.id)
		setStatus(`${blend.name} selected as one live blend.`)
	}

	const enterObjectGroup = (
		event: KonvaEventObject<MouseEvent | TouchEvent>,
		object: DesignObject,
	): void => {
		if (tool !== "select" && tool !== "transform") return
		const unit = designSelectionUnitAtObject(
			document,
			object.id,
			currentGroupScope,
		)
		if (object.geometry.kind === "text" && unit?.kind !== "group") {
			event.cancelBubble = true
			cancelCanvasGesture()
			beginTextEditing(object)
			return
		}
		if (unit?.kind !== "group" || pendingGroupEntryRef.current !== unit.id)
			return
		event.cancelBubble = true
		pendingGroupEntryRef.current = null
		groupClickCandidateRef.current = null
		groupPointerPressRef.current = null
		const child = designSelectionUnitAtObject(document, object.id, unit.id)
		setGroupScope((current) => [...current, unit.id])
		setSelection(child?.objectIds ?? unit.objectIds)
		setDirectSelection([])
		setStatus(`Editing inside ${unit.name}. Press Escape to select the group.`)
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
			const snap = resolveCreationPoint(point)
			const start = snap.point
			const id = `artboard:${nextId()}`
			gestureRef.current = {
				kind: "artboard",
				pointerId: event.evt.pointerId,
				mode: "create",
				start,
				original: {
					id,
					name: `Artboard ${document.artboards.length + 1}`,
					x: start.x,
					y: start.y,
					width: 1,
					height: 1,
				},
				resizeX: 1,
				resizeY: 1,
			}
			showCreationSnapHint(snap)
		} else {
			clearCreationSnapHint(false)
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
		if (
			tool === "pen" ||
			tool === "rect" ||
			tool === "ellipse" ||
			tool === "artboard"
		)
			return
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
		if (
			activeLayerUnavailableReason !== null &&
			(tool === "rect" ||
				tool === "ellipse" ||
				tool === "text" ||
				tool === "area-text" ||
				tool === "pen")
		) {
			setStatus(activeLayerUnavailableReason)
			return
		}
		if (tool === "rect" || tool === "ellipse") {
			beginVectorGesture(
				event,
				{ tool },
				undefined,
				undefined,
				resolveCreationPoint(point),
			)
			return
		}
		if (tool === "text") {
			if (activeTextFont === null) {
				setStatus(
					textToolsDisabledReason ??
						"Choose a workspace font before creating text.",
				)
				return
			}
			const object = createDesignTextObject({
				id: `object:${nextId()}`,
				name: `Point text ${document.objects.length + 1}`,
				mode: "point",
				x: point.x,
				y: point.y,
				appearance: authoredAppearance,
				text: DESIGN_TEXT_INITIAL_DRAFT,
				typography: {
					...DEFAULT_DESIGN_TEXT_TYPOGRAPHY,
					font: activeTextFont,
				},
			})
			commit(
				appendDesignHierarchyObjects(
					{ ...document, objects: [...document.objects, object] },
					[object.id],
					activeHierarchyScope,
				),
			)
			beginTextEditing(object, true)
			return
		}
		if (tool === "area-text") {
			if (activeTextFont === null) {
				setStatus(
					textToolsDisabledReason ??
						"Choose a workspace font before creating text.",
				)
				return
			}
			beginVectorGesture(event, { tool: "rect" })
			return
		}
		if (tool === "pen") {
			if (shouldCloseVectorPen(penPointsRef.current, point, worldScale)) {
				finishPen(true)
				return
			}
			beginVectorGesture(
				event,
				{ tool: "pen" },
				undefined,
				undefined,
				resolveCreationPoint(point),
			)
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
			interactionBoundsForObject,
		)
		if (hit === null)
			beginVectorGesture(event, { tool: "select", targetId: null })
		else startObjectGesture(event, hit.object)
	}

	const pointerMove = (event: KonvaEventObject<PointerEvent>): void => {
		const gesture = gestureRef.current
		if (gesture === null) {
			const creationTool =
				tool === "pen" ||
				tool === "rect" ||
				tool === "ellipse" ||
				tool === "artboard"
			if (
				!creationTool ||
				(tool !== "artboard" && activeLayerUnavailableReason)
			) {
				clearCreationSnapHint()
				return
			}
			showCreationSnapHint(resolveCreationPoint(pagePoint(event)))
			return
		}
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
			const point = pagePoint(event)
			if (gesture.mode === "create") {
				const snap = resolveCreationPoint(point)
				previewArtboardGesture(gesture, snap.point)
				showCreationSnapHint(snap)
			} else previewArtboardGesture(gesture, point)
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
		const groupPress = groupPointerPressRef.current
		if (groupPress?.pointerId === event.evt.pointerId) {
			const screen = event.target.getStage()?.getPointerPosition() ?? {
				x: event.evt.offsetX,
				y: event.evt.offsetY,
			}
			const threshold = groupPress.secondClick
				? GROUP_DOUBLE_CLICK_SLOP_PIXELS
				: GROUP_DRAG_THRESHOLD_PIXELS
			if (
				Math.hypot(
					screen.x - groupPress.startScreen.x,
					screen.y - groupPress.startScreen.y,
				) >= threshold
			) {
				groupPress.dragged = true
				groupClickCandidateRef.current = null
				pendingGroupEntryRef.current = null
			}
			if (groupPress.secondClick && !groupPress.dragged) return
		}
		if (gesture.state.pointerId !== event.evt.pointerId) return
		const creationSnap =
			(tool === "rect" || tool === "ellipse") &&
			gesture.kind === "vector" &&
			(gesture.state.tool === "rect" || gesture.state.tool === "ellipse")
				? resolveCreationPoint(pagePoint(event))
				: undefined
		const creationGuides =
			creationSnap === undefined
				? []
				: designSnapGuides(creationSnap, activeArtboard)
		const transition = reduceVectorGesture(
			gesture.state,
			{
				type: "pointer-move",
				pointerId: event.evt.pointerId,
				pointer:
					creationSnap === undefined
						? gesturePointer(event)
						: gesturePointer(event, creationGuides, creationSnap.point),
			},
			gesturePolicy,
		)
		if (transition.state === null) return
		const nextGesture = { ...gesture, state: transition.state }
		gestureRef.current = nextGesture
		setGesturePreview(transition.preview)
		if (creationSnap !== undefined && transition.preview?.kind === "shape")
			showCreationSnapHint(creationSnap, transition.preview)
		if (nextGesture.kind !== "move" && nextGesture.kind !== "transform") return
		const resolved = resolveDesignGestureObject(
			effectivePolicyDocument,
			nextGesture,
			transition.preview,
			worldScale,
			snapSettings,
			interactionBoundsForObject,
		)
		if (resolved === null) return
		previewObjectsRef.current = resolved.objects
		setPreviewObjects(resolved.objects)
		setActiveSnapGuides(designSnapGuides(resolved.snap, activeArtboard))
	}

	const pointerUp = (event: KonvaEventObject<PointerEvent>): void => {
		const gesture = gestureRef.current
		const groupPress = groupPointerPressRef.current
		if (gesture === null) {
			if (groupPress?.pointerId !== event.evt.pointerId) return
			if (groupPress.secondClick)
				pendingGroupEntryRef.current = groupPress.groupId
			else
				groupClickCandidateRef.current = {
					groupId: groupPress.groupId,
					screen: groupPress.startScreen,
					timeStamp: event.evt.timeStamp,
				}
			groupPointerPressRef.current = null
			return
		}
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
			if (
				gesture.mode === "create" &&
				previewArtboardDocumentRef.current !== null
			) {
				const snap = resolveCreationPoint(pagePoint(event))
				previewArtboardGesture(gesture, snap.point)
			}
			releaseDesignPointer(event.evt.currentTarget, event.evt.pointerId)
			gestureRef.current = null
			creationSnapStatusRef.current = false
			setActiveSnapGuides([])
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
		if (
			groupPress?.pointerId === event.evt.pointerId &&
			groupPress.secondClick &&
			!groupPress.dragged
		) {
			releaseDesignPointer(event.evt.currentTarget, event.evt.pointerId)
			gestureRef.current = null
			groupPointerPressRef.current = null
			pendingGroupEntryRef.current = groupPress.groupId
			previewObjectsRef.current = []
			setPreviewObjects([])
			setGesturePreview(null)
			setActiveSnapGuides([])
			creationSnapStatusRef.current = false
			return
		}
		if (gesture.state.pointerId !== event.evt.pointerId) return
		if (gesture.kind === "transform") setTransformCursor(null)
		const creationSnap =
			(tool === "rect" || tool === "ellipse") &&
			gesture.kind === "vector" &&
			(gesture.state.tool === "rect" || gesture.state.tool === "ellipse")
				? resolveCreationPoint(pagePoint(event))
				: undefined
		const creationGuides =
			creationSnap === undefined
				? activeSnapGuides
				: designSnapGuides(creationSnap, activeArtboard)
		const transition = reduceVectorGesture(
			gesture.state,
			{
				type: "pointer-up",
				pointerId: event.evt.pointerId,
				pointer:
					creationSnap === undefined
						? gesturePointer(event, activeSnapGuides)
						: gesturePointer(event, creationGuides, creationSnap.point),
			},
			gesturePolicy,
		)
		releaseDesignPointer(event.evt.currentTarget, event.evt.pointerId)
		gestureRef.current = null
		setGesturePreview(null)
		clearCreationSnapHint()
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
			if (tool === "area-text") {
				if (activeTextFont === null) {
					setStatus(
						textToolsDisabledReason ??
							"Choose a workspace font before creating text.",
					)
					return
				}
				const object = createDesignTextObject({
					id: `object:${nextId()}`,
					name: `Area text ${document.objects.length + 1}`,
					mode: "area",
					x: bounds.minX,
					y: bounds.minY,
					width: bounds.maxX - bounds.minX,
					height: bounds.maxY - bounds.minY,
					appearance: authoredAppearance,
					text: DESIGN_TEXT_INITIAL_DRAFT,
					typography: {
						...DEFAULT_DESIGN_TEXT_TYPOGRAPHY,
						font: activeTextFont,
					},
				})
				commit(
					appendDesignHierarchyObjects(
						{ ...document, objects: [...document.objects, object] },
						[object.id],
						activeHierarchyScope,
					),
				)
				beginTextEditing(object, true)
				return
			}
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
			commit(
				appendDesignHierarchyObjects(
					{ ...document, objects: [...document.objects, object] },
					[object.id],
					activeHierarchyScope,
				),
			)
			setSelection([object.id])
			setStatus(`Created ${object.name}.`)
			return
		}
		if (transition.intent?.kind === "select-marquee") {
			const intent = transition.intent
			if (tool === "direct") {
				const targets = marqueeDirectSelection(
					effectivePolicyDocument,
					intent.bounds,
				)
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
			const ids = normalizeDesignSelection(
				document,
				marqueeObjectIds(
					effectivePolicyDocument.objects,
					intent.bounds,
					interactionBoundsForObject,
				),
				currentGroupScope,
				effectiveEditableObjectIds,
			)
			setSelection((current) =>
				intent.additive
					? normalizeDesignSelection(
							document,
							[...current, ...ids],
							currentGroupScope,
							effectiveEditableObjectIds,
						)
					: ids,
			)
			setDirectSelection([])
			return
		}
		const finalGesture =
			gesture.kind === "move" || gesture.kind === "transform"
				? {
						...gesture,
						state: {
							...gesture.state,
							modifiers: gestureModifiers(event.evt),
						},
					}
				: null
		const finalResolved =
			finalGesture === null || transition.intent === null
				? null
				: resolveDesignGestureObject(
						effectivePolicyDocument,
						finalGesture,
						transition.intent,
						worldScale,
						snapSettings,
						interactionBoundsForObject,
					)
		const committedPreviews = finalResolved?.objects ?? []
		previewObjectsRef.current = []
		setPreviewObjects([])
		if (committedPreviews.length > 0) {
			const byId = new Map(
				committedPreviews.map((object) => [object.id, object]),
			)
			const copyPlan =
				finalGesture?.kind === "move" && finalGesture.state.modifiers.altKey
					? finalGesture.copy
					: null
			const commitDocument = copyPlan?.document ?? document
			commit({
				...commitDocument,
				objects: commitDocument.objects.map(
					(object) => byId.get(object.id) ?? object,
				),
			})
			if (copyPlan !== null) {
				setSelection(copyPlan.selection)
				setDirectSelection([])
				setStatus(
					`Copied ${copyPlan.selection.length} object${copyPlan.selection.length === 1 ? "" : "s"} with Alt/Option-drag.`,
				)
			} else
				setStatus(
					selectedGroup === null
						? "Moved selection."
						: `Moved ${selectedGroup.name} as one group.`,
				)
		}
		if (groupPress?.pointerId === event.evt.pointerId) {
			if (!groupPress.dragged && !groupPress.secondClick)
				groupClickCandidateRef.current = {
					groupId: groupPress.groupId,
					screen: groupPress.startScreen,
					timeStamp: event.evt.timeStamp,
				}
			groupPointerPressRef.current = null
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
			groupPointerPressRef.current = null
			pendingGroupEntryRef.current = null
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
			creationSnapStatusRef.current = false
			setPreviewArtboardDocument(null)
			previewArtboardDocumentRef.current = null
			setGuidePreview(null)
			setTransformCursor(null)
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
	const pointerLeave = (): void => {
		clearCreationSnapHint(gestureRef.current === null)
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
		if (selectedObjects.length === 0) return
		if (selectionTransformDisabledReason !== null) {
			setStatus(selectionTransformDisabledReason)
			return
		}
		const bounds = designHierarchySelectionBounds(
			document,
			selectedObjects,
			interactionBoundsForObject,
		)
		if (bounds === null) return
		event.cancelBubble = true
		setTransformCursor(
			handle === "rotation" ? "grabbing" : designTransformHandleCursor(handle),
		)
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

	const copyingGesture =
		gestureRef.current?.kind === "move" &&
		gestureRef.current.state.modifiers.altKey &&
		previewObjects.length > 0
			? gestureRef.current
			: null
	const canvasDocument =
		previewArtboardDocument ?? copyingGesture?.copy?.document ?? document
	const layerUiColorForObject = (objectId: string): string => {
		const layerId = designLayerIdForObject(canvasDocument, objectId)
		const layerIndex = canvasDocument.layers.findIndex(
			({ id }) => id === layerId,
		)
		return designLayerUiColorCss(
			canvasDocument.layers[layerIndex]?.uiColor,
			layerIndex,
		)
	}
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
	const canvasAuthoredObjects = canvasDocument.objects.map(
		(object) => previewById.get(object.id) ?? object,
	)
	const canvasOutputProjection = projectDesignOutput({
		...canvasDocument,
		objects: canvasAuthoredObjects,
	})
	const displayedObjects = canvasOutputProjection.objects
	const derivedBlendByObjectId = new Map(
		canvasOutputProjection.entries.flatMap((entry) =>
			entry.source.kind === "blend"
				? [[entry.object.id, entry.source.blendId] as const]
				: [],
		),
	)
	const authoredCanvasObjectIds = new Set(
		canvasAuthoredObjects.map(({ id }) => id),
	)
	const previewSwatch = document.swatches.find(
		(swatch) =>
			swatch.id ===
			(authoredAppearance.fill?.swatchId ??
				authoredAppearance.stroke?.swatchId),
	)
	const selectionBounds =
		tool !== "select" && tool !== "transform"
			? null
			: selectedBlend !== null
				? designBlendBounds(canvasDocument, selectedBlend)
				: selectedObjects.length > 0
					? designHierarchySelectionBounds(
							canvasDocument,
							copyingGesture?.copy === null || copyingGesture === null
								? selectedObjects.map(
										(object) => previewById.get(object.id) ?? object,
									)
								: copyingGesture.copy.selection.flatMap((id) => {
										const object = previewById.get(id)
										return object === undefined ? [] : [object]
									}),
							interactionBoundsForObject,
						)
					: null
	const selectionVisualObjects =
		selectionBounds === null || selectedBlend !== null
			? []
			: copyingGesture?.copy === null || copyingGesture === null
				? selectedObjects.map((object) => previewById.get(object.id) ?? object)
				: copyingGesture.copy.selection.flatMap((id) => {
						const object = previewById.get(id)
						return object === undefined ? [] : [object]
					})
	const selectionLayerColors = selectionVisualObjects.map(({ id }) =>
		layerUiColorForObject(id),
	)
	const uniqueSelectionLayerColors = new Set(selectionLayerColors)
	const aggregateSelectionColor =
		uniqueSelectionLayerColors.size === 1
			? selectionLayerColors[0]!
			: canvasTheme.marquee

	const recoverDraft = (): void => {
		const draft = persistence.recoveryDraft
		if (draft === null) return
		const revision = persistence.localRevision + 1
		serializedDocumentRef.current = JSON.stringify(draft.document)
		saveDocumentsRef.current.set(revision, draft.document)
		editorState.actions.recoverDocument(draft.document)
		setSelection([])
	}
	const discardDraft = (): void => {
		const storage = browserLocalStorage()
		if (storage !== null) clearDesignRecoveryDraft(storage)
		if (sourceSession === undefined)
			updatePersistence({ type: "discard-draft" })
		else void reloadExternal()
	}
	const reloadExternal = async (): Promise<void> => {
		if (sourceSession === undefined) return
		try {
			const update = await sourceSession.reload()
			if (!update.ok) {
				updatePersistence({
					type: "external-invalid",
					diagnostics: update.diagnostics,
				})
				return
			}
			registerHeadlessTextFontResources(update.fonts)
			setImageResources(update.images ?? [])
			serializedDocumentRef.current = JSON.stringify(update.document)
			editorState.actions.loadExternalDocument({
				document: update.document,
				durableRevision: update.revision,
			})
			setSelection([])
			const storage = browserLocalStorage()
			if (storage !== null) clearDesignRecoveryDraft(storage)
		} catch (error) {
			updatePersistence({
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
		// This internal provider child intentionally renders the public component root.
		// eslint-disable-next-line lasertag/render-tag-with-own-name
		<design-application className={css.class}>
			<header>
				<brand-lockup>
					<svg viewBox="0 0 28 28" aria-hidden="true">
						<path d="M4 4h20v20H4z" />
						<circle cx="18" cy="10" r="5" />
					</svg>
					<project-identity>
						<strong title={sourceSession?.displayName ?? "Untitled design"}>
							{sourceSession?.displayName ?? "Untitled design"}
						</strong>
						<span>create-design</span>
					</project-identity>
				</brand-lockup>
				<command-center>
					<button
						ref={commandCenterRef}
						type="button"
						aria-label="Open Command Palette"
						aria-keyshortcuts="Meta+Shift+P Control+Shift+P"
						onClick={openCommandPalette}
					>
						<svg.MagnifyingGlassIcon aria-hidden="true" />
						<strong>Commands</strong>
						<kbd>{MOD_KEY_LABEL}+Shift+P</kbd>
					</button>
				</command-center>
				<header-actions>
					<button
						type="button"
						data-export
						aria-label="Open Export options"
						onClick={() => {
							openTile("export")
							setStatus("Opened Export options.")
						}}
					>
						Export…
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
									onClick={() => updatePersistence({ type: "retry" })}
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
					<artboard-wrap
						ref={artboardWrapRef}
						role="application"
						aria-label="Design artboard"
						aria-describedby="design-selection-status"
						aria-keyshortcuts="X Shift+X Meta+X Control+X"
						tabIndex={-1}
					>
						<span id="design-selection-status" data-screen-reader>
							{tool === "direct"
								? directSelectionDescription(directSelection)
								: selectionDescription}
						</span>
						<div.Stage
							width={canvasViewport.width}
							height={canvasViewport.height}
							style={{
								cursor:
									transformCursor ??
									canvasToolCursor(
										tool === "direct"
											? "select"
											: tool === "artboard"
												? "rect"
												: tool === "text"
													? "select"
													: tool === "area-text"
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
							onPointerLeave={pointerLeave}
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
									{canvasDocument.artboards.map((artboard) => {
										const chrome = designArtboardCanvasChrome(
											artboard,
											worldScale,
											artboard.id === canvasActiveArtboardId,
										)
										return (
											<Group key={artboard.id}>
												<Rect
													name={`design-paper ${artboard.id}`}
													x={artboard.x}
													y={artboard.y}
													width={artboard.width}
													height={artboard.height}
													{...(chrome.background === undefined
														? {}
														: { fill: chrome.background })}
												/>
												<Rect {...chrome.border} listening={false} />
												{chrome.selection === undefined ? null : (
													<Rect
														{...chrome.selection}
														stroke={canvasTheme.selection}
														listening={false}
													/>
												)}
												<Text
													{...chrome.label}
													fill={
														artboard.id === canvasActiveArtboardId
															? canvasTheme.selection
															: canvasTheme.artboardLabel
													}
													fontStyle={
														artboard.id === canvasActiveArtboardId
															? "bold"
															: "normal"
													}
													ellipsis
													wrap="none"
													listening={false}
												/>
											</Group>
										)
									})}
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
													fill={canvasTheme.handleFill}
													stroke={canvasTheme.selection}
													strokeWidth={1 / worldScale}
													listening={false}
												/>
											))}
									{displayedObjects.map((object) => {
										const derived = !authoredCanvasObjectIds.has(object.id)
										const objectLayerUiColor = layerUiColorForObject(object.id)
										const outputEntry = canvasOutputProjection.byObjectId.get(
											object.id,
										)
										const masks = (outputEntry?.maskGroupIds ?? []).flatMap(
											(groupId) => {
												const clippingPathId = canvasDocument.groups.find(
													(group) => group.id === groupId,
												)?.clippingPathId
												const mask = canvasAuthoredObjects.find(
													(candidate) => candidate.id === clippingPathId,
												)
												return mask === undefined ? [] : [mask]
											},
										)
										const masked = (content: ReactNode) => (
											<DesignCanvasMasks key={object.id} masks={masks}>
												{content}
											</DesignCanvasMasks>
										)
										const derivedBlendId = derivedBlendByObjectId.get(object.id)
										const fill = canvasOutputProjection.swatches.find(
											(candidate) =>
												candidate.id === object.appearance.fill?.swatchId,
										)
										const stroke = canvasOutputProjection.swatches.find(
											(candidate) =>
												candidate.id === object.appearance.stroke?.swatchId,
										)
										const strokeStyle = object.appearance.stroke
										if (object.geometry.kind === "image") {
											if (object.hidden) return null
											const image = canvasImages.get(object.geometry.source.id)
											const transform = imageTransform(object)
											return masked(
												<Group {...transform} listening={!object.locked}>
													{image === undefined ? (
														<Rect
															name={`design-missing-image ${object.id}`}
															width={object.geometry.intrinsicWidth}
															height={object.geometry.intrinsicHeight}
															fill="#f5f5f5"
															stroke="#c62828"
															dash={[8 / worldScale, 6 / worldScale]}
															onPointerDown={(event) =>
																startObjectGesture(event, object)
															}
														/>
													) : (
														<CanvasImage
															name={`design-image ${object.id}`}
															image={image}
															width={object.geometry.intrinsicWidth}
															height={object.geometry.intrinsicHeight}
															onPointerDown={(event) =>
																startObjectGesture(event, object)
															}
														/>
													)}
												</Group>,
											)
										}
										if (object.geometry.kind === "text") {
											if (object.hidden) return null
											const geometry = object.geometry
											const canonicalLayout = textService.layout(object)
											const canonicalObject =
												canonicalLayout !== null &&
												!canonicalLayout.diagnostics.some(
													(diagnostic) => diagnostic.severity === "error",
												)
													? {
															...object,
															transform: IDENTITY_DESIGN_TRANSFORM,
															geometry: {
																kind: "path" as const,
																fillRule: "nonzero" as const,
																contours: canonicalLayout.glyphs.flatMap(
																	({ contours }) => contours,
																),
															},
														}
													: null
											const estimate = estimateDesignTextLayout(geometry)
											const inset = geometry.frame?.inset ?? {
												top: 0,
												right: 0,
												bottom: 0,
												left: 0,
											}
											const transform = designTextKonvaTransform(
												object.transform,
											)
											const textY =
												geometry.mode === "point"
													? geometry.y - geometry.typography.size
													: geometry.y
											const textColor =
												fill === undefined ? "#111" : swatchCss(fill)
											return (
												<Group
													key={object.id}
													{...transform}
													listening={!object.locked}
												>
													{canonicalLayout === null ||
													canonicalLayout.diagnostics.some(
														(diagnostic) => diagnostic.severity === "error",
													) ? null : (
														<Rect
															name={`design-text-hit ${object.id}`}
															x={canonicalLayout.bounds.x}
															y={canonicalLayout.bounds.y}
															width={canonicalLayout.bounds.width}
															height={canonicalLayout.bounds.height}
															fill="rgba(0, 0, 0, 0)"
															onPointerDown={(event) =>
																startObjectGesture(event, object)
															}
															onDblClick={(
																event: KonvaEventObject<
																	MouseEvent | TouchEvent
																>,
															) => enterObjectGroup(event, object)}
															onDblTap={(event) =>
																enterObjectGroup(event, object)
															}
														/>
													)}
													{geometry.frame === undefined ? null : (
														<Rect
															x={geometry.x}
															y={textY}
															width={geometry.frame.width}
															height={geometry.frame.height}
															stroke={
																selection.includes(object.id)
																	? objectLayerUiColor
																	: "#999"
															}
															strokeWidth={1 / worldScale}
															dash={[4 / worldScale, 3 / worldScale]}
															listening={false}
														/>
													)}
													{canonicalObject === null ? (
														<Text
															name={`design-object ${object.id}`}
															x={geometry.x + inset.left}
															y={textY + inset.top}
															text={estimate.visibleText}
															fontFamily={geometry.typography.font.family}
															fontSize={geometry.typography.size}
															lineHeight={
																geometry.typography.leading /
																geometry.typography.size
															}
															letterSpacing={
																geometry.typography.tracking / 1000
															}
															fill={textColor}
															align={
																geometry.typography.alignment === "start"
																	? "left"
																	: geometry.typography.alignment === "end"
																		? "right"
																		: geometry.typography.alignment
															}
															{...(geometry.frame === undefined
																? {}
																: {
																		width:
																			geometry.frame.width -
																			inset.left -
																			inset.right,
																		height:
																			geometry.frame.height -
																			inset.top -
																			inset.bottom,
																		wrap: "word" as const,
																		verticalAlign:
																			geometry.frame.verticalAlignment,
																	})}
															onPointerDown={(event) =>
																startObjectGesture(event, object)
															}
															onDblClick={(
																event: KonvaEventObject<
																	MouseEvent | TouchEvent
																>,
															) => enterObjectGroup(event, object)}
															onDblTap={(event) =>
																enterObjectGroup(event, object)
															}
														/>
													) : (
														<VectorContourPath
															name={`design-object ${object.id}`}
															object={projectDesignVectorObject(
																canvasDocument,
																canonicalObject,
															)}
															{...(fill === undefined
																? {}
																: { fill: textColor })}
															fillEnabled={fill !== undefined}
															selected={selection.includes(object.id)}
															selectionStroke={objectLayerUiColor}
															onPointerDown={(event) =>
																startObjectGesture(event, object)
															}
															onDoubleClick={(
																event: KonvaEventObject<
																	MouseEvent | TouchEvent
																>,
															) => enterObjectGroup(event, object)}
														/>
													)}
													{!estimate.overset ||
													geometry.frame === undefined ? null : (
														<Text
															name={`design-text-overset ${object.id}`}
															x={
																geometry.x +
																geometry.frame.width -
																12 / worldScale
															}
															y={
																textY + geometry.frame.height - 12 / worldScale
															}
															text="+"
															fontSize={12 / worldScale}
															fill="#c62828"
															listening={false}
														/>
													)}
												</Group>
											)
										}
										return object.hidden ||
											((fill === undefined ||
												object.appearance.fill === undefined) &&
												(stroke === undefined ||
													strokeStyle === undefined ||
													strokeStyle.width === 0))
											? null
											: masked(
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
														fillRule={designObjectFillRule(object)}
														selected={
															derived
																? selectedBlendId === derivedBlendId
																: selectedGroup === null &&
																	selection.includes(object.id)
														}
														selectionStroke={objectLayerUiColor}
														listening={
															!object.locked &&
															(!derived || derivedBlendId !== undefined)
														}
														onPointerDown={(event) =>
															derivedBlendId === undefined
																? startObjectGesture(event, object)
																: selectBlendFromCanvas(event, derivedBlendId)
														}
														onDoubleClick={(
															event: KonvaEventObject<MouseEvent | TouchEvent>,
														) => enterObjectGroup(event, object)}
														onPointerEnter={(event) => {
															if (
																object.locked ||
																(tool !== "select" &&
																	tool !== "direct" &&
																	tool !== "transform")
															)
																return
															const container = event.target
																.getStage()
																?.container()
															if (container !== undefined)
																container.style.cursor = canvasToolCursor(
																	tool === "direct" ? "select" : tool,
																	{
																		overObject: true,
																	},
																)
														}}
														onPointerLeave={(event) => {
															const container = event.target
																.getStage()
																?.container()
															if (container !== undefined)
																container.style.cursor = canvasToolCursor(
																	tool === "direct"
																		? "select"
																		: tool === "artboard"
																			? "rect"
																			: tool === "text"
																				? "select"
																				: tool === "area-text"
																					? "rect"
																					: tool,
																)
														}}
													/>,
												)
									})}
									{canvasAuthoredObjects.flatMap((object) => {
										const entry = effectiveHierarchy.byObjectId.get(object.id)
										const selected = selection.includes(object.id)
										const editingClippingGroup =
											entry?.clippingForGroupId === currentGroupScope
										if (
											entry?.clippingForGroupId === null ||
											entry?.clippingForGroupId === undefined ||
											!entry.visible ||
											(!selected && !editingClippingGroup) ||
											object.geometry.kind === "image" ||
											object.geometry.kind === "text"
										)
											return []
										return [
											<VectorContourPath
												key={`clipping-selection:${object.id}`}
												name={`${selected ? "design-clipping-selection" : "design-clipping-hit"} ${object.id}`}
												object={projectDesignVectorObject(
													canvasDocument,
													object,
												)}
												fillEnabled={false}
												fillRule={designObjectFillRule(object)}
												{...(selected ? {} : { stroke: "rgb(0 0 0 / 0.001)" })}
												strokeWidth={1 / worldScale}
												hitStrokeWidth={12 / worldScale}
												selected={selected}
												selectionStroke={layerUiColorForObject(object.id)}
												listening={!entry.locked}
												onPointerDown={(event) =>
													startObjectGesture(event, object)
												}
												onDoubleClick={(event) =>
													enterObjectGroup(event, object)
												}
											/>,
										]
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
													selectedGuideId === guide.id
														? canvasTheme.selection
														: canvasTheme.guide
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
																color={layerUiColorForObject(object.id)}
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
											color={canvasTheme.selection}
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
											color={canvasTheme.selection}
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
											color={canvasTheme.selection}
										/>
									)}
									<VectorSnapGuides
										guides={activeSnapGuides}
										inverseScale={1 / worldScale}
										color={canvasTheme.guide}
									/>
									{gesturePreview?.kind === "select-marquee" ? (
										<VectorSelectionBounds
											bounds={gesturePreview.bounds}
											inverseScale={1 / worldScale}
											color={canvasTheme.marquee}
											handles={[]}
										/>
									) : null}
									{selectionVisualObjects.length <= 1
										? null
										: selectionVisualObjects.map((object, index) => {
												const bounds = interactionBoundsForObject(object)
												return bounds === null ? null : (
													<VectorSelectionBounds
														key={`layer-selection:${object.id}`}
														bounds={bounds}
														inverseScale={1 / worldScale}
														color={selectionLayerColors[index]!}
														handles={[]}
														listening={false}
													/>
												)
											})}
									{selectionBounds === null ? null : (
										<>
											<VectorSelectionBounds
												bounds={selectionBounds}
												inverseScale={1 / worldScale}
												color={aggregateSelectionColor}
												fillOpacity={
													selectionVisualObjects.length > 1 ? 0 : 0.06
												}
												rotation={tool === "transform"}
												{...(tool === "transform"
													? {
															handles: DESIGN_TRANSFORM_HANDLES,
															onHandlePointerDown: startScale,
															onHandlePointerEnter: (
																handle: VectorTransformHandle,
															) =>
																setTransformCursor(
																	designTransformHandleCursor(handle),
																),
															onHandlePointerLeave: () => {
																if (gestureRef.current?.kind !== "transform")
																	setTransformCursor(null)
															},
														}
													: { handles: [], listening: false })}
											/>
											{selectedGroup === null ? null : (
												<Text
													name="design-group-selection-label"
													x={selectionBounds.minX}
													y={selectionBounds.minY - 20 / worldScale}
													text={`${selectedGroup.name} · ${selectedGroup.objectIds.length} objects`}
													fontSize={12 / worldScale}
													fill={aggregateSelectionColor}
													listening={false}
												/>
											)}
										</>
									)}
								</Group>
							</Layer>
						</div.Stage>
						{editingTextObject === null ||
						editingTextLayout === null ||
						editingTextRegisteredFamily === null ? null : (
							<TextEditingSurface
								key={`${editingTextObject.id}:${editingTextObject.geometry.typography.font.id}:${String(editingTextObject.geometry.typography.font.revision ?? "unversioned")}:${editingTextRegisteredFamily}`}
								object={editingTextObject}
								layout={editingTextLayout}
								registeredFamily={editingTextRegisteredFamily}
								view={canvasView}
								worldScale={worldScale}
								onChange={setEditingText}
								onExit={finishTextEditing}
								onSelectionChange={setTextSelectionRange}
								{...(textSelectionRange === null
									? {}
									: { initialSelection: textSelectionRange })}
							/>
						)}
					</artboard-wrap>
					<canvas-help-controls>
						<button
							ref={helpButtonRef}
							type="button"
							aria-controls="design-contextual-help"
							aria-expanded={helpOpen}
							aria-label={`Help for the ${DESIGN_TOOLS[tool].label} tool`}
							onClick={() => setHelpOpen((open) => !open)}
						>
							<svg.QuestionMarkCircledIcon aria-hidden="true" />
							<span>{DESIGN_TOOLS[tool].label} help</span>
						</button>
						{helpOpen ? (
							<canvas-help
								id="design-contextual-help"
								role="dialog"
								aria-label="Canvas help"
							>
								<canvas-help-heading>
									<strong>{DESIGN_TOOLS[tool].label} tool</strong>
									<button
										type="button"
										aria-label="Close Help"
										onClick={closeHelp}
									>
										<svg.Cross2Icon aria-hidden="true" />
									</button>
								</canvas-help-heading>
								<p>{contextualHelp(tool, currentGroupScope !== null)}</p>
							</canvas-help>
						) : null}
					</canvas-help-controls>
				</design-canvas>
				<canvas-rulers>
					<ruler-corner aria-hidden="true" />
					<ruler-horizontal
						role="button"
						tabIndex={0}
						aria-label="Horizontal ruler; click to create a vertical guide"
						onPointerDown={(event) => createGuideFromRuler("x", event)}
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
						onPointerDown={(event) => createGuideFromRuler("y", event)}
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
				</canvas-rulers>
				<TilingWorkspace
					context={designTileContext}
					registry={DESIGN_TILE_REGISTRY}
					defaultLayout={DEFAULT_DESIGN_TILING_LAYOUT}
					storageKey={DESIGN_TILING_STORAGE_KEY}
					commandRequest={tileCommandRequest}
					enabled={!paletteOpen}
				/>
			</main>

			<footer
				data-pathfinder-active={activePathfinder === null ? undefined : true}
			>
				<span
					data-screen-reader
					role="status"
					aria-live="polite"
					aria-atomic="true"
				>
					{announcement}
				</span>
				<span data-footer-status title={status}>
					{status}
				</span>
				{activePathfinder === null ? null : (
					<span
						data-pathfinder-progress
						data-phase={activePathfinder.progress?.phase ?? "preparing"}
					>
						<span>
							{activePathfinder.label}:{" "}
							{activePathfinder.cancellationRequested
								? "cancelling"
								: (activePathfinder.progress?.phase ?? "preparing")}
						</span>
						{activePathfinder.progress === null ? null : (
							<progress
								aria-label={`${activePathfinder.label} Pathfinder progress`}
								value={activePathfinder.progress.completedRegions}
								max={Math.max(1, activePathfinder.progress.totalRegions)}
							/>
						)}
						<button
							type="button"
							aria-label={`Cancel ${activePathfinder.label}`}
							disabled={activePathfinder.cancellationRequested}
							onClick={cancelPartitionPathfinder}
						>
							Cancel
						</button>
					</span>
				)}
				<span data-footer-persistence title={persistenceLabel(persistence)}>
					{persistenceLabel(persistence)}
				</span>
				<span data-footer-canvas>
					{activeArtboard.width} × {activeArtboard.height} pt ·{" "}
					{Math.round(canvasView.zoom * 100)}%
				</span>
				<span data-footer-counts>
					{document.objects.length} objects · {document.swatches.length}{" "}
					swatches
				</span>
			</footer>

			{paletteOpen ? (
				<CommandPalette
					commands={commands}
					onCancel={closeCommandPalette}
					onExecute={(command) => {
						command.do()
						closeCommandPalette()
					}}
					onAssign={() => {
						setStatus("Hotbar assignment is reserved for the full workspace.")
					}}
				/>
			) : null}
		</design-application>
	)
}
