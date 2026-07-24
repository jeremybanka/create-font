export interface CanvasPoint {
	readonly x: number
	readonly y: number
}

export interface CanvasView {
	readonly x: number
	readonly y: number
	readonly zoom: number
}

export interface CanvasViewport {
	readonly width: number
	readonly height: number
}

export interface CanvasViewOptions {
	readonly baseScale: number
	readonly minZoom?: number
	readonly maxZoom?: number
}

export interface CanvasWheelInput {
	readonly deltaX: number
	readonly deltaY: number
	readonly shiftKey: boolean
	readonly altKey: boolean
	readonly ctrlKey: boolean
	readonly metaKey: boolean
}

export interface RankedAxisCandidate {
	readonly id: string
	readonly priority: number
	readonly value: number
}

export interface RankedPointCandidate {
	readonly id: string
	readonly priority: number
	readonly x: number
	readonly y: number
}

export type CanvasCursorTool =
	| "select"
	| "transform"
	| "pen"
	| "rect"
	| "ellipse"
	| "rule"

export type CanvasCursor =
	| "default"
	| "grab"
	| "grabbing"
	| "crosshair"
	| "move"
	| "ns-resize"
	| "ew-resize"
	| "nwse-resize"
	| "nesw-resize"

const validView = (view: CanvasView): boolean =>
	Number.isFinite(view.x) &&
	Number.isFinite(view.y) &&
	Number.isFinite(view.zoom) &&
	view.zoom > 0

export function canvasScale(
	view: CanvasView,
	options: CanvasViewOptions,
): number {
	if (!validView(view) || !(options.baseScale > 0)) return 1
	return view.zoom * options.baseScale
}

export function inverseCanvasScale(
	view: CanvasView,
	options: CanvasViewOptions,
): number {
	return 1 / canvasScale(view, options)
}

export function documentToScreen(
	point: CanvasPoint,
	view: CanvasView,
	options: CanvasViewOptions,
): CanvasPoint {
	const scale = canvasScale(view, options)
	return { x: view.x + point.x * scale, y: view.y + point.y * scale }
}

export function screenToDocument(
	point: CanvasPoint,
	view: CanvasView,
	options: CanvasViewOptions,
): CanvasPoint {
	const scale = canvasScale(view, options)
	return { x: (point.x - view.x) / scale, y: (point.y - view.y) / scale }
}

export function zoomCanvasViewWithOptions(
	current: CanvasView,
	nextZoom: number,
	focal: CanvasPoint,
	options: CanvasViewOptions,
): CanvasView {
	if (!validView(current) || !Number.isFinite(nextZoom)) {
		if (nextZoom !== Number.POSITIVE_INFINITY) return current
	}
	const minimum = options.minZoom ?? 0.25
	const maximum = options.maxZoom ?? 10
	const zoom = Math.min(maximum, Math.max(minimum, nextZoom))
	const world = screenToDocument(focal, current, options)
	const nextScale = canvasScale({ ...current, zoom }, options)
	return {
		x: focal.x - world.x * nextScale,
		y: focal.y - world.y * nextScale,
		zoom,
	}
}

export function hasWheelZoomModifier(event: CanvasWheelInput): boolean {
	return event.altKey || event.ctrlKey || event.metaKey
}

export function reduceCanvasWheel(
	current: CanvasView,
	event: CanvasWheelInput,
	focal: CanvasPoint,
	options: CanvasViewOptions,
): CanvasView {
	if (
		!Number.isFinite(event.deltaX) ||
		!Number.isFinite(event.deltaY) ||
		!Number.isFinite(focal.x) ||
		!Number.isFinite(focal.y)
	)
		return current
	if (hasWheelZoomModifier(event)) {
		return zoomCanvasViewWithOptions(
			current,
			current.zoom * Math.exp(-event.deltaY * 0.002),
			focal,
			options,
		)
	}
	return {
		...current,
		x: current.x - (event.deltaX || (event.shiftKey ? event.deltaY : 0)),
		y: current.y - (event.shiftKey ? 0 : event.deltaY),
	}
}

export function canvasToolCursor(
	tool: CanvasCursorTool,
	options: {
		readonly dragging?: boolean
		readonly overObject?: boolean
		readonly resize?: Exclude<
			CanvasCursor,
			"default" | "grab" | "grabbing" | "crosshair" | "move"
		>
	} = {},
): CanvasCursor {
	if (options.resize !== undefined) return options.resize
	if (options.dragging) return "grabbing"
	if (tool === "select" || tool === "transform")
		return options.overObject ? "move" : "default"
	return "crosshair"
}

export function rankAxisCandidate<Candidate extends RankedAxisCandidate>(
	value: number,
	candidates: readonly Candidate[],
	threshold: number,
): Candidate | null {
	if (!Number.isFinite(value) || !Number.isFinite(threshold) || threshold < 0)
		return null
	return (
		candidates
			.filter(
				(candidate) =>
					Number.isFinite(candidate.value) &&
					Math.abs(candidate.value - value) <= threshold,
			)
			.toSorted(
				(left, right) =>
					Math.abs(left.value - value) - Math.abs(right.value - value) ||
					left.priority - right.priority ||
					left.id.localeCompare(right.id),
			)[0] ?? null
	)
}

export function rankPointCandidate<Candidate extends RankedPointCandidate>(
	point: CanvasPoint,
	candidates: readonly Candidate[],
	worldScale: number,
	maxDistancePixels: number,
): (Candidate & { readonly distancePixels: number }) | null {
	if (
		!Number.isFinite(point.x) ||
		!Number.isFinite(point.y) ||
		!(worldScale > 0) ||
		!(maxDistancePixels >= 0)
	)
		return null
	return (
		candidates
			.map((candidate) => ({
				...candidate,
				distancePixels:
					Math.hypot(candidate.x - point.x, candidate.y - point.y) * worldScale,
			}))
			.filter(
				(candidate) =>
					Number.isFinite(candidate.distancePixels) &&
					candidate.distancePixels <= maxDistancePixels,
			)
			.toSorted(
				(left, right) =>
					left.distancePixels - right.distancePixels ||
					left.priority - right.priority ||
					left.id.localeCompare(right.id),
			)[0] ?? null
	)
}
