import type {
	AuthoringContourInput,
	AuthoringLayerPointInput,
	ContourId,
	EditorGlyphSource,
	EditorHandleVectorSource,
	MasterId,
	PasteContoursInput,
	PointId,
} from "@create-font/states"

import type { EditorSelectionTarget } from "./outline-selection.ts"

export const OUTLINE_CLIPBOARD_MIME =
	"application/vnd.create-font.outline+json" as const
export const OUTLINE_CLIPBOARD_TEXT_PREFIX = "create-font-outline:" as const
export const OUTLINE_CLIPBOARD_VERSION = 1 as const
export const MAX_OUTLINE_CLIPBOARD_BYTES = 1_000_000
const MAX_CONTOURS = 1_024
const MAX_POINTS = 10_000

interface ClipboardPoint {
	readonly key: string
	readonly mode: "soft" | "hard"
}

interface ClipboardLayerPoint {
	readonly key: string
	readonly x: number
	readonly y: number
	readonly incoming?: EditorHandleVectorSource
	readonly outgoing?: EditorHandleVectorSource
}

export interface OutlineClipboardPayload {
	readonly format: "create-font.outline"
	readonly version: typeof OUTLINE_CLIPBOARD_VERSION
	readonly masterIds: readonly MasterId[]
	readonly contours: readonly {
		readonly closed: boolean
		readonly points: readonly ClipboardPoint[]
	}[]
	readonly layers: readonly {
		readonly masterId: MasterId
		readonly points: readonly ClipboardLayerPoint[]
	}[]
}

export type OutlineClipboardResult<Value> =
	| { readonly ok: true; readonly value: Value }
	| { readonly ok: false; readonly error: string }

interface SelectedRun {
	readonly closed: boolean
	readonly indexes: readonly number[]
}

function selectedRuns(
	length: number,
	closed: boolean,
	selected: ReadonlySet<number>,
): readonly SelectedRun[] {
	if (length === 0 || selected.size === 0) return []
	if (selected.size === length) {
		return [{ closed, indexes: Array.from({ length }, (_, index) => index) }]
	}
	const runs: number[][] = []
	let current: number[] = []
	for (let index = 0; index < length; index += 1) {
		if (selected.has(index)) {
			current.push(index)
		} else if (current.length > 0) {
			runs.push(current)
			current = []
		}
	}
	if (current.length > 0) runs.push(current)
	if (
		closed &&
		runs.length > 1 &&
		selected.has(0) &&
		selected.has(length - 1)
	) {
		const first = runs.shift()
		const last = runs.pop()
		if (first !== undefined && last !== undefined)
			runs.unshift([...last, ...first])
	}
	return runs.map((indexes) => ({ closed: false, indexes }))
}

function safeVector(value: unknown): EditorHandleVectorSource | undefined {
	if (typeof value !== "object" || value === null) return undefined
	const candidate = value as { x?: unknown; y?: unknown }
	return typeof candidate.x === "number" &&
		Number.isFinite(candidate.x) &&
		typeof candidate.y === "number" &&
		Number.isFinite(candidate.y)
		? { x: candidate.x, y: candidate.y }
		: undefined
}

export function copyOutlineSelection(
	glyph: EditorGlyphSource,
	masterId: MasterId,
	selection: readonly EditorSelectionTarget[],
): OutlineClipboardResult<OutlineClipboardPayload> {
	const selectedPointIds = new Set(
		selection
			.filter((target) => target.kind === "node")
			.map((target) => target.pointId),
	)
	if (selectedPointIds.size === 0) {
		return { ok: false, error: "Select one or more outline nodes to copy." }
	}
	const activeLayer = glyph.layers.find((layer) => layer.masterId === masterId)
	if (activeLayer === undefined) {
		return { ok: false, error: `The glyph has no ${masterId} layer.` }
	}
	const contours: OutlineClipboardPayload["contours"][number][] = []
	const layerPoints: ClipboardLayerPoint[] = []
	let fragmentSequence = 0

	for (const contour of activeLayer.contours) {
		const selectedIndexes = new Set<number>()
		contour.points.forEach((point, index) => {
			if (selectedPointIds.has(point.id)) selectedIndexes.add(index)
		})
		for (const run of selectedRuns(
			contour.points.length,
			contour.closed,
			selectedIndexes,
		)) {
			const fragment = fragmentSequence
			fragmentSequence += 1
			const points: ClipboardPoint[] = []
			for (let runIndex = 0; runIndex < run.indexes.length; runIndex += 1) {
				const contourIndex = run.indexes[runIndex]
				const point =
					contourIndex === undefined ? undefined : contour.points[contourIndex]
				if (point === undefined) continue
				const key = `${fragment}/${runIndex}`
				const endpointOfFragment =
					!run.closed && (runIndex === 0 || runIndex === run.indexes.length - 1)
				points.push({ key, mode: endpointOfFragment ? "hard" : point.mode })
				const source = point
				const includeIncoming = run.closed || runIndex > 0
				const includeOutgoing = run.closed || runIndex < run.indexes.length - 1
				layerPoints.push({
					key,
					x: source.x,
					y: source.y,
					...(includeIncoming && source.incoming !== undefined
						? { incoming: { ...source.incoming } }
						: {}),
					...(includeOutgoing && source.outgoing !== undefined
						? { outgoing: { ...source.outgoing } }
						: {}),
				})
			}
			if (points.length > 0) contours.push({ closed: run.closed, points })
		}
	}
	if (contours.length === 0) {
		return {
			ok: false,
			error: "The selected nodes are not part of this glyph.",
		}
	}
	return {
		ok: true,
		value: {
			format: "create-font.outline",
			version: OUTLINE_CLIPBOARD_VERSION,
			masterIds: [masterId],
			contours,
			layers: [{ masterId, points: layerPoints }],
		},
	}
}

