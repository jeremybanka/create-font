import {
	canvasScale,
	canvasToolCursor,
	CommandPalette,
	columnSlotAllocation,
	isCommandPaletteKeyboardEvent,
	reduceCanvasWheel,
	screenToDocument,
	type PaletteCommand,
} from "@create-font/editor/shared"
import {
	Circle,
	Group,
	type KonvaEventObject,
	Layer,
	Line,
	Path,
	Rect,
	Stage,
} from "@create-font/preact-konva"
import {
	CircleIcon,
	CursorArrowIcon,
	DownloadIcon,
	EyeClosedIcon,
	EyeOpenIcon,
	LockClosedIcon,
	LockOpen1Icon,
	Pencil1Icon,
	RulerSquareIcon,
	SquareIcon,
	TransformIcon,
	TrashIcon,
} from "@radix-ui/react-icons"
import type { ComponentChildren } from "preact"
import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useReducer,
	useRef,
	useState,
} from "preact/hooks"

import { readDesignClipboard, writeDesignClipboard } from "./clipboard.ts"
import {
	cmykToRgb,
	oppositeColorSpace,
	resolvedCmyk,
	resolvedRgb,
	rgbToCmyk,
	swatchCss,
} from "./color.ts"
import {
	createInitialDocument,
	DESIGN_STORAGE_KEY,
	parseDesignDocument,
} from "./document.ts"
import {
	clampToPage,
	DESIGN_MAX_ZOOM,
	DESIGN_MIN_ZOOM,
	designBaseScale,
	initialDesignCanvasView,
	nearestDesignObject,
	snapDesignObject,
} from "./design-canvas.ts"
import {
	ellipseContour,
	normalizedBounds,
	objectBounds,
	objectSvgPath,
	rectangleContour,
	scaleObject,
	translateObject,
	type Bounds,
} from "./geometry.ts"
import { downloadPdf } from "./pdf.ts"
import type {
	ColorDefinition,
	DesignDocument,
	DesignObject,
	DesignPoint,
	DesignSwatch,
	DesignTool,
} from "./types.ts"

const tools = {
	select: {
		label: "Select",
		key: "V",
		icon: CursorArrowIcon,
		paletteIcon: "CursorArrowIcon",
	},
	transform: {
		label: "Transform",
		key: "F",
		icon: TransformIcon,
		paletteIcon: "TransformIcon",
	},
	pen: {
		label: "Pen",
		key: "Q",
		icon: Pencil1Icon,
		paletteIcon: "Pencil1Icon",
	},
	rect: {
		label: "Rectangle",
		key: "R",
		icon: SquareIcon,
		paletteIcon: "SquareIcon",
	},
	ellipse: {
		label: "Ellipse",
		key: "O",
		icon: CircleIcon,
		paletteIcon: "CircleIcon",
	},
	rule: {
		label: "Rule",
		key: "L",
		icon: RulerSquareIcon,
		paletteIcon: "AlignCenterVerticallyIcon",
	},
} as const satisfies Record<
	DesignTool,
	{
		readonly label: string
		readonly key: string
		readonly icon: typeof CursorArrowIcon
		readonly paletteIcon: PaletteCommand["icon"]
	}
>

interface History {
	readonly past: readonly DesignDocument[]
	readonly present: DesignDocument
	readonly future: readonly DesignDocument[]
}

type HistoryAction =
	| { readonly type: "commit"; readonly document: DesignDocument }
	| { readonly type: "undo" }
	| { readonly type: "redo" }

type CanvasGesture =
	| {
			readonly kind: "move"
			readonly pointerId: number
			readonly start: DesignPoint
			readonly original: DesignObject
	  }
	| {
			readonly kind: "pan"
			readonly pointerId: number
			readonly start: DesignPoint
			readonly original: Readonly<{ x: number; y: number; zoom: number }>
	  }
	| {
			readonly kind: "draw"
			readonly pointerId: number
			readonly start: DesignPoint
			readonly tool: "rect" | "ellipse"
			shift: boolean
			alt: boolean
	  }
	| {
			readonly kind: "scale"
			readonly pointerId: number
			readonly original: DesignObject
			readonly bounds: Bounds
			readonly anchor: DesignPoint
			readonly handle: "nw" | "ne" | "se" | "sw"
	  }

