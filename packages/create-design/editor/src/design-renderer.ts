export const DESIGN_CANVAS_RENDERER_STORAGE_KEY =
	"create-design:canvas-renderer:v1"

export const DESIGN_CANVAS_RENDERERS = Object.freeze([
	Object.freeze({ id: "konva", label: "Konva (original)" }),
	Object.freeze({
		id: "konva-preserved",
		label: "Konva (preserved detail)",
	}),
] as const)

export type DesignCanvasRendererId =
	(typeof DESIGN_CANVAS_RENDERERS)[number]["id"]

export const DEFAULT_DESIGN_CANVAS_RENDERER: DesignCanvasRendererId = "konva"

export const PRESERVED_KONVA_MINIMUM_STROKE_DEVICE_PIXELS = 1

export type DesignCanvasStrokeProjection = Readonly<{
	authoredWidth: number
	devicePixelRatio: number
	renderer: DesignCanvasRendererId
	worldScale: number
}>

/**
 * Projects an authored document-space stroke into a display-only width.
 *
 * The original renderer remains exact. The preserved-detail mode promotes a
 * positive hairline to one physical output pixel only when zoom would make it
 * thinner. Export geometry and interaction geometry continue using the
 * authored width.
 */
export function designCanvasDisplayStrokeWidth({
	authoredWidth,
	devicePixelRatio,
	renderer,
	worldScale,
}: DesignCanvasStrokeProjection): number {
	if (
		renderer !== "konva-preserved" ||
		!(authoredWidth > 0) ||
		!(worldScale > 0) ||
		!(devicePixelRatio > 0) ||
		!Number.isFinite(authoredWidth) ||
		!Number.isFinite(worldScale) ||
		!Number.isFinite(devicePixelRatio)
	)
		return authoredWidth
	return Math.max(
		authoredWidth,
		PRESERVED_KONVA_MINIMUM_STROKE_DEVICE_PIXELS /
			(worldScale * devicePixelRatio),
	)
}

export function normalizeDesignCanvasRenderer(
	value: unknown,
): DesignCanvasRendererId {
	return typeof value === "string" &&
		DESIGN_CANVAS_RENDERERS.some((renderer) => renderer.id === value)
		? (value as DesignCanvasRendererId)
		: DEFAULT_DESIGN_CANVAS_RENDERER
}

export function readDesignCanvasRenderer(
	storage: Pick<Storage, "getItem"> | null,
): DesignCanvasRendererId {
	if (storage === null) return DEFAULT_DESIGN_CANVAS_RENDERER
	try {
		return normalizeDesignCanvasRenderer(
			storage.getItem(DESIGN_CANVAS_RENDERER_STORAGE_KEY),
		)
	} catch {
		return DEFAULT_DESIGN_CANVAS_RENDERER
	}
}

export function writeDesignCanvasRenderer(
	storage: Pick<Storage, "setItem"> | null,
	renderer: DesignCanvasRendererId,
): boolean {
	if (storage === null) return false
	try {
		storage.setItem(DESIGN_CANVAS_RENDERER_STORAGE_KEY, renderer)
		return true
	} catch {
		return false
	}
}
