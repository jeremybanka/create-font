export const DESIGN_CANVAS_RENDERER_STORAGE_KEY =
	"create-design:canvas-renderer:v1"

export const DESIGN_CANVAS_RENDERERS = Object.freeze([
	Object.freeze({ id: "konva", label: "Konva (original)" }),
	Object.freeze({ id: "vello-hybrid", label: "Vello Hybrid (GPU)" }),
] as const)

export type DesignCanvasRendererId =
	(typeof DESIGN_CANVAS_RENDERERS)[number]["id"]

export const DEFAULT_DESIGN_CANVAS_RENDERER: DesignCanvasRendererId = "konva"

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
