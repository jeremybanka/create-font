import type {
	Canvas,
	CanvasKit,
	Paint,
	Path,
	SkPicture,
	Surface,
} from "canvaskit-wasm"

import type {
	DesignPreviewFrame,
	DesignPreviewRendererBackend,
} from "./design-preview-renderer.ts"
import type {
	DesignPreviewPath,
	DesignPreviewScene,
} from "./design-preview-scene.ts"

export const CANVASKIT_MINIMUM_STROKE_DEVICE_PIXELS = 1

/**
 * Project an authored world-space stroke width to CanvasKit's retained picture.
 * The adjustment is preview-only: document, export, and hit geometry continue to
 * use the authored width from DesignPreviewScene.
 */
export function canvasKitPreviewStrokeWidth(
	authoredWidth: number,
	viewScale: number,
	pixelRatio: number,
): number {
	const deviceScale = viewScale * pixelRatio
	if (!(deviceScale > 0) || !Number.isFinite(deviceScale)) return authoredWidth
	return Math.max(
		authoredWidth,
		CANVASKIT_MINIMUM_STROKE_DEVICE_PIXELS / deviceScale,
	)
}

/**
 * A picture only needs recompiling when scene content or an effective stroke
 * width changes. View translation is deliberately excluded, as are zoom/DPR
 * changes while every stroke remains above the coverage floor.
 */
export function canvasKitPictureRevision(frame: DesignPreviewFrame): string {
	const adjustedStrokeWidths = frame.scene.paths.flatMap((path) => {
		const stroke = path.stroke
		if (stroke === undefined) return []
		const width = canvasKitPreviewStrokeWidth(
			stroke.width,
			frame.view.scale,
			frame.viewport.pixelRatio,
		)
		return width === stroke.width ? [] : [[path.id, width] as const]
	})
	return adjustedStrokeWidths.length === 0
		? frame.scene.revision
		: `${frame.scene.revision}\u0000stroke-floor:${JSON.stringify(adjustedStrokeWidths)}`
}

function configureFill(canvasKit: CanvasKit, color: string): Paint {
	const paint = new canvasKit.Paint()
	paint.setAntiAlias(true)
	paint.setStyle(canvasKit.PaintStyle.Fill)
	paint.setColor(canvasKit.parseColorString(color))
	return paint
}

function configureStroke(
	canvasKit: CanvasKit,
	path: DesignPreviewPath,
	viewScale: number,
	pixelRatio: number,
): Readonly<{ paint: Paint; disposeEffect: () => void }> | null {
	const stroke = path.stroke
	if (stroke === undefined) return null
	const paint = new canvasKit.Paint()
	paint.setAntiAlias(true)
	paint.setStyle(canvasKit.PaintStyle.Stroke)
	paint.setColor(canvasKit.parseColorString(stroke.color))
	paint.setStrokeWidth(
		canvasKitPreviewStrokeWidth(stroke.width, viewScale, pixelRatio),
	)
	paint.setStrokeMiter(stroke.miterLimit)
	paint.setStrokeCap(
		stroke.cap === "round"
			? canvasKit.StrokeCap.Round
			: stroke.cap === "square"
				? canvasKit.StrokeCap.Square
				: canvasKit.StrokeCap.Butt,
	)
	paint.setStrokeJoin(
		stroke.join === "round"
			? canvasKit.StrokeJoin.Round
			: stroke.join === "bevel"
				? canvasKit.StrokeJoin.Bevel
				: canvasKit.StrokeJoin.Miter,
	)
	if (stroke.dashArray.length === 0)
		return { paint, disposeEffect: () => undefined }
	const effect = canvasKit.PathEffect.MakeDash(
		[...stroke.dashArray],
		stroke.dashOffset,
	)
	paint.setPathEffect(effect)
	return {
		paint,
		disposeEffect: () => effect?.delete(),
	}
}

function drawPreviewPath(
	canvasKit: CanvasKit,
	canvas: Canvas,
	command: DesignPreviewPath,
	viewScale: number,
	pixelRatio: number,
): void {
	const path: Path | null = canvasKit.Path.MakeFromSVGString(command.pathData)
	if (path === null)
		throw new Error(`Skia could not parse the path for ${command.id}.`)
	path.setFillType(
		command.fillRule === "evenodd"
			? canvasKit.FillType.EvenOdd
			: canvasKit.FillType.Winding,
	)
	try {
		if (command.fill !== undefined) {
			const fill = configureFill(canvasKit, command.fill.color)
			try {
				canvas.drawPath(path, fill)
			} finally {
				fill.delete()
			}
		}
		const configuredStroke = configureStroke(
			canvasKit,
			command,
			viewScale,
			pixelRatio,
		)
		if (configuredStroke !== null)
			try {
				canvas.drawPath(path, configuredStroke.paint)
			} finally {
				configuredStroke.paint.delete()
				configuredStroke.disposeEffect()
			}
	} finally {
		path.delete()
	}
}

