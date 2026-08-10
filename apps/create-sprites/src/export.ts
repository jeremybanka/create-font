import { compositeFrame, TRANSPARENT_PIXEL, type SpriteProject } from "./model.ts"

function download(blob: Blob, name: string): void {
	const anchor = document.createElement("a")
	const url = URL.createObjectURL(blob)
	anchor.href = url
	anchor.download = name
	anchor.click()
	setTimeout(() => URL.revokeObjectURL(url), 0)
}

function safeName(title: string): string {
	return title.trim().toLowerCase().replaceAll(/[^a-z0-9]+/g, "-").replaceAll(/(^-|-$)/g, "") || "sprite"
}

function canvasFromRgba(width: number, height: number, rgba: Uint8ClampedArray, scale: number): HTMLCanvasElement {
	const source = document.createElement("canvas")
	source.width = width
	source.height = height
	const sourceContext = source.getContext("2d")
	if (sourceContext === null) throw new Error(`Canvas 2D is unavailable.`)
	sourceContext.putImageData(new ImageData(new Uint8ClampedArray(rgba), width, height), 0, 0)
	if (scale === 1) return source
	const output = document.createElement("canvas")
	output.width = width * scale
	output.height = height * scale
	const context = output.getContext("2d")
	if (context === null) throw new Error(`Canvas 2D is unavailable.`)
	context.imageSmoothingEnabled = false
	context.drawImage(source, 0, 0, output.width, output.height)
	return output
}

async function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob> {
	return await new Promise<Blob>((accept, reject) => canvas.toBlob((blob) => blob === null ? reject(new Error(`PNG encoding failed.`)) : accept(blob), "image/png"))
}

export async function exportFramePng(project: SpriteProject, frameId: string, scale: number): Promise<void> {
	const frameIndex = project.frames.findIndex((frame) => frame.id === frameId)
	const canvas = canvasFromRgba(project.width, project.height, compositeFrame(project, frameId), scale)
	download(await canvasBlob(canvas), `${safeName(project.title)}-${String(frameIndex + 1).padStart(2, "0")}.png`)
}

export async function exportSpriteSheet(project: SpriteProject, scale: number, columns: number): Promise<void> {
	const safeColumns = Math.max(1, Math.min(columns, project.frames.length))
	const rows = Math.ceil(project.frames.length / safeColumns)
	const canvas = document.createElement("canvas")
	canvas.width = project.width * safeColumns * scale
	canvas.height = project.height * rows * scale
	const context = canvas.getContext("2d")
	if (context === null) throw new Error(`Canvas 2D is unavailable.`)
	context.imageSmoothingEnabled = false
	for (let index = 0; index < project.frames.length; index += 1) {
		const frame = project.frames[index]
		if (frame === undefined) continue
		const source = canvasFromRgba(project.width, project.height, compositeFrame(project, frame.id), 1)
		context.drawImage(source, (index % safeColumns) * project.width * scale, Math.floor(index / safeColumns) * project.height * scale, project.width * scale, project.height * scale)
	}
	const name = safeName(project.title)
	download(await canvasBlob(canvas), `${name}-sheet.png`)
	const metadata = {
		format: "create-sprites.sheet",
		image: `${name}-sheet.png`,
		size: { width: canvas.width, height: canvas.height },
		frames: project.frames.map((frame, index) => ({
			id: frame.id,
			name: frame.name,
			duration: frame.duration,
			x: (index % safeColumns) * project.width * scale,
			y: Math.floor(index / safeColumns) * project.height * scale,
			width: project.width * scale,
			height: project.height * scale,
		})),
		tags: project.tags,
	}
	download(new Blob([`${JSON.stringify(metadata, null, "\t")}\n`], { type: "application/json" }), `${name}-sheet.json`)
}

export function exportProjectJson(project: SpriteProject): void {
	download(new Blob([`${JSON.stringify(project, null, "\t")}\n`], { type: "application/json" }), `${safeName(project.title)}.create-sprites.json`)
}

function rgbaChannels(value: string): readonly [number, number, number, number] {
	return [Number.parseInt(value.slice(1, 3), 16), Number.parseInt(value.slice(3, 5), 16), Number.parseInt(value.slice(5, 7), 16), Number.parseInt(value.slice(7, 9), 16)]
}

export async function importPngToPalette(file: File, project: SpriteProject): Promise<Uint8Array> {
	const bitmap = await createImageBitmap(file)
	const canvas = document.createElement("canvas")
	canvas.width = project.width
	canvas.height = project.height
	const context = canvas.getContext("2d", { willReadFrequently: true })
	if (context === null) throw new Error(`Canvas 2D is unavailable.`)
	context.imageSmoothingEnabled = false
	context.drawImage(bitmap, 0, 0, project.width, project.height)
	bitmap.close()
	const data = context.getImageData(0, 0, project.width, project.height).data
	const palette = project.palette.map((color) => rgbaChannels(color.value))
	const pixels = new Uint8Array(project.width * project.height)
	for (let index = 0; index < pixels.length; index += 1) {
		const offset = index * 4
		if ((data[offset + 3] ?? 0) < 48) { pixels[index] = TRANSPARENT_PIXEL; continue }
		let nearest = 0
		let distance = Number.POSITIVE_INFINITY
		for (let paletteIndex = 0; paletteIndex < palette.length; paletteIndex += 1) {
			const color = palette[paletteIndex]
			if (color === undefined) continue
			const nextDistance = ((data[offset] ?? 0) - color[0]) ** 2 + ((data[offset + 1] ?? 0) - color[1]) ** 2 + ((data[offset + 2] ?? 0) - color[2]) ** 2 + (((data[offset + 3] ?? 0) - color[3]) * 0.5) ** 2
			if (nextDistance < distance) { distance = nextDistance; nearest = paletteIndex }
		}
		pixels[index] = nearest
	}
	return pixels
}
