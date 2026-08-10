export const SPRITE_PROJECT_FORMAT = "create-sprites.project" as const
export const SPRITE_PROJECT_VERSION = 1 as const
export const TRANSPARENT_PIXEL = 255
export const PALETTE_ALPHABET =
	"0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_"

export type SpriteTool =
	| "pencil"
	| "eraser"
	| "fill"
	| "line"
	| "rectangle"
	| "eyedropper"

export type SpritePlaybackDirection = "forward" | "reverse" | "ping-pong"

export interface SpriteColor {
	readonly id: string
	readonly name: string
	/** Eight-digit sRGB hex: `#RRGGBBAA`. */
	readonly value: string
}

export interface SpriteLayer {
	readonly id: string
	readonly name: string
	readonly visible: boolean
	readonly locked: boolean
	readonly opacity: number
}

export interface SpriteFrame {
	readonly id: string
	readonly name: string
	readonly duration: number
}

export interface SpriteCel {
	readonly frameId: string
	readonly layerId: string
	/** One palette character per pixel; `.` is transparent. */
	readonly rows: readonly string[]
}

export interface SpriteTag {
	readonly id: string
	readonly name: string
	readonly fromFrameId: string
	readonly toFrameId: string
	readonly direction: SpritePlaybackDirection
}

export interface SpriteProject {
	readonly format: typeof SPRITE_PROJECT_FORMAT
	readonly version: typeof SPRITE_PROJECT_VERSION
	readonly title: string
	readonly width: number
	readonly height: number
	readonly palette: readonly SpriteColor[]
	readonly layers: readonly SpriteLayer[]
	readonly frames: readonly SpriteFrame[]
	readonly cels: readonly SpriteCel[]
	readonly tags: readonly SpriteTag[]
}

export interface SpritePoint {
	readonly x: number
	readonly y: number
}

const DEFAULT_PALETTE = [
	["ink", "Ink", "#17141fff"],
	["aubergine", "Aubergine", "#4a2f45ff"],
	["brick", "Brick", "#8f3f45ff"],
	["ember", "Ember", "#d46a4cff"],
	["sun", "Sun", "#f6c75cff"],
	["cream", "Cream", "#f4e9c9ff"],
	["moss", "Moss", "#5c7b55ff"],
	["mint", "Mint", "#91c788ff"],
	["deep-sea", "Deep Sea", "#24566cff"],
	["sky", "Sky", "#4c96b8ff"],
	["bluebell", "Bluebell", "#7a80caff"],
	["lilac", "Lilac", "#b39bd0ff"],
	["clay", "Clay", "#b47b65ff"],
	["sand", "Sand", "#d9b382ff"],
	["slate", "Slate", "#6c7078ff"],
	["mist", "Mist", "#b8bdc4ff"],
] as const

function assertInteger(value: unknown, label: string, minimum: number, maximum: number): asserts value is number {
	if (!Number.isInteger(value) || Number(value) < minimum || Number(value) > maximum)
		throw new Error(`${label} must be an integer from ${minimum} through ${maximum}.`)
}

function assertId(value: unknown, label: string): asserts value is string {
	if (typeof value !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(value))
		throw new Error(`${label} must be a filesystem-safe identifier.`)
}

