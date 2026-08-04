import {
	createFontService,
	type FontDiagnostic,
	type FontIdentity,
	type FontService,
	type OutlineCommand,
	type ShapedText,
} from "@create-font/font-service"
import type {
	DesignContour,
	DesignFontReference,
	DesignObject,
	DesignPoint,
	DesignTextGeometry,
} from "@create-design/source"

import type {
	DesignTextDiagnostic,
	DesignTextGlyph,
	DesignTextLayout,
	DesignTextLine,
	DesignTextService,
	ExpandedText,
} from "./types.ts"

const frozen = <Value>(value: Value): Readonly<Value> => Object.freeze(value)

function diagnostic(
	objectId: string,
	value: FontDiagnostic,
): DesignTextDiagnostic {
	return frozen({
		code: value.code,
		severity: value.severity,
		message: value.message,
		objectId,
		...(value.textIndex === undefined ? {} : { textIndex: value.textIndex }),
	})
}

function textDiagnostic(
	objectId: string,
	code: DesignTextDiagnostic["code"],
	message: string,
	severity: DesignTextDiagnostic["severity"] = "error",
): DesignTextDiagnostic {
	return frozen({ code, message, objectId, severity })
}

function point(
	id: string,
	x: number,
	y: number,
	incoming?: Readonly<{ x: number; y: number }>,
	outgoing?: Readonly<{ x: number; y: number }>,
): DesignPoint {
	return frozen({
		id,
		x,
		y,
		...(incoming === undefined ? {} : { incoming }),
		...(outgoing === undefined ? {} : { outgoing }),
	})
}

/** Converts a font's Y-up outline into create-design's local Y-down plane. */
function outlineContours(
	commands: readonly OutlineCommand[],
	scale: number,
	x: number,
	y: number,
	prefix: string,
): readonly DesignContour[] {
	const contours: DesignContour[] = []
	let points: DesignPoint[] = []
	let closed = false
	const finish = () => {
		if (points.length === 0) return
		const contourIndex = contours.length
		const contourId = `${prefix}:contour:${contourIndex}`
		contours.push(
			frozen({
				id: contourId,
				closed,
				points: frozen(
					points.map((item, index) => ({
						...item,
						id: `${contourId}:point:${index}`,
					})),
				),
			}),
		)
		points = []
		closed = false
	}
	const projected = (value: Readonly<{ x: number; y: number }>) => ({
		x: x + value.x * scale,
		y: y - value.y * scale,
	})
	for (const command of commands) {
		if (command.type === "M") {
			finish()
			const target = projected(command)
			points.push(point("pending", target.x, target.y))
			continue
		}
		if (command.type === "Z") {
			closed = true
			finish()
			continue
		}
		const previous = points.at(-1)
		if (previous === undefined) continue
		const target = projected(command)
		if (command.type === "L") {
			points.push(point("pending", target.x, target.y))
			continue
		}
		if (command.type === "Q") {
			const control = projected({ x: command.cx, y: command.cy })
			const c1 = {
				x: previous.x + (control.x - previous.x) * (2 / 3),
				y: previous.y + (control.y - previous.y) * (2 / 3),
			}
			const c2 = {
				x: target.x + (control.x - target.x) * (2 / 3),
				y: target.y + (control.y - target.y) * (2 / 3),
			}
			points[points.length - 1] = point(
				"pending",
				previous.x,
				previous.y,
				previous.incoming,
				{ x: c1.x - previous.x, y: c1.y - previous.y },
			)
			points.push(
				point("pending", target.x, target.y, {
					x: c2.x - target.x,
					y: c2.y - target.y,
				}),
			)
			continue
		}
		const c1 = projected({ x: command.c1x, y: command.c1y })
		const c2 = projected({ x: command.c2x, y: command.c2y })
		points[points.length - 1] = point(
			"pending",
			previous.x,
			previous.y,
			previous.incoming,
			{ x: c1.x - previous.x, y: c1.y - previous.y },
		)
		points.push(
			point("pending", target.x, target.y, {
				x: c2.x - target.x,
				y: c2.y - target.y,
			}),
		)
	}
	finish()
	return frozen(contours)
}

interface LineSource {
	readonly start: number
	readonly end: number
	readonly text: string
}

function paragraphs(text: string): readonly LineSource[] {
	const lines: LineSource[] = []
	let start = 0
	for (const match of text.matchAll(/\r\n|[\n\r]/gu)) {
		const index = match.index
		lines.push({ start, end: index, text: text.slice(start, index) })
		start = index + match[0].length
	}
	lines.push({ start, end: text.length, text: text.slice(start) })
	return lines
}