function recordScene(
	canvasKit: CanvasKit,
	frame: DesignPreviewFrame,
): SkPicture {
	const { scene } = frame
	const recorder = new canvasKit.PictureRecorder()
	try {
		// The document plane is intentionally generous: artwork may live outside an
		// artboard, and the picture is compiled only when scene.revision changes.
		const canvas = recorder.beginRecording(
			canvasKit.LTRBRect(-10_000_000, -10_000_000, 10_000_000, 10_000_000),
		)
		for (const artboard of scene.artboards) {
			if (artboard.background === undefined) continue
			const paint = configureFill(canvasKit, artboard.background)
			try {
				canvas.drawRect(
					canvasKit.XYWHRect(
						artboard.x,
						artboard.y,
						artboard.width,
						artboard.height,
					),
					paint,
				)
			} finally {
				paint.delete()
			}
		}
		for (const path of scene.paths)
			drawPreviewPath(
				canvasKit,
				canvas,
				path,
				frame.view.scale,
				frame.viewport.pixelRatio,
			)
		return recorder.finishRecordingAsPicture()
	} finally {
		recorder.delete()
	}
}

export class CanvasKitPreviewBackend implements DesignPreviewRendererBackend {
	readonly #canvasKit: CanvasKit
	#canvas: HTMLCanvasElement | null = null
	#surface: Surface | null = null
	#picture: SkPicture | null = null
	#pictureRevision: string | null = null
	#pixelWidth = 0
	#pixelHeight = 0

	constructor(canvasKit: CanvasKit) {
		this.#canvasKit = canvasKit
	}

	mount(canvas: HTMLCanvasElement): void {
		this.#canvas = canvas
	}

	#ensureSurface(frame: DesignPreviewFrame): Surface {
		const canvas = this.#canvas
		if (canvas === null) throw new Error("CanvasKit has no canvas surface.")
		const pixelWidth = Math.max(
			1,
			Math.round(frame.viewport.width * frame.viewport.pixelRatio),
		)
		const pixelHeight = Math.max(
			1,
			Math.round(frame.viewport.height * frame.viewport.pixelRatio),
		)
		if (
			this.#surface !== null &&
			pixelWidth === this.#pixelWidth &&
			pixelHeight === this.#pixelHeight
		)
			return this.#surface
		this.#surface?.delete()
		this.#surface = null
		canvas.width = pixelWidth
		canvas.height = pixelHeight
		this.#pixelWidth = pixelWidth
		this.#pixelHeight = pixelHeight
		this.#surface = this.#canvasKit.MakeWebGLCanvasSurface(canvas)
		if (this.#surface === null)
			throw new Error("Skia could not create a WebGL canvas surface.")
		return this.#surface
	}

	render(frame: DesignPreviewFrame): void {
		const surface = this.#ensureSurface(frame)
		const pictureRevision = canvasKitPictureRevision(frame)
		if (this.#pictureRevision !== pictureRevision) {
			const nextPicture = recordScene(this.#canvasKit, frame)
			this.#picture?.delete()
			this.#picture = nextPicture
			this.#pictureRevision = pictureRevision
		}
		const picture = this.#picture
		if (picture === null) return
		const canvas = surface.getCanvas()
		canvas.clear(this.#canvasKit.TRANSPARENT)
		canvas.save()
		canvas.scale(frame.viewport.pixelRatio, frame.viewport.pixelRatio)
		canvas.translate(frame.view.x, frame.view.y)
		canvas.scale(frame.view.scale, frame.view.scale)
		canvas.drawPicture(picture)
		canvas.restore()
		surface.flush()
	}

	dispose(): void {
		this.#picture?.delete()
		this.#surface?.delete()
		this.#picture = null
		this.#surface = null
		this.#canvas = null
		this.#pictureRevision = null
	}
}

export async function createCanvasKitPreviewBackend(): Promise<CanvasKitPreviewBackend> {
	const [{ default: initializeCanvasKit }, { default: wasmUrl }] =
		await Promise.all([
			import("canvaskit-wasm"),
			import("canvaskit-wasm/bin/canvaskit.wasm?url&no-inline"),
		])
	const canvasKit = await initializeCanvasKit({ locateFile: () => wasmUrl })
	return new CanvasKitPreviewBackend(canvasKit)
}
