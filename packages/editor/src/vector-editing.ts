export interface VectorPoint {
	readonly x: number
	readonly y: number
}

export type VectorHandleKind = "incoming" | "outgoing"
export type VectorNodeMode = "soft" | "hard"

export interface VectorNode extends VectorPoint {
	readonly id: string
	readonly mode: VectorNodeMode
	readonly incoming?: VectorPoint
	readonly outgoing?: VectorPoint
}

export interface VectorContour {
	readonly id: string
	readonly closed: boolean
	readonly nodes: readonly VectorNode[]
}

export type VectorColorDefinition =
	| Readonly<{
			readonly space: "rgb"
			readonly r: number
			readonly g: number
			readonly b: number
	  }>
	| Readonly<{
			readonly space: "cmyk"
			readonly c: number
			readonly m: number
			readonly y: number
			readonly k: number
	  }>

export type VectorStyle =
	| Readonly<{ readonly kind: "neutral" }>
	| Readonly<{
			readonly kind: "fill"
			readonly swatchId: string
			readonly resolvedCss: string
			readonly source: VectorColorDefinition
			readonly alternate?: VectorColorDefinition
	  }>

export interface VectorObject {
	readonly id: string
	readonly name: string
	readonly contours: readonly VectorContour[]
	readonly style: VectorStyle
	readonly hidden?: boolean
	readonly locked?: boolean
}

export type VectorSelectionTarget =
	| Readonly<{ readonly kind: "object"; readonly objectId: string }>
	| Readonly<{
			readonly kind: "node"
			readonly objectId: string
			readonly contourId: string
			readonly pointId: string
	  }>
	| Readonly<{
			readonly kind: "handle"
			readonly objectId: string
			readonly contourId: string
			readonly pointId: string
			readonly handle: VectorHandleKind
	  }>

export interface VectorSnapshot {
	readonly revision: string
	readonly objects: readonly VectorObject[]
	readonly selection: readonly VectorSelectionTarget[]
}

export interface VectorClipboardPayload {
	readonly format: "create-vector.selection"
	readonly version: 1
	readonly objects: readonly VectorObject[]
}

export const VECTOR_CLIPBOARD_MIME =
	"application/vnd.create-font.vector+json" as const

export interface VectorVariantNode extends VectorNode {
	readonly variantId: string
}

export type VectorEditIntent =
	| Readonly<{
			readonly kind: "create-object"
			readonly object: VectorObject
	  }>
	| Readonly<{
			readonly kind: "create-contour"
			readonly objectId: string
			readonly contour: VectorContour
			readonly variants?: readonly Readonly<{
				readonly variantId: string
				readonly nodes: readonly VectorVariantNode[]
			}>[]
	  }>
	| Readonly<{
			readonly kind: "insert-node"
			readonly objectId: string
			readonly contourId: string
			readonly node: VectorNode
			readonly at?: number
			readonly variants?: readonly VectorVariantNode[]
	  }>
	| Readonly<{
			readonly kind: "author-endpoint"
			readonly objectId: string
			readonly contourId: string
			readonly pointId: string
			readonly forwardHandle: VectorHandleKind
			readonly mode: VectorNodeMode
			readonly variants: readonly Readonly<{
				readonly variantId: string
				readonly forward: VectorPoint | null
			}>[]
	  }>
	| Readonly<{
			readonly kind: "close-contour"
			readonly objectId: string
			readonly contourId: string
			readonly endpoint?: Readonly<{
				readonly side: "first" | "last"
				readonly pointId: string
				readonly mode: VectorNodeMode
				readonly variants: readonly Readonly<{
					readonly variantId: string
					readonly incoming: VectorPoint
					readonly outgoing: VectorPoint
				}>[]
			}>
	  }>
	| Readonly<{
			readonly kind: "replace-object"
			readonly object: VectorObject
	  }>
	| Readonly<{
			readonly kind: "transform-controls"
			readonly points: readonly {
				readonly pointId: string
				readonly x: number
				readonly y: number
			}[]
			readonly handles: readonly {
				readonly pointId: string
				readonly handle: VectorHandleKind
				readonly x: number
				readonly y: number
			}[]
	  }>
	| Readonly<{
			readonly kind: "delete"
			readonly objectIds: readonly string[]
			readonly controls?: readonly VectorSelectionTarget[]
			readonly deletePolicy?: "preserve-paths" | "break-paths"
	  }>
	| Readonly<{
			readonly kind: "reorder"
			readonly objectId: string
			readonly toIndex: number
	  }>
	| Readonly<{
			readonly kind: "set-style"
			readonly objectId: string
			readonly style: VectorStyle
	  }>
	| Readonly<{
			readonly kind: "set-object-properties"
			readonly objectId: string
			readonly name?: string
			readonly hidden?: boolean
			readonly locked?: boolean
	  }>
	| Readonly<{
			readonly kind: "move-handle"
			readonly objectId: string
			readonly pointId: string
			readonly handle: VectorHandleKind
			readonly vector: VectorPoint
	  }>