function shapeRequest(
	fontService: FontService,
	font: FontIdentity,
	geometry: DesignTextGeometry,
	text: string,
): ReturnType<FontService["shape"]> {
	return fontService.shape({
		font,
		text,
		direction: geometry.typography.direction,
		...(geometry.typography.script === undefined
			? {}
			: { script: geometry.typography.script }),
		...(geometry.typography.language === undefined
			? {}
			: { language: geometry.typography.language }),
		...(geometry.typography.variations === undefined
			? {}
			: { variations: geometry.typography.variations }),
		...(geometry.typography.kerning === "auto"
			? {}
			: { features: [{ tag: "kern", value: 0 }] }),
	})
}

function shapedAdvance(
	shaped: ShapedText,
	geometry: DesignTextGeometry,
): number {
	const scale = geometry.typography.size / shaped.metrics.unitsPerEm
	const tracking =
		(geometry.typography.tracking / 1_000) * geometry.typography.size
	const kerning =
		geometry.typography.kerning === "auto"
			? 0
			: (geometry.typography.kerning / 1_000) * geometry.typography.size
	return (
		(shaped.lines[0]?.advanceX ?? 0) * scale +
		Math.max(0, shaped.glyphs.length - 1) * (tracking + kerning)
	)
}

function wrapParagraph(
	fontService: FontService,
	font: FontIdentity,
	geometry: DesignTextGeometry,
	paragraph: LineSource,
	width: number,
): readonly LineSource[] {
	if (paragraph.text.length === 0) return [paragraph]
	const words = [...paragraph.text.matchAll(/\s+|\S+/gu)].map((match) => ({
		start: paragraph.start + match.index,
		end: paragraph.start + match.index + match[0].length,
		text: match[0],
	}))
	const lines: LineSource[] = []
	let current: LineSource | undefined
	for (const word of words) {
		const candidate =
			current === undefined
				? word
				: {
						start: current.start,
						end: word.end,
						text: paragraph.text.slice(
							current.start - paragraph.start,
							word.end - paragraph.start,
						),
					}
		const shaped = shapeRequest(fontService, font, geometry, candidate.text).value
		if (
			shaped !== undefined &&
			shapedAdvance(shaped, geometry) > width &&
			current !== undefined &&
			current.text.trim().length > 0
		) {
			const trimmed = current.text.trimEnd()
			lines.push({ ...current, end: current.start + trimmed.length, text: trimmed })
			const leftTrimmed = word.text.trimStart()
			current = {
				start: word.end - leftTrimmed.length,
				end: word.end,
				text: leftTrimmed,
			}
		} else current = candidate
	}
	if (current !== undefined) lines.push(current)
	return lines
}

function lineSources(
	fontService: FontService,
	font: FontIdentity,
	geometry: DesignTextGeometry,
): readonly LineSource[] {
	if (geometry.mode === "point" || geometry.frame === undefined)
		return paragraphs(geometry.text)
	const width = Math.max(
		0,
		geometry.frame.width -
			geometry.frame.inset.left -
			geometry.frame.inset.right,
	)
	return paragraphs(geometry.text).flatMap((paragraph) =>
		wrapParagraph(fontService, font, geometry, paragraph, width),
	)
}

function layoutCacheKey(object: DesignObject, font: FontIdentity): string {
	return `${font.key}\u0000${object.id}\u0000${JSON.stringify(object.geometry)}\u0000${JSON.stringify(object.appearance)}`
}

