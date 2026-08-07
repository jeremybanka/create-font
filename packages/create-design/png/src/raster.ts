import {
	designObjectFillRule,
	createDesignObjectGeometryHitTest,
	flattenDesignContour,
	objectStrokeDistance,
	projectDesignOutput,
	projectDesignObjectContours,
	resolvedRgb,
	visibleObjectBounds,
} from "@create-design/model"
import type { DesignDocument, DesignObject } from "@create-design/source"

import { encodeRgbaPng } from "./png-encoder.ts"
import type { PngRasterBackend } from "./types.ts"

function orderedObjects(document: DesignDocument): Readonly<{
	objects: readonly Readonly<{
		object: DesignObject
		masks: readonly ReturnType<typeof createDesignObjectGeometryHitTest>[]
	}>[]
	swatches: ReturnType<typeof projectDesignOutput>["swatches"]
}> {
	const projection = projectDesignOutput(document)
	const groups = new Map(document.groups.map((group) => [group.id, group]))
	const objects = new Map(document.objects.map((object) => [object.id, object]))
	const maskHitTests = new Map<
		string,
		ReturnType<typeof createDesignObjectGeometryHitTest>
	>()
	return {
		objects: projection.entries.map((entry) => ({
			object: entry.object,
			masks: entry.maskGroupIds.flatMap((groupId) => {
				const clippingPathId = groups.get(groupId)?.clippingPathId
				const mask =
					clippingPathId === undefined ? undefined : objects.get(clippingPathId)
				if (mask === undefined) return []
				const current = maskHitTests.get(mask.id)
				if (current !== undefined) return [current]
				const hitTest = createDesignObjectGeometryHitTest(mask)
				maskHitTests.set(mask.id, hitTest)
				return [hitTest]
			}),
		})),
		swatches: projection.swatches,
	}
}

function byte(value: number): number {
	return Math.max(0, Math.min(255, Math.round(value)))
}

function throwIfAborted(signal?: AbortSignal): void {
	if (signal?.aborted)
		throw new DOMException("PNG export was cancelled.", "AbortError")
}

function paintSpan(
	buffer: Uint8Array,
	superWidth: number,
	superHeight: number,
	artboard: Readonly<{ x: number; y: number; width: number; height: number }>,
	row: number,
	from: number,
	to: number,
	color: Readonly<{ r: number; g: number; b: number }>,
	masks: readonly ReturnType<typeof createDesignObjectGeometryHitTest>[],
): void {
	const start = Math.max(0, Math.ceil(from - 0.5))
	const end = Math.min(superWidth, Math.ceil(to - 0.5))
	for (let column = start; column < end; column += 1) {
		const point = {
			x: artboard.x + ((column + 0.5) / superWidth) * artboard.width,
			y: artboard.y + ((row + 0.5) / superHeight) * artboard.height,
		}
		if (!masks.every((mask) => mask.containsPoint(point))) continue
		const offset = (row * superWidth + column) * 4
		buffer[offset] = byte(color.r)
		buffer[offset + 1] = byte(color.g)
		buffer[offset + 2] = byte(color.b)
		buffer[offset + 3] = 255
	}
}

/**
 * Runtime-neutral reference backend. Artwork is clipped to the exact artboard,
 * sampled on a fixed n×n grid, and converted to 8-bit sRGB with half-up byte
 * rounding. Geometry and paint order are shared with SVG projection.
 */