const historyReducer = (history: History, action: HistoryAction): History => {
	if (action.type === "undo") {
		const previous = history.past.at(-1)
		return previous === undefined
			? history
			: {
					past: history.past.slice(0, -1),
					present: previous,
					future: [history.present, ...history.future],
				}
	}
	if (action.type === "redo") {
		const next = history.future[0]
		return next === undefined
			? history
			: {
					past: [...history.past, history.present],
					present: next,
					future: history.future.slice(1),
				}
	}
	if (action.document === history.present) return history
	return {
		past: [...history.past.slice(-99), history.present],
		present: action.document,
		future: [],
	}
}

function initialHistory(): History {
	let document = createInitialDocument()
	if (typeof localStorage !== "undefined") {
		document =
			parseDesignDocument(localStorage.getItem(DESIGN_STORAGE_KEY)) ?? document
	}
	return { past: [], present: document, future: [] }
}

function editableTarget(target: EventTarget | null): boolean {
	return (
		target instanceof HTMLInputElement ||
		target instanceof HTMLTextAreaElement ||
		target instanceof HTMLSelectElement ||
		(target instanceof HTMLElement && target.isContentEditable)
	)
}

function updateObject(
	document: DesignDocument,
	object: DesignObject,
): DesignDocument {
	return {
		...document,
		objects: document.objects.map((candidate) =>
			candidate.id === object.id ? object : candidate,
		),
	}
}

function channelInput(
	label: string,
	value: number,
	maximum: number,
	onChange: (value: number) => void,
) {
	return (
		<label class="channel-input">
			<span>{label}</span>
			<input
				type="number"
				min={0}
				max={maximum}
				step={1}
				value={value}
				onInput={(event) => onChange(Number(event.currentTarget.value))}
			/>
		</label>
	)
}