export function serializeOutlineClipboard(
	payload: OutlineClipboardPayload,
): string {
	return JSON.stringify(payload)
}

export function outlineClipboardPlainText(
	payload: OutlineClipboardPayload,
): string {
	return `${OUTLINE_CLIPBOARD_TEXT_PREFIX}${serializeOutlineClipboard(payload)}`
}

export function parseOutlineClipboard(
	serialized: string,
): OutlineClipboardResult<OutlineClipboardPayload> {
	const json = serialized.startsWith(OUTLINE_CLIPBOARD_TEXT_PREFIX)
		? serialized.slice(OUTLINE_CLIPBOARD_TEXT_PREFIX.length)
		: serialized
	if (new TextEncoder().encode(json).byteLength > MAX_OUTLINE_CLIPBOARD_BYTES) {
		return { ok: false, error: "The outline clipboard payload is too large." }
	}
	let value: unknown
	try {
		value = JSON.parse(json)
	} catch {
		return {
			ok: false,
			error: "The clipboard does not contain valid outline JSON.",
		}
	}
	if (typeof value !== "object" || value === null) {
		return { ok: false, error: "The clipboard outline payload is malformed." }
	}
	const candidate = value as {
		format?: unknown
		version?: unknown
		masterIds?: unknown
		contours?: unknown
		layers?: unknown
	}
	if (candidate.format !== "create-font.outline") {
		return {
			ok: false,
			error: "The clipboard does not contain create-font outlines.",
		}
	}
	if (candidate.version !== OUTLINE_CLIPBOARD_VERSION) {
		return {
			ok: false,
			error: "This outline clipboard version is not supported.",
		}
	}
	if (
		!Array.isArray(candidate.masterIds) ||
		!candidate.masterIds.every(
			(masterId) =>
				typeof masterId === "string" && masterId.startsWith("master:"),
		) ||
		new Set(candidate.masterIds).size !== candidate.masterIds.length
	) {
		return { ok: false, error: "The clipboard master list is malformed." }
	}
	if (!Array.isArray(candidate.contours) || candidate.contours.length === 0) {
		return { ok: false, error: "The clipboard contains no outline contours." }
	}
	if (candidate.contours.length > MAX_CONTOURS) {
		return { ok: false, error: "The clipboard contains too many contours." }
	}
	let pointCount = 0
	const keys = new Set<string>()
	for (const contourValue of candidate.contours) {
		if (typeof contourValue !== "object" || contourValue === null) {
			return { ok: false, error: "A clipboard contour is malformed." }
		}
		const contour = contourValue as { closed?: unknown; points?: unknown }
		if (typeof contour.closed !== "boolean" || !Array.isArray(contour.points)) {
			return { ok: false, error: "A clipboard contour is malformed." }
		}
		if (
			contour.points.length === 0 ||
			(contour.closed && contour.points.length < 3)
		) {
			return { ok: false, error: "A clipboard contour has invalid topology." }
		}
		for (const pointValue of contour.points) {
			if (typeof pointValue !== "object" || pointValue === null) {
				return { ok: false, error: "A clipboard point is malformed." }
			}
			const point = pointValue as { key?: unknown; mode?: unknown }
			if (
				typeof point.key !== "string" ||
				point.key.length === 0 ||
				keys.has(point.key) ||
				(point.mode !== "soft" && point.mode !== "hard")
			) {
				return { ok: false, error: "A clipboard point is malformed." }
			}
			keys.add(point.key)
			pointCount += 1
		}
	}
	if (pointCount > MAX_POINTS) {
		return { ok: false, error: "The clipboard contains too many points." }
	}
	if (!Array.isArray(candidate.layers)) {
		return { ok: false, error: "The clipboard layers are malformed." }
	}
	const layerMasters = new Set<string>()
	for (const layerValue of candidate.layers) {
		if (typeof layerValue !== "object" || layerValue === null) {
			return { ok: false, error: "A clipboard layer is malformed." }
		}
		const layer = layerValue as { masterId?: unknown; points?: unknown }
		if (
			typeof layer.masterId !== "string" ||
			!candidate.masterIds.includes(layer.masterId) ||
			layerMasters.has(layer.masterId) ||
			!Array.isArray(layer.points) ||
			layer.points.length !== pointCount
		) {
			return { ok: false, error: "A clipboard layer is malformed." }
		}
		layerMasters.add(layer.masterId)
		const layerKeys = new Set<string>()
		for (const pointValue of layer.points) {
			if (typeof pointValue !== "object" || pointValue === null) {
				return { ok: false, error: "A clipboard layer point is malformed." }
			}
			const point = pointValue as {
				key?: unknown
				x?: unknown
				y?: unknown
				incoming?: unknown
				outgoing?: unknown
			}
			if (
				typeof point.key !== "string" ||
				!keys.has(point.key) ||
				layerKeys.has(point.key) ||
				typeof point.x !== "number" ||
				!Number.isFinite(point.x) ||
				typeof point.y !== "number" ||
				!Number.isFinite(point.y) ||
				(point.incoming !== undefined &&
					safeVector(point.incoming) === undefined) ||
				(point.outgoing !== undefined &&
					safeVector(point.outgoing) === undefined)
			) {
				return { ok: false, error: "A clipboard layer point is malformed." }
			}
			layerKeys.add(point.key)
		}
	}
	if (
		layerMasters.size !== candidate.masterIds.length ||
		candidate.masterIds.some((masterId) => !layerMasters.has(masterId))
	) {
		return {
			ok: false,
			error: "The clipboard is missing one or more master layers.",
		}
	}
	return { ok: true, value: value as OutlineClipboardPayload }
}