export const referencePngRasterBackend: PngRasterBackend = {
	async rasterize(request, context) {
		const { artboard, background, height, samples, width } = request
		const projection = orderedObjects(context.document)
		const objects = projection.objects.map(({ masks, object }) => ({
			bounds: visibleObjectBounds(object),
			contours: projectDesignObjectContours(object).map((contour) =>
				flattenDesignContour(contour),
			),
			fillRule: designObjectFillRule(object),
			fill:
				object.appearance.fill === undefined
					? undefined
					: projection.swatches.find(
							({ id }) => id === object.appearance.fill?.swatchId,
						),
			object,
			masks,
			stroke:
				object.appearance.stroke === undefined
					? undefined
					: projection.swatches.find(
							({ id }) => id === object.appearance.stroke?.swatchId,
						),
		}))
		const superWidth = width * samples
		const superHeight = height * samples
		const sampled = new Uint8Array(superWidth * superHeight * 4)
		const bg =
			background.kind === "transparent"
				? { r: 0, g: 0, b: 0, a: 0 }
				: { ...background, a: background.a ?? 255 }
		for (let offset = 0; offset < sampled.length; offset += 4) {
			sampled[offset] = byte(bg.r)
			sampled[offset + 1] = byte(bg.g)
			sampled[offset + 2] = byte(bg.b)
			sampled[offset + 3] = byte(bg.a)
		}
		for (const projected of objects) {
			throwIfAborted(context.signal)
			const bounds = projected.bounds
			if (bounds === null) continue
			const startRow = Math.max(
				0,
				Math.floor(
					((bounds.minY - artboard.y) / artboard.height) * superHeight,
				),
			)
			const endRow = Math.min(
				superHeight,
				Math.ceil(((bounds.maxY - artboard.y) / artboard.height) * superHeight),
			)
			if (projected.fill !== undefined) {
				const color = resolvedRgb(projected.fill)
				for (let row = startRow; row < endRow; row += 1) {
					if (row > startRow && row % 32 === 0) await context.yieldControl()
					throwIfAborted(context.signal)
					const y = artboard.y + ((row + 0.5) / superHeight) * artboard.height
					const crossings: Array<Readonly<{ delta: number; x: number }>> = []
					for (const contour of projected.contours)
						for (let index = 0; index < contour.length; index += 1) {
							const from = contour[index]
							const to = contour[(index + 1) % contour.length]
							if (from === undefined || to === undefined || from.y === to.y)
								continue
							const minimum = Math.min(from.y, to.y)
							const maximum = Math.max(from.y, to.y)
							if (y < minimum || y >= maximum) continue
							crossings.push({
								delta: from.y < to.y ? 1 : -1,
								x: from.x + ((y - from.y) / (to.y - from.y)) * (to.x - from.x),
							})
						}
					crossings.sort(
						(left, right) => left.x - right.x || left.delta - right.delta,
					)
					let winding = 0
					let spanStart: number | null = null
					for (const crossing of crossings) {
						const wasInside =
							projected.fillRule === "evenodd"
								? Math.abs(winding) % 2 === 1
								: winding !== 0
						winding += crossing.delta
						const isInside =
							projected.fillRule === "evenodd"
								? Math.abs(winding) % 2 === 1
								: winding !== 0
						if (!wasInside && isInside) spanStart = crossing.x
						else if (wasInside && !isInside && spanStart !== null) {
							paintSpan(
								sampled,
								superWidth,
								superHeight,
								artboard,
								row,
								((spanStart - artboard.x) / artboard.width) * superWidth,
								((crossing.x - artboard.x) / artboard.width) * superWidth,
								color,
								projected.masks,
							)
							spanStart = null
						}
					}
				}
			}
			if (projected.stroke !== undefined) {
				const color = resolvedRgb(projected.stroke)
				const startColumn = Math.max(
					0,
					Math.floor(
						((bounds.minX - artboard.x) / artboard.width) * superWidth,
					),
				)
				const endColumn = Math.min(
					superWidth,
					Math.ceil(((bounds.maxX - artboard.x) / artboard.width) * superWidth),
				)
				for (let row = startRow; row < endRow; row += 1) {
					if (row > startRow && row % 8 === 0) await context.yieldControl()
					for (let column = startColumn; column < endColumn; column += 1) {
						const point = {
							x: artboard.x + ((column + 0.5) / superWidth) * artboard.width,
							y: artboard.y + ((row + 0.5) / superHeight) * artboard.height,
						}
						if (!projected.masks.every((mask) => mask.containsPoint(point)))
							continue
						if (objectStrokeDistance(projected.object, point) > 1e-7) continue
						const offset = (row * superWidth + column) * 4
						sampled[offset] = byte(color.r)
						sampled[offset + 1] = byte(color.g)
						sampled[offset + 2] = byte(color.b)
						sampled[offset + 3] = 255
					}
				}
			}
		}
		const rgba = new Uint8Array(width * height * 4)
		const sampleCount = samples * samples
		for (let row = 0; row < height; row += 1) {
			if (row > 0 && row % 16 === 0) await context.yieldControl()
			for (let column = 0; column < width; column += 1) {
				let red = 0
				let green = 0
				let blue = 0
				let alpha = 0
				for (let sampleY = 0; sampleY < samples; sampleY += 1)
					for (let sampleX = 0; sampleX < samples; sampleX += 1) {
						const sampleOffset =
							((row * samples + sampleY) * superWidth +
								column * samples +
								sampleX) *
							4
						const sampleRed = sampled[sampleOffset]!
						const sampleGreen = sampled[sampleOffset + 1]!
						const sampleBlue = sampled[sampleOffset + 2]!
						const sampleAlpha = sampled[sampleOffset + 3]!
						red += sampleRed * (sampleAlpha / 255)
						green += sampleGreen * (sampleAlpha / 255)
						blue += sampleBlue * (sampleAlpha / 255)
						alpha += sampleAlpha
					}
				const offset = (row * width + column) * 4
				const averagedAlpha = alpha / sampleCount
				rgba[offset] =
					averagedAlpha === 0
						? 0
						: byte(((red / sampleCount) * 255) / averagedAlpha)
				rgba[offset + 1] =
					averagedAlpha === 0
						? 0
						: byte(((green / sampleCount) * 255) / averagedAlpha)
				rgba[offset + 2] =
					averagedAlpha === 0
						? 0
						: byte(((blue / sampleCount) * 255) / averagedAlpha)
				rgba[offset + 3] = byte(averagedAlpha)
			}
		}
		throwIfAborted(context.signal)
		return encodeRgbaPng(width, height, rgba)
	},
}