export type VectorEditResult<Document, Selection> =
	| Readonly<{
			readonly ok: true
			readonly document: Document
			readonly selection: Selection
	  }>
	| Readonly<{ readonly ok: false; readonly error: string }>

export interface VectorDocumentAdapter<Document, Selection> {
	readonly project: (document: Document, selection: Selection) => VectorSnapshot
	readonly apply: (
		document: Document,
		selection: Selection,
		intent: VectorEditIntent,
	) => VectorEditResult<Document, Selection>
	readonly clipboard: (
		document: Document,
		selection: Selection,
	) => VectorClipboardPayload
}

export function validateVectorObject(object: VectorObject): string | null {
	if (object.id.length === 0) return "Vector object IDs must not be empty."
	if (object.contours.length === 0)
		return `Vector object ${object.id} requires at least one contour.`
	const contourIds = new Set<string>()
	const pointIds = new Set<string>()
	for (const contour of object.contours) {
		if (contour.id.length === 0 || contourIds.has(contour.id))
			return `Vector contour ID ${contour.id || "(empty)"} is invalid.`
		contourIds.add(contour.id)
		if (contour.closed && contour.nodes.length < 3)
			return `Closed contour ${contour.id} requires at least three points.`
		for (const node of contour.nodes) {
			if (node.id.length === 0 || pointIds.has(node.id))
				return `Vector point ID ${node.id || "(empty)"} is invalid.`
			pointIds.add(node.id)
			if (
				![
					node.x,
					node.y,
					node.incoming?.x,
					node.incoming?.y,
					node.outgoing?.x,
					node.outgoing?.y,
				]
					.filter((value) => value !== undefined)
					.every(Number.isFinite)
			)
				return `Vector point ${node.id} has non-finite geometry.`
		}
	}
	return null
}

export function vectorClipboardPayload(
	snapshot: VectorSnapshot,
): VectorClipboardPayload {
	const selectedIds = new Set(
		snapshot.selection.flatMap((target) =>
			target.kind === "object" ? [target.objectId] : [],
		),
	)
	return {
		format: "create-vector.selection",
		version: 1,
		objects: snapshot.objects.filter((object) => selectedIds.has(object.id)),
	}
}

export interface VectorClipboardWriter {
	setData(format: string, value: string): void
}

export interface VectorClipboardReader {
	getData(format: string): string
}

export function writeVectorClipboard(
	clipboard: VectorClipboardWriter,
	payload: VectorClipboardPayload,
): boolean {
	if (payload.objects.length === 0) return false
	clipboard.setData(VECTOR_CLIPBOARD_MIME, JSON.stringify(payload))
	return true
}

export function readVectorClipboard(
	clipboard: VectorClipboardReader,
): VectorClipboardPayload | null {
	const serialized = clipboard.getData(VECTOR_CLIPBOARD_MIME)
	if (serialized.length === 0) return null
	try {
		const parsed = JSON.parse(serialized) as Partial<VectorClipboardPayload>
		if (
			parsed.format !== "create-vector.selection" ||
			parsed.version !== 1 ||
			!Array.isArray(parsed.objects)
		)
			return null
		for (const object of parsed.objects) {
			if (validateVectorObject(object) !== null) return null
		}
		return parsed as VectorClipboardPayload
	} catch {
		return null
	}
}