export function createDesignTextService(): DesignTextService {
	const fontService = createFontService()
	const fonts = new Map<string, FontIdentity>()
	const layouts = new Map<string, DesignTextLayout>()

	const layout = (object: DesignObject): DesignTextLayout | null => {
		if (object.geometry.kind !== "text") return null
		const geometry = object.geometry
		const font = fonts.get(geometry.typography.font.id)
		if (font === undefined) {
			return frozen({
				objectId: object.id,
				font: frozen({
					...geometry.typography.font,
					faceIndex: geometry.typography.font.faceIndex ?? 0,
					revision: geometry.typography.font.revision ?? 1,
					binaryHash: "missing",
					key: `missing:${geometry.typography.font.id}`,
					source: geometry.typography.font.id,
				}),
				glyphs: frozen([]),
				lines: frozen([]),
				diagnostics: frozen([
					textDiagnostic(
						object.id,
						"font.missing",
						`Font ${geometry.typography.font.family} (${geometry.typography.font.id}) is not loaded.`,
					),
				]),
				visibleTextEnd: 0,
				overset: geometry.text.length > 0,
				bounds: frozen({ x: geometry.x, y: geometry.y, width: 0, height: 0 }),
			})
		}
		const key = layoutCacheKey(object, font)
		const cached = layouts.get(key)
		if (cached !== undefined) return cached
		const sources = lineSources(fontService, font, geometry)
		const metrics = fontService.metrics(font, geometry.typography.variations)
		if (metrics.value === undefined) return null
		const scale = geometry.typography.size / metrics.value.unitsPerEm
		const usableHeight =
			geometry.mode === "area" && geometry.frame !== undefined
				? Math.max(
						0,
						geometry.frame.height -
							geometry.frame.inset.top -
							geometry.frame.inset.bottom,
					)
				: Number.POSITIVE_INFINITY
		const maxLines = Number.isFinite(usableHeight)
			? Math.max(0, Math.floor(usableHeight / geometry.typography.leading))
			: sources.length
		const visibleSources = sources.slice(0, maxLines)
		const overset = visibleSources.length < sources.length
		const contentHeight = visibleSources.length * geometry.typography.leading
		const verticalOffset =
			geometry.mode !== "area" || geometry.frame === undefined
				? 0
				: geometry.frame.verticalAlignment === "center"
					? Math.max(0, (usableHeight - contentHeight) / 2)
					: geometry.frame.verticalAlignment === "bottom"
						? Math.max(0, usableHeight - contentHeight)
						: 0
		const contentX =
			geometry.x +
			(geometry.mode === "area" ? (geometry.frame?.inset.left ?? 0) : 0)
		const firstBaseline =
			geometry.y +
			(geometry.mode === "area"
				? (geometry.frame?.inset.top ?? 0) +
					verticalOffset +
					metrics.value.ascender * scale
				: 0)
		const availableWidth =
			geometry.mode === "area" && geometry.frame !== undefined
				? geometry.frame.width -
					geometry.frame.inset.left -
					geometry.frame.inset.right
				: Number.POSITIVE_INFINITY
		const glyphs: DesignTextGlyph[] = []
		const lines: DesignTextLine[] = []
		const diagnostics: DesignTextDiagnostic[] = metrics.diagnostics.map((value) =>
			diagnostic(object.id, value),
		)
		let maxAdvance = 0
		for (const [lineIndex, source] of visibleSources.entries()) {
			const shapedResult = shapeRequest(fontService, font, geometry, source.text)
			const shaped = shapedResult.value
			diagnostics.push(...shapedResult.diagnostics.map((value) => diagnostic(object.id, value)))
			if (shaped === undefined) continue
			const advance = shapedAdvance(shaped, geometry)
			const nextText = geometry.text.slice(source.end, source.end + 2)
			const shouldJustify =
				geometry.typography.alignment === "justify" &&
				Number.isFinite(availableWidth) &&
				shaped.glyphs.length > 1 &&
				source.end < geometry.text.length &&
				!/^[\n\r]/u.test(nextText)
			const justifyGap = shouldJustify
				? Math.max(0, (availableWidth - advance) / (shaped.glyphs.length - 1))
				: 0
			const renderedAdvance =
				advance + justifyGap * Math.max(0, shaped.glyphs.length - 1)
			maxAdvance = Math.max(maxAdvance, renderedAdvance)
			const alignOffset =
				!Number.isFinite(availableWidth) || geometry.typography.alignment === "start"
					? 0
					: geometry.typography.alignment === "center"
						? (availableWidth - advance) / 2
						: geometry.typography.alignment === "end"
							? availableWidth - advance
							: 0
			const baseline = firstBaseline + lineIndex * geometry.typography.leading
			const glyphStart = glyphs.length
			let adjustment = 0
			for (const [glyphIndex, glyph] of shaped.glyphs.entries()) {
				const x = contentX + alignOffset + glyph.x * scale + adjustment
				const y = baseline - glyph.y * scale
				const outlineResult = fontService.outline({
					font,
					glyphId: glyph.glyphId,
					...(geometry.typography.variations === undefined
						? {}
						: { variations: geometry.typography.variations }),
				})
				diagnostics.push(...outlineResult.diagnostics.map((value) => diagnostic(object.id, value)))
				const prefix = `${object.id}:glyph:${source.start + glyph.cluster}:${glyphIndex}`
				glyphs.push(
					frozen({
						glyphId: glyph.glyphId,
						cluster: source.start + glyph.cluster,
						clusterEnd: source.start + glyph.clusterEnd,
						lineIndex,
						x,
						y,
						advanceX: glyph.xAdvance * scale,
						advanceY: glyph.yAdvance * scale,
						contours: frozen(
							outlineContours(
								outlineResult.value?.commands ?? [],
								scale,
								x + glyph.xOffset * scale,
								y - glyph.yOffset * scale,
								prefix,
							),
						),
					}),
				)
				if (glyphIndex < shaped.glyphs.length - 1)
					adjustment +=
						(geometry.typography.tracking / 1_000) * geometry.typography.size +
						(geometry.typography.kerning === "auto"
							? 0
							: (geometry.typography.kerning / 1_000) * geometry.typography.size) +
						justifyGap
			}
			lines.push(
				frozen({
					textStart: source.start,
					textEnd: source.end,
					baseline,
					advance: renderedAdvance,
					glyphStart,
					glyphEnd: glyphs.length,
				}),
			)
		}
		if (overset)
			diagnostics.push(
				textDiagnostic(
					object.id,
					"text.overset",
					`${geometry.text.length - (visibleSources.at(-1)?.end ?? 0)} characters are overset and remain editable.`,
					"warning",
				),
			)
		const result = frozen({
			objectId: object.id,
			font,
			glyphs: frozen(glyphs),
			lines: frozen(lines),
			diagnostics: frozen(diagnostics),
			visibleTextEnd: visibleSources.at(-1)?.end ?? 0,
			overset,
			bounds: frozen({
				x: geometry.x,
				y: geometry.mode === "point" ? geometry.y - metrics.value.ascender * scale : geometry.y,
				width:
					geometry.mode === "area" && geometry.frame !== undefined
						? geometry.frame.width
						: maxAdvance,
				height:
					geometry.mode === "area" && geometry.frame !== undefined
						? geometry.frame.height
						: Math.max(geometry.typography.size, contentHeight),
			}),
		}) satisfies DesignTextLayout
		layouts.set(key, result)
		return result
	}

	return frozen({
		registerFont(reference, bytes) {
			const registered = fontService.registerFont(
				{
					source: reference.id,
					family: reference.family,
					faceIndex: reference.faceIndex,
					revision: reference.revision ?? 1,
				},
				bytes,
			)
			if (registered.value !== undefined) fonts.set(reference.id, registered.value.identity)
			layouts.clear()
			return frozen(
				registered.diagnostics.map((value) => diagnostic("object:font-registration", value)),
			)
		},
		unregisterFont(fontId) {
			const font = fonts.get(fontId)
			if (font === undefined) return false
			fonts.delete(fontId)
			layouts.clear()
			return fontService.unregisterFont(font)
		},
		layout,
		expand(object, identityPrefix = `${object.id}:expanded`) {
			const projection = layout(object)
			if (projection === null || object.geometry.kind !== "text") return null
			if (
				projection.diagnostics.some(
					(value) =>
						value.severity === "error" ||
						value.code === "glyph.missing" ||
						value.code === "font.unsupported-table",
				)
			)
				return null
			const objects = projection.glyphs.flatMap((glyph, index) =>
				glyph.contours.length === 0
					? []
					: [
							frozen({
								id: `${identityPrefix}:glyph:${index}`,
								name: `${object.name} glyph ${index + 1}`,
								geometry: frozen({
									kind: "path" as const,
									fillRule: "nonzero" as const,
									contours: glyph.contours.map((contour, contourIndex) => ({
										...contour,
										id: `${identityPrefix}:glyph:${index}:contour:${contourIndex}`,
										points: contour.points.map((item, pointIndex) => ({
											...item,
											id: `${identityPrefix}:glyph:${index}:contour:${contourIndex}:point:${pointIndex}`,
										})),
									})),
								}),
								transform: object.transform,
								appearance: object.appearance,
							}),
						]
			)
			return frozen({
				objects: frozen(objects),
				groupName: `${object.name} (expanded text)`,
			}) satisfies ExpandedText
		},
		cacheStats() {
			return frozen({ ...fontService.cacheStats(), layouts: layouts.size })
		},
		clearCaches() {
			fontService.clearCaches()
			layouts.clear()
		},
	})
}