export function prepareOutlinePaste(
	payload: OutlineClipboardPayload,
	masterId: MasterId,
	glyphId: PasteContoursInput["glyphId"],
	destinationMasterIds: readonly MasterId[],
	nextId: (kind: "contour" | "point") => ContourId | PointId,
): OutlineClipboardResult<
	PasteContoursInput & { readonly selectedPointIds: readonly PointId[] }
> {
	if (
		payload.masterIds.length !== destinationMasterIds.length ||
		destinationMasterIds.some(
			(masterId) => !payload.masterIds.includes(masterId),
		)
	) {
		return {
			ok: false,
			error: "The copied outlines use a different set of font masters.",
		}
	}
	const pointIds = new Map<string, PointId>()
	const contours: AuthoringContourInput[] = payload.contours.map((contour) => ({
		id: nextId("contour") as ContourId,
		closed: contour.closed,
		points: contour.points.map((point) => {
			const id = nextId("point") as PointId
			pointIds.set(point.key, id)
			return { id, mode: point.mode }
		}),
	}))
	const layers = payload.layers.map((layer) => ({
		masterId: layer.masterId,
		points: layer.points.map((point): AuthoringLayerPointInput => {
			const pointId = pointIds.get(point.key)
			if (pointId === undefined)
				throw new Error("Clipboard point key is missing.")
			return {
				pointId,
				x: point.x,
				y: point.y,
				...(point.incoming === undefined
					? {}
					: { incoming: { ...point.incoming } }),
				...(point.outgoing === undefined
					? {}
					: { outgoing: { ...point.outgoing } }),
			}
		}),
	}))
	return {
		ok: true,
		value: {
			masterId,
			glyphId,
			contours,
			layers,
			selectedPointIds: [...pointIds.values()],
		},
	}
}

/** Replaces any prior mixed selection with the freshly allocated paste nodes. */
export function outlinePasteSelectionTargets(
	selectedPointIds: readonly PointId[],
): readonly EditorSelectionTarget[] {
	return Object.freeze(
		selectedPointIds.map((pointId) => ({ kind: "node" as const, pointId })),
	)
}