function assertHexColor(value: unknown, label: string): asserts value is string {
	if (typeof value !== "string" || !/^#[0-9a-fA-F]{8}$/.test(value))
		throw new Error(`${label} must use #RRGGBBAA syntax.`)
}

function uniqueIds(items: readonly { readonly id: string }[], label: string): void {
	const seen = new Set<string>()
	for (const item of items) {
		if (seen.has(item.id)) throw new Error(`${label} contains duplicate id ${item.id}.`)
		seen.add(item.id)
	}
}

export function blankRows(width: number, height: number): readonly string[] {
	return Array.from({ length: height }, () => ".".repeat(width))
}

export function createSpriteProject(
	title = "Untitled sprite",
	width = 32,
	height = 32,
): SpriteProject {
	assertInteger(width, "Sprite width", 1, 256)
	assertInteger(height, "Sprite height", 1, 256)
	return {
		format: SPRITE_PROJECT_FORMAT,
		version: SPRITE_PROJECT_VERSION,
		title,
		width,
		height,
		palette: DEFAULT_PALETTE.map(([id, name, value]) => ({ id, name, value })),
		layers: [
			{ id: "art", name: "Art", visible: true, locked: false, opacity: 1 },
		],
		frames: [{ id: "frame-1", name: "Frame 1", duration: 120 }],
		cels: [{ frameId: "frame-1", layerId: "art", rows: blankRows(width, height) }],
		tags: [],
	}
}

export function decodeRows(
	rows: readonly string[],
	width: number,
	height: number,
	paletteSize = PALETTE_ALPHABET.length,
): Uint8Array {
	if (rows.length !== height) throw new Error(`Cel must contain ${height} rows.`)
	const pixels = new Uint8Array(width * height)
	for (let y = 0; y < height; y += 1) {
		const row = rows[y]
		if (row === undefined || row.length !== width)
			throw new Error(`Cel row ${y + 1} must contain ${width} pixels.`)
		for (let x = 0; x < width; x += 1) {
			const symbol = row[x]
			if (symbol === ".") pixels[y * width + x] = TRANSPARENT_PIXEL
			else {
				const index = PALETTE_ALPHABET.indexOf(symbol ?? "")
				if (index < 0 || index >= paletteSize)
					throw new Error(`Cel uses unavailable palette symbol ${symbol}.`)
				pixels[y * width + x] = index
			}
		}
	}
	return pixels
}

export function encodeRows(
	pixels: Uint8Array | readonly number[],
	width: number,
	height: number,
): readonly string[] {
	if (pixels.length !== width * height)
		throw new Error(`Pixel buffer must contain ${width * height} entries.`)
	const rows: string[] = []
	for (let y = 0; y < height; y += 1) {
		let row = ""
		for (let x = 0; x < width; x += 1) {
			const value = pixels[y * width + x]
			if (value === TRANSPARENT_PIXEL) row += "."
			else {
				const symbol = PALETTE_ALPHABET[value ?? -1]
				if (symbol === undefined) throw new Error(`Palette index ${value} cannot be encoded.`)
				row += symbol
			}
		}
		rows.push(row)
	}
	return rows
}

export function normalizeSpriteProject(value: unknown): SpriteProject {
	if (typeof value !== "object" || value === null) throw new Error("Sprite project must be an object.")
	const project = value as Partial<SpriteProject>
	if (project.format !== SPRITE_PROJECT_FORMAT) throw new Error(`Unsupported sprite project format.`)
	if (project.version !== SPRITE_PROJECT_VERSION) throw new Error(`Unsupported sprite project version.`)
	if (typeof project.title !== "string" || project.title.trim().length === 0)
		throw new Error(`Sprite title must not be empty.`)
	assertInteger(project.width, "Sprite width", 1, 256)
	assertInteger(project.height, "Sprite height", 1, 256)
	if (!Array.isArray(project.palette) || project.palette.length < 1 || project.palette.length > PALETTE_ALPHABET.length)
		throw new Error(`Palette must contain 1 through ${PALETTE_ALPHABET.length} colors.`)
	const palette = project.palette.map((entry, index): SpriteColor => {
		if (typeof entry !== "object" || entry === null) throw new Error(`Palette entry ${index + 1} must be an object.`)
		const color = entry as Partial<SpriteColor>
		assertId(color.id, `Palette entry ${index + 1} id`)
		if (typeof color.name !== "string" || color.name.trim().length === 0) throw new Error(`Palette entry ${index + 1} needs a name.`)
		assertHexColor(color.value, `Palette entry ${index + 1}`)
		return { id: color.id, name: color.name, value: color.value.toLowerCase() }
	})
	uniqueIds(palette, "Palette")
	if (!Array.isArray(project.layers) || project.layers.length < 1) throw new Error(`Sprite needs at least one layer.`)
	const layers = project.layers.map((entry, index): SpriteLayer => {
		if (typeof entry !== "object" || entry === null) throw new Error(`Layer ${index + 1} must be an object.`)
		const layer = entry as Partial<SpriteLayer>
		assertId(layer.id, `Layer ${index + 1} id`)
		if (typeof layer.name !== "string" || layer.name.trim().length === 0) throw new Error(`Layer ${index + 1} needs a name.`)
		if (typeof layer.visible !== "boolean" || typeof layer.locked !== "boolean") throw new Error(`Layer ${index + 1} visibility and lock state are required.`)
		if (typeof layer.opacity !== "number" || !Number.isFinite(layer.opacity) || layer.opacity < 0 || layer.opacity > 1) throw new Error(`Layer ${index + 1} opacity must be from 0 through 1.`)
		return { id: layer.id, name: layer.name, visible: layer.visible, locked: layer.locked, opacity: layer.opacity }
	})
	uniqueIds(layers, "Layers")
	if (!Array.isArray(project.frames) || project.frames.length < 1) throw new Error(`Sprite needs at least one frame.`)
	const frames = project.frames.map((entry, index): SpriteFrame => {
		if (typeof entry !== "object" || entry === null) throw new Error(`Frame ${index + 1} must be an object.`)
		const frame = entry as Partial<SpriteFrame>
		assertId(frame.id, `Frame ${index + 1} id`)
		if (typeof frame.name !== "string" || frame.name.trim().length === 0) throw new Error(`Frame ${index + 1} needs a name.`)
		assertInteger(frame.duration, `Frame ${index + 1} duration`, 16, 60_000)
		return { id: frame.id, name: frame.name, duration: frame.duration }
	})
	uniqueIds(frames, "Frames")
	if (!Array.isArray(project.cels)) throw new Error(`Sprite cels must be an array.`)
	const layerIds = new Set(layers.map(({ id }) => id))
	const frameIds = new Set(frames.map(({ id }) => id))
	const celKeys = new Set<string>()
	const cels = project.cels.map((entry, index): SpriteCel => {
		if (typeof entry !== "object" || entry === null) throw new Error(`Cel ${index + 1} must be an object.`)
		const cel = entry as Partial<SpriteCel>
		assertId(cel.layerId, `Cel ${index + 1} layer`)
		assertId(cel.frameId, `Cel ${index + 1} frame`)
		if (!layerIds.has(cel.layerId) || !frameIds.has(cel.frameId)) throw new Error(`Cel ${index + 1} references an unknown frame or layer.`)
		const key = `${cel.frameId}/${cel.layerId}`
		if (celKeys.has(key)) throw new Error(`Duplicate cel ${key}.`)
		celKeys.add(key)
		if (!Array.isArray(cel.rows) || cel.rows.some((row) => typeof row !== "string")) throw new Error(`Cel ${index + 1} rows must be strings.`)
		decodeRows(cel.rows as string[], project.width!, project.height!, palette.length)
		return { frameId: cel.frameId, layerId: cel.layerId, rows: [...cel.rows] as string[] }
	})
	if (!Array.isArray(project.tags)) throw new Error(`Sprite tags must be an array.`)
	const tags = project.tags.map((entry, index): SpriteTag => {
		if (typeof entry !== "object" || entry === null) throw new Error(`Tag ${index + 1} must be an object.`)
		const tag = entry as Partial<SpriteTag>
		assertId(tag.id, `Tag ${index + 1} id`)
		if (typeof tag.name !== "string" || tag.name.trim().length === 0) throw new Error(`Tag ${index + 1} needs a name.`)
		assertId(tag.fromFrameId, `Tag ${index + 1} start frame`)
		assertId(tag.toFrameId, `Tag ${index + 1} end frame`)
		if (!frameIds.has(tag.fromFrameId) || !frameIds.has(tag.toFrameId)) throw new Error(`Tag ${index + 1} references an unknown frame.`)
		if (tag.direction !== "forward" && tag.direction !== "reverse" && tag.direction !== "ping-pong") throw new Error(`Tag ${index + 1} has an invalid direction.`)
		return { id: tag.id, name: tag.name, fromFrameId: tag.fromFrameId, toFrameId: tag.toFrameId, direction: tag.direction }
	})
	uniqueIds(tags, "Tags")
	return { format: SPRITE_PROJECT_FORMAT, version: SPRITE_PROJECT_VERSION, title: project.title, width: project.width, height: project.height, palette, layers, frames, cels, tags }
}

export function celKey(frameId: string, layerId: string): string {
	return `${frameId}/${layerId}`
}

export function celPixels(project: SpriteProject, frameId: string, layerId: string): Uint8Array {
	const cel = project.cels.find((entry) => entry.frameId === frameId && entry.layerId === layerId)
	return cel === undefined
		? new Uint8Array(project.width * project.height).fill(TRANSPARENT_PIXEL)
		: decodeRows(cel.rows, project.width, project.height, project.palette.length)
}

export function setCelPixels(project: SpriteProject, frameId: string, layerId: string, pixels: Uint8Array): SpriteProject {
	const next: SpriteCel = { frameId, layerId, rows: encodeRows(pixels, project.width, project.height) }
	const index = project.cels.findIndex((cel) => cel.frameId === frameId && cel.layerId === layerId)
	return {
		...project,
		cels: index < 0 ? [...project.cels, next] : project.cels.map((cel, celIndex) => celIndex === index ? next : cel),
	}
}

export function linePoints(from: SpritePoint, to: SpritePoint): readonly SpritePoint[] {
	const points: SpritePoint[] = []
	let x = from.x
	let y = from.y
	const dx = Math.abs(to.x - from.x)
	const sx = from.x < to.x ? 1 : -1
	const dy = -Math.abs(to.y - from.y)
	const sy = from.y < to.y ? 1 : -1
	let error = dx + dy
	while (true) {
		points.push({ x, y })
		if (x === to.x && y === to.y) break
		const twice = error * 2
		if (twice >= dy) { error += dy; x += sx }
		if (twice <= dx) { error += dx; y += sy }
	}
	return points
}

export function rectanglePoints(from: SpritePoint, to: SpritePoint, filled = false): readonly SpritePoint[] {
	const minX = Math.min(from.x, to.x)
	const maxX = Math.max(from.x, to.x)
	const minY = Math.min(from.y, to.y)
	const maxY = Math.max(from.y, to.y)
	const points: SpritePoint[] = []
	for (let y = minY; y <= maxY; y += 1) {
		for (let x = minX; x <= maxX; x += 1) {
			if (filled || x === minX || x === maxX || y === minY || y === maxY) points.push({ x, y })
		}
	}
	return points
}

export function paintPoints(
	pixels: Uint8Array,
	width: number,
	height: number,
	points: readonly SpritePoint[],
	value: number,
	brushSize = 1,
	symmetryX = false,
	symmetryY = false,
): Uint8Array {
	const next = pixels.slice()
	const half = Math.floor((brushSize - 1) / 2)
	const paint = (x: number, y: number): void => {
		for (let offsetY = 0; offsetY < brushSize; offsetY += 1) {
			for (let offsetX = 0; offsetX < brushSize; offsetX += 1) {
				const pixelX = x + offsetX - half
				const pixelY = y + offsetY - half
				if (pixelX >= 0 && pixelY >= 0 && pixelX < width && pixelY < height) next[pixelY * width + pixelX] = value
			}
		}
	}
	for (const point of points) {
		const xs = symmetryX ? [point.x, width - 1 - point.x] : [point.x]
		const ys = symmetryY ? [point.y, height - 1 - point.y] : [point.y]
		for (const x of new Set(xs)) for (const y of new Set(ys)) paint(x, y)
	}
	return next
}

export function floodFill(
	pixels: Uint8Array,
	width: number,
	height: number,
	start: SpritePoint,
	value: number,
): Uint8Array {
	if (start.x < 0 || start.y < 0 || start.x >= width || start.y >= height) return pixels
	const target = pixels[start.y * width + start.x]
	if (target === value) return pixels
	const next = pixels.slice()
	const queue: number[] = [start.y * width + start.x]
	next[start.y * width + start.x] = value
	for (let cursor = 0; cursor < queue.length; cursor += 1) {
		const index = queue[cursor] ?? 0
		const x = index % width
		const y = Math.floor(index / width)
		for (const neighbor of [x > 0 ? index - 1 : -1, x + 1 < width ? index + 1 : -1, y > 0 ? index - width : -1, y + 1 < height ? index + width : -1]) {
			if (neighbor >= 0 && next[neighbor] === target) { next[neighbor] = value; queue.push(neighbor) }
		}
	}
	return next
}

function colorChannels(value: string): readonly [number, number, number, number] {
	return [
		Number.parseInt(value.slice(1, 3), 16),
		Number.parseInt(value.slice(3, 5), 16),
		Number.parseInt(value.slice(5, 7), 16),
		Number.parseInt(value.slice(7, 9), 16),
	]
}

export function compositeFrame(project: SpriteProject, frameId: string): Uint8ClampedArray {
	const output = new Uint8ClampedArray(project.width * project.height * 4)
	for (const layer of project.layers) {
		if (!layer.visible || layer.opacity <= 0) continue
		const pixels = celPixels(project, frameId, layer.id)
		for (let index = 0; index < pixels.length; index += 1) {
			const paletteIndex = pixels[index]
			if (paletteIndex === undefined || paletteIndex === TRANSPARENT_PIXEL) continue
			const color = project.palette[paletteIndex]
			if (color === undefined) continue
			const [red, green, blue, alphaByte] = colorChannels(color.value)
			const sourceAlpha = (alphaByte / 255) * layer.opacity
			const offset = index * 4
			const destinationAlpha = (output[offset + 3] ?? 0) / 255
			const alpha = sourceAlpha + destinationAlpha * (1 - sourceAlpha)
			if (alpha <= 0) continue
			output[offset] = Math.round((red * sourceAlpha + (output[offset] ?? 0) * destinationAlpha * (1 - sourceAlpha)) / alpha)
			output[offset + 1] = Math.round((green * sourceAlpha + (output[offset + 1] ?? 0) * destinationAlpha * (1 - sourceAlpha)) / alpha)
			output[offset + 2] = Math.round((blue * sourceAlpha + (output[offset + 2] ?? 0) * destinationAlpha * (1 - sourceAlpha)) / alpha)
			output[offset + 3] = Math.round(alpha * 255)
		}
	}
	return output
}

export function nextIdentifier(prefix: string, ids: readonly string[]): string {
	const used = new Set(ids)
	let sequence = 1
	while (used.has(`${prefix}-${sequence}`)) sequence += 1
	return `${prefix}-${sequence}`
}