export function DesignApplication() {
	const [history, dispatch] = useReducer(
		historyReducer,
		undefined,
		initialHistory,
	)
	const document = history.present
	const [tool, setTool] = useState<DesignTool>("select")
	const [selection, setSelection] = useState<readonly string[]>([])
	const [currentSwatchId, setCurrentSwatchId] = useState("swatch:coral")
	const [selectedSwatchId, setSelectedSwatchId] = useState("swatch:coral")
	const [paletteOpen, setPaletteOpen] = useState(false)
	const [status, setStatus] = useState(
		"Ready — draw a shape or press ⇧⌘P for commands.",
	)
	const [viewportWidth, setViewportWidth] = useState(() =>
		typeof window === "undefined" ? 1_440 : window.innerWidth,
	)
	const [previewObject, setPreviewObject] = useState<DesignObject | null>(null)
	const [drawBounds, setDrawBounds] = useState<Bounds | null>(null)
	const [penPoints, setPenPoints] = useState<readonly DesignPoint[]>([])
	const [canvasViewport, setCanvasViewport] = useState({
		width: 0,
		height: 0,
	})
	const [canvasView, setCanvasView] = useState({ x: 0, y: 0, zoom: 1 })
	const [activeSnap, setActiveSnap] = useState<Readonly<{
		x: number | null
		y: number | null
	}> | null>(null)
	const artboardWrapRef = useRef<HTMLDivElement>(null)
	const gestureRef = useRef<CanvasGesture | null>(null)
	const previewObjectRef = useRef<DesignObject | null>(null)
	const drawBoundsRef = useRef<Bounds | null>(null)
	const sequence = useRef(0)
	const nextId = useCallback(() => {
		sequence.current += 1
		return `${Date.now().toString(36)}:${sequence.current.toString(36)}`
	}, [])
	const allocation = columnSlotAllocation(viewportWidth)
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

	const commit = useCallback((next: DesignDocument): void => {
		dispatch({ type: "commit", document: next })
	}, [])

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

	const selectTool = useCallback((nextTool: DesignTool): void => {
		setTool(nextTool)
		setPenPoints([])
		setStatus(`${tools[nextTool].label} tool`)
	}, [])

	const deleteSelection = useCallback((): void => {
		if (selection.length === 0) return
		commit({
			...document,
			objects: document.objects.filter(
				(object) => !selection.includes(object.id),
			),
		})
		setSelection([])
		setStatus("Deleted selection.")
	}, [commit, document, selection])

	const finishPen = useCallback((): void => {
		if (penPoints.length < 2) {
			setPenPoints([])
			return
		}
		const object: DesignObject = {
			id: `object:${nextId()}`,
			name: `Pen path ${document.objects.length + 1}`,
			fillId: currentSwatchId,
			contours: [{ closed: penPoints.length >= 3, points: penPoints }],
		}
		commit({ ...document, objects: [...document.objects, object] })
		setSelection([object.id])
		setPenPoints([])
		setStatus(`Created ${object.name}.`)
	}, [commit, currentSwatchId, document, nextId, penPoints])

	const exportDocument = useCallback((): void => {
		downloadPdf(document)
		setStatus(
			`Exported ${document.title}.pdf with ${document.objects.length} vector objects.`,
		)
	}, [document])

	const commands = useMemo<readonly PaletteCommand[]>(
		() => [
			...(
				Object.entries(tools) as readonly [
					DesignTool,
					(typeof tools)[DesignTool],
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
		],
		[
			deleteSelection,
			exportDocument,
			history.future.length,
			history.past.length,
			selectTool,
			selection.length,
			tool,
		],
	)

	useEffect(() => {
		localStorage.setItem(DESIGN_STORAGE_KEY, JSON.stringify(document))
		window.document.title = `${history.present.title} — create-design`
	}, [document, history.present.title])

	useEffect(() => {
		const resize = (): void => setViewportWidth(window.innerWidth)
		window.addEventListener("resize", resize)
		return () => window.removeEventListener("resize", resize)
	}, [])

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
		const keydown = (event: KeyboardEvent): void => {
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
				setPenPoints([])
				setDrawBounds(null)
				setPreviewObject(null)
				drawBoundsRef.current = null
				previewObjectRef.current = null
				gestureRef.current = null
				return
			}
			if (event.key === "Backspace" || event.key === "Delete") {
				if (tool === "pen" && penPoints.length > 0) {
					event.preventDefault()
					setPenPoints((points) => points.slice(0, -1))
				} else {
					event.preventDefault()
					deleteSelection()
				}
				return
			}
			const entry = Object.entries(tools).find(
				([, definition]) =>
					definition.key.toLowerCase() === event.key.toLowerCase(),
			)
			if (entry !== undefined && !mod && !event.altKey) {
				event.preventDefault()
				selectTool(entry[0] as DesignTool)
			}
		}
		window.addEventListener("keydown", keydown)
		return () => window.removeEventListener("keydown", keydown)
	}, [
		deleteSelection,
		exportDocument,
		finishPen,
		paletteOpen,
		penPoints.length,
		selectTool,
		tool,
	])

	useEffect(() => {
		const copy = (event: ClipboardEvent): void => {
			if (editableTarget(event.target) || event.clipboardData === null) return
			const count = writeDesignClipboard(
				event.clipboardData,
				document,
				selection,
			)
			if (count === 0) return
			event.preventDefault()
			setStatus(`Copied ${count} vector object${count === 1 ? "" : "s"}.`)
		}
		const paste = (event: ClipboardEvent): void => {
			if (editableTarget(event.target) || event.clipboardData === null) return
			const addition = readDesignClipboard(
				event.clipboardData,
				document,
				nextId,
			)
			if (addition === null || addition.objects.length === 0) return
			event.preventDefault()
			commit({
				...document,
				swatches: [...document.swatches, ...addition.swatches],
				objects: [...document.objects, ...addition.objects],
			})
			setSelection(addition.objects.map((object) => object.id))
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
	}, [commit, document, nextId, selection])

	const startObjectGesture = (
		event: KonvaEventObject<PointerEvent>,
		object: DesignObject,
	): void => {
		if (object.locked || (tool !== "select" && tool !== "transform")) return
		event.cancelBubble = true
		setSelection([object.id])
		gestureRef.current = {
			kind: "move",
			pointerId: event.pointerId,
			start: pagePoint(event),
			original: object,
		}
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
			return
		}
		const point = pagePoint(event)
		if (tool === "rect" || tool === "ellipse") {
			gestureRef.current = {
				kind: "draw",
				pointerId: event.evt.pointerId,
				start: point,
				tool,
				shift: event.evt.shiftKey,
				alt: event.evt.altKey,
			}
			const bounds = normalizedBounds(point, point)
			drawBoundsRef.current = bounds
			setDrawBounds(bounds)
			return
		}
		if (tool === "pen") {
			setPenPoints((points) => [...points, point])
			return
		}
		if (tool === "rule") {
			const guide = {
				id: `guide:${nextId()}`,
				axis: event.evt.shiftKey ? ("y" as const) : ("x" as const),
				value: event.evt.shiftKey ? point.y : point.x,
			}
			commit({ ...document, guides: [...document.guides, guide] })
			setStatus(`Added ${guide.axis === "x" ? "vertical" : "horizontal"} rule.`)
			return
		}
		const hit = nearestDesignObject(
			previewObjects,
			point,
			worldScale,
			tool === "select" || tool === "transform" ? 12 : 0,
		)
		if (hit === null) setSelection([])
		else startObjectGesture(event, hit.object)
	}

	const pointerMove = (event: KonvaEventObject<PointerEvent>): void => {
		const gesture = gestureRef.current
		if (gesture === null || gesture.pointerId !== event.evt.pointerId) return
		if (gesture.kind === "pan") {
			const pointer = event.target.getStage()?.getPointerPosition()
			if (pointer === null || pointer === undefined) return
			setCanvasView({
				...gesture.original,
				x: gesture.original.x + pointer.x - gesture.start.x,
				y: gesture.original.y + pointer.y - gesture.start.y,
			})
			return
		}
		const point = pagePoint(event)
		if (gesture.kind === "draw") {
			gesture.shift = event.evt.shiftKey
			gesture.alt = event.evt.altKey
			const bounds = normalizedBounds(
				gesture.start,
				point,
				gesture.shift,
				gesture.alt,
			)
			drawBoundsRef.current = bounds
			setDrawBounds(bounds)
			return
		}
		if (gesture.kind === "move") {
			const rawObject = translateObject(
				gesture.original,
				point.x - gesture.start.x,
				point.y - gesture.start.y,
			)
			const snapped = snapDesignObject(rawObject, document, worldScale)
			const object = snapped.object
			setActiveSnap({ x: snapped.x, y: snapped.y })
			previewObjectRef.current = object
			setPreviewObject(object)
			return
		}
		const movingX =
			gesture.handle === "ne" || gesture.handle === "se"
				? gesture.bounds.maxX
				: gesture.bounds.minX
		const movingY =
			gesture.handle === "sw" || gesture.handle === "se"
				? gesture.bounds.maxY
				: gesture.bounds.minY
		const denominatorX = movingX - gesture.anchor.x
		const denominatorY = movingY - gesture.anchor.y
		const object = scaleObject(
			gesture.original,
			gesture.anchor,
			denominatorX === 0 ? 1 : (point.x - gesture.anchor.x) / denominatorX,
			denominatorY === 0 ? 1 : (point.y - gesture.anchor.y) / denominatorY,
		)
		previewObjectRef.current = object
		setPreviewObject(object)
	}

	const pointerUp = (event: KonvaEventObject<PointerEvent>): void => {
		const gesture = gestureRef.current
		if (gesture === null || gesture.pointerId !== event.evt.pointerId) return
		gestureRef.current = null
		setActiveSnap(null)
		if (gesture.kind === "pan") return
		if (gesture.kind === "draw") {
			const bounds = drawBoundsRef.current
			drawBoundsRef.current = null
			setDrawBounds(null)
			if (
				bounds === null ||
				bounds.maxX - bounds.minX < 2 ||
				bounds.maxY - bounds.minY < 2
			)
				return
			const object: DesignObject = {
				id: `object:${nextId()}`,
				name: `${gesture.tool === "rect" ? "Rectangle" : "Ellipse"} ${document.objects.length + 1}`,
				fillId: currentSwatchId,
				contours: [
					gesture.tool === "rect"
						? rectangleContour(bounds)
						: ellipseContour(bounds),
				],
			}
			commit({ ...document, objects: [...document.objects, object] })
			setSelection([object.id])
			setStatus(`Created ${object.name}.`)
			return
		}
		const committedPreview = previewObjectRef.current
		previewObjectRef.current = null
		if (committedPreview !== null) {
			commit(updateObject(document, committedPreview))
			setPreviewObject(null)
		}
	}

	const startScale = (
		event: KonvaEventObject<PointerEvent>,
		handle: "nw" | "ne" | "se" | "sw",
	): void => {
		if (selectedObject === null) return
		const bounds = objectBounds(selectedObject)
		if (bounds === null) return
		event.cancelBubble = true
		const anchor = {
			x: handle === "ne" || handle === "se" ? bounds.minX : bounds.maxX,
			y: handle === "sw" || handle === "se" ? bounds.minY : bounds.maxY,
		}
		gestureRef.current = {
			kind: "scale",
			pointerId: event.evt.pointerId,
			original: selectedObject,
			bounds,
			anchor,
			handle,
		}
	}

	const setObjectProperty = (
		object: DesignObject,
		property: Partial<DesignObject>,
	): void => {
		commit(updateObject(document, { ...object, ...property }))
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

	return (
		<design-application>
			<header class="app-header">
				<div class="brand">
					<svg viewBox="0 0 28 28" aria-hidden="true">
						<path d="M4 4h20v20H4z" />
						<circle cx="18" cy="10" r="5" />
					</svg>
					<strong>create-design</strong>
					<span>PDF proof of concept</span>
				</div>
				<label class="document-title">
					<span class="sr-only">Document title</span>
					<input
						value={document.title}
						onInput={(event) =>
							commit({ ...document, title: event.currentTarget.value })
						}
					/>
				</label>
				<div class="header-actions">
					<button
						type="button"
						class="command-trigger"
						onClick={() => setPaletteOpen(true)}
					>
						Commands <kbd>⇧⌘P</kbd>
					</button>
					<button type="button" class="export-button" onClick={exportDocument}>
						<DownloadIcon aria-hidden="true" /> Export PDF
					</button>
				</div>
			</header>

			<div
				class="workspace"
				data-left={allocation.left}
				data-right={allocation.right}
			>
				<nav class="tool-rail" aria-label="Tools">
					{(
						Object.entries(tools) as readonly [
							DesignTool,
							(typeof tools)[DesignTool],
						][]
					).map(([id, definition]) => {
						const Icon = definition.icon
						return (
							<button
								key={id}
								type="button"
								class={tool === id ? "active" : ""}
								title={`${definition.label} (${definition.key})`}
								aria-label={definition.label}
								aria-pressed={tool === id}
								onClick={() => selectTool(id)}
							>
								<Icon aria-hidden="true" />
								<kbd>{definition.key}</kbd>
							</button>
						)
					})}
				</nav>

				{allocation.left === 2 ? (
					<aside class="tile pages-tile">
						<TileHeader title="Pages" detail="1 artboard" />
						<div class="page-list">
							<button type="button" class="selected">
								<span class="page-thumbnail" />
								<span>
									<strong>Page 1</strong>
									<small>US Letter · 612 × 792 pt</small>
								</span>
							</button>
						</div>
					</aside>
				) : null}

				{allocation.left > 0 ? (
					<aside class="tile layers-tile">
						<TileHeader title="Layers" detail={`${document.objects.length}`} />
						<div class="layer-list">
							{[...document.objects].reverse().map((object) => (
								<button
									key={object.id}
									type="button"
									class={selection.includes(object.id) ? "selected" : ""}
									onClick={() => setSelection([object.id])}
								>
									<span
										class="layer-color"
										style={{
											background:
												document.swatches.find(
													(swatch) => swatch.id === object.fillId,
												) === undefined
													? "transparent"
													: swatchCss(
															document.swatches.find(
																(swatch) => swatch.id === object.fillId,
															) as DesignSwatch,
														),
										}}
									/>
									<span>{object.name}</span>
									<span class="layer-icons">
										{object.hidden ? <EyeClosedIcon /> : <EyeOpenIcon />}
										{object.locked ? <LockClosedIcon /> : null}
									</span>
								</button>
							))}
						</div>
					</aside>
				) : null}

				<main class="canvas-stage">
					<div class="canvas-meta">
						<span>{tools[tool].label}</span>
						<span>612 × 792 pt · {Math.round(canvasView.zoom * 100)}%</span>
					</div>
					<div
						ref={artboardWrapRef}
						class="artboard-wrap"
						role="application"
						aria-label="Design artboard"
					>
						<Stage
							width={canvasViewport.width}
							height={canvasViewport.height}
							className="artboard"
							style={{
								cursor: canvasToolCursor(tool, {
									dragging: gestureRef.current?.kind === "pan",
								}),
							}}
							onPointerDown={pointerDown}
							onPointerMove={pointerMove}
							onPointerUp={pointerUp}
							onPointerCancel={pointerUp}
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
									{document.guides.map((guide) => (
										<Line
											key={guide.id}
											name="design-guide"
											points={
												guide.axis === "x"
													? [guide.value, 0, guide.value, document.page.height]
													: [0, guide.value, document.page.width, guide.value]
											}
											stroke="#36a8e0"
											strokeWidth={1 / worldScale}
											dash={[5 / worldScale, 4 / worldScale]}
											listening={false}
										/>
									))}
									{previewObjects.map((object) => {
										const swatch = document.swatches.find(
											(candidate) => candidate.id === object.fillId,
										)
										return object.hidden || swatch === undefined ? null : (
											<Path
												key={object.id}
												name={`design-object ${object.id}`}
												data={objectSvgPath(object)}
												fill={swatchCss(swatch)}
												fillRule="evenodd"
												{...(selection.includes(object.id)
													? { stroke: "#e17352" }
													: {})}
												strokeWidth={2 / worldScale}
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
									{drawBounds === null || currentSwatch === undefined ? null : (
										<Path
											name="shape-preview"
											data={objectSvgPath({
												id: "preview",
												name: "Preview",
												fillId: currentSwatch.id,
												contours: [
													tool === "ellipse"
														? ellipseContour(drawBounds)
														: rectangleContour(drawBounds),
												],
											})}
											fill={swatchCss(currentSwatch)}
											opacity={0.66}
											stroke="#e17352"
											strokeWidth={2 / worldScale}
											dash={[5 / worldScale, 4 / worldScale]}
											listening={false}
										/>
									)}
									{penPoints.length === 0 ? null : (
										<Group listening={false}>
											<Line
												name="pen-preview"
												points={penPoints.flatMap((point) => [
													point.x,
													point.y,
												])}
												stroke="#e17352"
												strokeWidth={2 / worldScale}
											/>
											{penPoints.map((point, index) => (
												<Circle
													key={index}
													x={point.x}
													y={point.y}
													radius={4 / worldScale}
													fill="#fff"
													stroke="#e17352"
													strokeWidth={2 / worldScale}
												/>
											))}
										</Group>
									)}
									{activeSnap?.x === null ||
									activeSnap?.x === undefined ? null : (
										<Line
											name="active-snap active-snap-x"
											points={[
												activeSnap.x,
												0,
												activeSnap.x,
												document.page.height,
											]}
											stroke="#36a8e0"
											strokeWidth={1 / worldScale}
											dash={[4 / worldScale, 3 / worldScale]}
											listening={false}
										/>
									)}
									{activeSnap?.y === null ||
									activeSnap?.y === undefined ? null : (
										<Line
											name="active-snap active-snap-y"
											points={[
												0,
												activeSnap.y,
												document.page.width,
												activeSnap.y,
											]}
											stroke="#36a8e0"
											strokeWidth={1 / worldScale}
											dash={[4 / worldScale, 3 / worldScale]}
											listening={false}
										/>
									)}
									{selectionBounds === null ? null : (
										<Group name="transform-box">
											<Rect
												x={selectionBounds.minX}
												y={selectionBounds.minY}
												width={selectionBounds.maxX - selectionBounds.minX}
												height={selectionBounds.maxY - selectionBounds.minY}
												stroke="#e17352"
												strokeWidth={1 / worldScale}
												listening={false}
											/>
											{(
												[
													["nw", selectionBounds.minX, selectionBounds.minY],
													["ne", selectionBounds.maxX, selectionBounds.minY],
													["se", selectionBounds.maxX, selectionBounds.maxY],
													["sw", selectionBounds.minX, selectionBounds.maxY],
												] as const
											).map(([handle, x, y]) => (
												<Rect
													key={handle}
													name={`transform-handle transform-handle-${handle}`}
													x={x - 5 / worldScale}
													y={y - 5 / worldScale}
													width={10 / worldScale}
													height={10 / worldScale}
													fill="#fff"
													stroke="#e17352"
													strokeWidth={1.5 / worldScale}
													onPointerDown={(event) => startScale(event, handle)}
													onPointerEnter={(event) => {
														const container = event.target
															.getStage()
															?.container()
														if (container !== undefined)
															container.style.cursor = canvasToolCursor(
																"transform",
																{
																	resize:
																		handle === "nw" || handle === "se"
																			? "nwse-resize"
																			: "nesw-resize",
																},
															)
													}}
													onPointerLeave={(event) => {
														const container = event.target
															.getStage()
															?.container()
														if (container !== undefined)
															container.style.cursor = canvasToolCursor(tool)
													}}
												/>
											))}
										</Group>
									)}
								</Group>
							</Layer>
						</Stage>
					</div>
					<div class="canvas-hint">
						{tool === "pen"
							? "Click points · Enter closes · Esc cancels"
							: tool === "rule"
								? "Click for vertical rule · Shift-click for horizontal"
								: tool === "rect" || tool === "ellipse"
									? "Drag to draw · Shift constrains · Alt draws from center"
									: "Drag objects to move · F shows transform handles"}
					</div>
				</main>

				{allocation.right === 2 ? (
					<aside class="tile properties-tile">
						<TileHeader
							title="Object"
							detail={selectedObject?.name ?? "None"}
						/>
						{selectedObject === null ? (
							<EmptyPanel>Select an object to inspect it.</EmptyPanel>
						) : (
							<div class="panel-content">
								<label class="field">
									<span>Name</span>
									<input
										value={selectedObject.name}
										onChange={(event) =>
											setObjectProperty(selectedObject, {
												name: event.currentTarget.value,
											})
										}
									/>
								</label>
								<div class="object-actions">
									<button
										type="button"
										onClick={() =>
											setObjectProperty(selectedObject, {
												hidden: !selectedObject.hidden,
											})
										}
									>
										{selectedObject.hidden ? (
											<EyeClosedIcon />
										) : (
											<EyeOpenIcon />
										)}
										{selectedObject.hidden ? "Hidden" : "Visible"}
									</button>
									<button
										type="button"
										onClick={() =>
											setObjectProperty(selectedObject, {
												locked: !selectedObject.locked,
											})
										}
									>
										{selectedObject.locked ? (
											<LockClosedIcon />
										) : (
											<LockOpen1Icon />
										)}
										{selectedObject.locked ? "Locked" : "Unlocked"}
									</button>
								</div>
								<button
									type="button"
									class="danger-button"
									onClick={deleteSelection}
								>
									<TrashIcon /> Delete object
								</button>
							</div>
						)}
					</aside>
				) : null}

				<aside class="tile color-tile">
					<TileHeader
						title="Color"
						detail={selectedSwatch?.source.space.toUpperCase() ?? ""}
					/>
					<div class="swatch-list">
						{document.swatches.map((swatch) => (
							<button
								key={swatch.id}
								type="button"
								class={selectedSwatchId === swatch.id ? "selected" : ""}
								onClick={() => {
									setSelectedSwatchId(swatch.id)
									setCurrentSwatchId(swatch.id)
									if (selectedObject !== null) {
										setObjectProperty(selectedObject, { fillId: swatch.id })
									}
								}}
							>
								<span
									class="swatch-chip"
									style={{ background: swatchCss(swatch) }}
								/>
								<span>
									<strong>{swatch.name}</strong>
									<small>
										{swatch.source.space.toUpperCase()}
										{swatch.alternate === undefined ? " · auto" : " · manual"}
									</small>
								</span>
							</button>
						))}
						<button type="button" class="add-swatch" onClick={addSwatch}>
							+ New swatch
						</button>
					</div>
					{selectedSwatch === undefined ? null : (
						<SwatchEditor swatch={selectedSwatch} onChange={updateSwatch} />
					)}
				</aside>
			</div>

			<footer class="status-bar">
				<span>{status}</span>
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

function TileHeader({
	title,
	detail,
}: {
	readonly title: string
	readonly detail: string
}) {
	return (
		<header class="tile-header">
			<strong>{title}</strong>
			<span>{detail}</span>
		</header>
	)
}

function EmptyPanel({ children }: { readonly children: ComponentChildren }) {
	return <div class="empty-panel">{children}</div>
}

function SwatchEditor({
	swatch,
	onChange,
}: {
	readonly swatch: DesignSwatch
	readonly onChange: (swatch: DesignSwatch) => void
}) {
	const source = swatch.source
	const automatic =
		source.space === "rgb" ? rgbToCmyk(source) : cmykToRgb(source)
	const alternate = swatch.alternate ?? automatic
	const updateSource = (next: ColorDefinition): void =>
		onChange({ ...swatch, source: next })
	const updateAlternate = (next: ColorDefinition): void =>
		onChange({ ...swatch, alternate: next })
	return (
		<div class="swatch-editor">
			<label class="field">
				<span>Swatch name</span>
				<input
					value={swatch.name}
					onChange={(event) =>
						onChange({ ...swatch, name: event.currentTarget.value })
					}
				/>
			</label>
			<div class="segmented" role="group" aria-label="Source color space">
				{(["rgb", "cmyk"] as const).map((space) => (
					<button
						type="button"
						class={source.space === space ? "selected" : ""}
						onClick={() => {
							if (source.space === space) return
							onChange({
								...swatch,
								source:
									space === "rgb" ? resolvedRgb(swatch) : resolvedCmyk(swatch),
								alternate: undefined,
							})
						}}
					>
						{space.toUpperCase()}
					</button>
				))}
			</div>
			<div class="channels">
				{source.space === "rgb" ? (
					<>
						{channelInput("R", source.r, 255, (r) =>
							updateSource({ ...source, r }),
						)}
						{channelInput("G", source.g, 255, (g) =>
							updateSource({ ...source, g }),
						)}
						{channelInput("B", source.b, 255, (b) =>
							updateSource({ ...source, b }),
						)}
					</>
				) : (
					<>
						{channelInput("C", source.c, 100, (c) =>
							updateSource({ ...source, c }),
						)}
						{channelInput("M", source.m, 100, (m) =>
							updateSource({ ...source, m }),
						)}
						{channelInput("Y", source.y, 100, (y) =>
							updateSource({ ...source, y }),
						)}
						{channelInput("K", source.k, 100, (k) =>
							updateSource({ ...source, k }),
						)}
					</>
				)}
			</div>
			<label class="manual-toggle">
				<input
					type="checkbox"
					checked={swatch.alternate !== undefined}
					onChange={(event) =>
						onChange({
							...swatch,
							alternate: event.currentTarget.checked ? automatic : undefined,
						})
					}
				/>
				<span>
					Manual {oppositeColorSpace(source).toUpperCase()} equivalent
				</span>
			</label>
			{swatch.alternate === undefined ? (
				<p class="conversion-note">
					Automatic {oppositeColorSpace(source).toUpperCase()}:{" "}
					{alternate.space === "rgb"
						? `${alternate.r}, ${alternate.g}, ${alternate.b}`
						: `${alternate.c}, ${alternate.m}, ${alternate.y}, ${alternate.k}`}
				</p>
			) : (
				<div class="channels alternate">
					{alternate.space === "rgb" ? (
						<>
							{channelInput("R", alternate.r, 255, (r) =>
								updateAlternate({ ...alternate, r }),
							)}
							{channelInput("G", alternate.g, 255, (g) =>
								updateAlternate({ ...alternate, g }),
							)}
							{channelInput("B", alternate.b, 255, (b) =>
								updateAlternate({ ...alternate, b }),
							)}
						</>
					) : (
						<>
							{channelInput("C", alternate.c, 100, (c) =>
								updateAlternate({ ...alternate, c }),
							)}
							{channelInput("M", alternate.m, 100, (m) =>
								updateAlternate({ ...alternate, m }),
							)}
							{channelInput("Y", alternate.y, 100, (y) =>
								updateAlternate({ ...alternate, y }),
							)}
							{channelInput("K", alternate.k, 100, (k) =>
								updateAlternate({ ...alternate, k }),
							)}
						</>
					)}
				</div>
			)}
		</div>
	)
}
