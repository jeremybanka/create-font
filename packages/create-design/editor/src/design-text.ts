import {
	IDENTITY_DESIGN_TRANSFORM,
	type DesignFontReference,
	type DesignTextGeometry,
	type DesignTextTypography,
} from "@create-design/source"
import {
	scaleObject,
	transformDesignPoint,
	visibleObjectBounds,
	type Bounds,
} from "@create-design/model"
import type { DesignTextLayout, DesignTextService } from "@create-design/text"

import type { DesignAppearance, DesignObject } from "./types.ts"

export const DEFAULT_DESIGN_TEXT_TYPOGRAPHY: DesignTextTypography =
	Object.freeze({
		font: Object.freeze({ id: "font:system-sans", family: "sans-serif" }),
		size: 24,
		leading: 28.8,
		tracking: 0,
		kerning: "auto",
		alignment: "start",
		direction: "auto",
	})

export const DESIGN_TEXT_INITIAL_DRAFT = "Hello world"

export type CreateDesignTextObjectInput = Readonly<{
	id: string
	name: string
	mode: "point" | "area"
	x: number
	y: number
	appearance: DesignAppearance
	width?: number
	height?: number
	typography?: DesignTextTypography
	text?: string
}>

export function createDesignTextObject(
	input: CreateDesignTextObjectInput,
): DesignObject {
	const frame =
		input.mode === "area"
			? {
					width: Math.max(1, input.width ?? 240),
					height: Math.max(1, input.height ?? 120),
					inset: { top: 8, right: 8, bottom: 8, left: 8 },
					verticalAlignment: "top" as const,
				}
			: undefined
	return {
		id: input.id,
		name: input.name,
		geometry: {
			kind: "text",
			mode: input.mode,
			text: input.text ?? "",
			x: input.x,
			y: input.y,
			typography: input.typography ?? DEFAULT_DESIGN_TEXT_TYPOGRAPHY,
			...(frame === undefined ? {} : { frame }),
		},
		transform: IDENTITY_DESIGN_TRANSFORM,
		appearance: input.appearance,
	}
}

export function updateDesignText(
	object: DesignObject,
	text: string,
): DesignObject {
	if (object.geometry.kind !== "text") return object
	return { ...object, geometry: { ...object.geometry, text } }
}

export function updateDesignTextTypography(
	object: DesignObject,
	properties: Partial<DesignTextTypography>,
): DesignObject {
	if (object.geometry.kind !== "text") return object
	return {
		...object,
		geometry: {
			...object.geometry,
			typography: { ...object.geometry.typography, ...properties },
		},
	}
}

export function updateDesignAreaTextFrame(
	object: DesignObject,
	properties: Partial<NonNullable<DesignTextGeometry["frame"]>>,
): DesignObject {
	if (
		object.geometry.kind !== "text" ||
		object.geometry.mode !== "area" ||
		object.geometry.frame === undefined
	)
		return object
	return {
		...object,
		geometry: {
			...object.geometry,
			frame: { ...object.geometry.frame, ...properties },
		},
	}
}

/**
 * Applies a proportional world-space resize while keeping type size canonical.
 * Scaling every local text metric by the magnitude and retaining only a
 * possible 180-degree reflection in the affine matrix is algebraically
 * equivalent to a uniform left-multiplied object scale.
 */
export function scaleDesignTextObject(
	object: DesignObject,
	anchor: Readonly<{ x: number; y: number }>,
	scale: number,
): DesignObject {
	if (object.geometry.kind !== "text")
		return scaleObject(object, anchor, scale, scale)
	const magnitude = Math.max(Math.abs(scale), Number.EPSILON)
	const direction = scale < 0 ? -1 : 1
	const scaled = scaleObject(object, anchor, scale, scale)
	const frame = object.geometry.frame
	const stroke = object.appearance.stroke
	return {
		...scaled,
		geometry: {
			...object.geometry,
			x: object.geometry.x * magnitude,
			y: object.geometry.y * magnitude,
			typography: {
				...object.geometry.typography,
				size: object.geometry.typography.size * magnitude,
				leading: object.geometry.typography.leading * magnitude,
			},
			...(frame === undefined
				? {}
				: {
						frame: {
							...frame,
							width: frame.width * magnitude,
							height: frame.height * magnitude,
							inset: {
								top: frame.inset.top * magnitude,
								right: frame.inset.right * magnitude,
								bottom: frame.inset.bottom * magnitude,
								left: frame.inset.left * magnitude,
							},
						},
					}),
		},
		transform: {
			...scaled.transform,
			a: direction * object.transform.a,
			b: direction * object.transform.b,
			c: direction * object.transform.c,
			d: direction * object.transform.d,
		},
		appearance:
			stroke === undefined
				? object.appearance
				: {
						...object.appearance,
						stroke: {
							...stroke,
							width: stroke.width * magnitude,
							dashArray: stroke.dashArray.map((value) => value * magnitude),
							dashOffset: stroke.dashOffset * magnitude,
						},
					},
	}
}

export type EstimatedDesignTextLayout = Readonly<{
	lineCount: number
	visibleLineCount: number
	overset: boolean
	visibleText: string
}>

/**
 * Lightweight editor fallback used before a font-backed projection is ready.
 * Export and Expand Text never consume this estimate. It only keeps area-text
 * overflow visible and accessible while the canonical shaper is unavailable.
 */
export function estimateDesignTextLayout(
	geometry: DesignTextGeometry,
): EstimatedDesignTextLayout {
	if (geometry.mode === "point" || geometry.frame === undefined) {
		const lineCount = Math.max(1, geometry.text.split(/\r\n|\r|\n/u).length)
		return {
			lineCount,
			visibleLineCount: lineCount,
			overset: false,
			visibleText: geometry.text,
		}
	}
	const { frame, typography } = geometry
	const usableWidth = Math.max(
		1,
		frame.width - frame.inset.left - frame.inset.right,
	)
	const usableHeight = Math.max(
		0,
		frame.height - frame.inset.top - frame.inset.bottom,
	)
	const averageAdvance = Math.max(
		1,
		typography.size * 0.55 + typography.tracking / 1000,
	)
	const charactersPerLine = Math.max(
		1,
		Math.floor(usableWidth / averageAdvance),
	)
	const lines: string[] = []
	for (const paragraph of geometry.text.split(/\r\n|\r|\n/u)) {
		if (paragraph.length === 0) {
			lines.push("")
			continue
		}
		let remaining = paragraph
		while (remaining.length > charactersPerLine) {
			const candidate = remaining.slice(0, charactersPerLine + 1)
			const breakAt = candidate.lastIndexOf(" ")
			const take = breakAt > 0 ? breakAt : charactersPerLine
			lines.push(remaining.slice(0, take))
			remaining = remaining.slice(take + (breakAt > 0 ? 1 : 0))
		}
		lines.push(remaining)
	}
	const visibleLineCount = Math.max(
		0,
		Math.floor(usableHeight / Math.max(1, typography.leading)),
	)
	return {
		lineCount: lines.length,
		visibleLineCount: Math.min(lines.length, visibleLineCount),
		overset: lines.length > visibleLineCount,
		visibleText: lines.slice(0, visibleLineCount).join("\n"),
	}
}

export function designTextFamilyId(family: string): string {
	const slug = family
		.trim()
		.toLowerCase()
		.replaceAll(/[^a-z0-9]+/gu, "-")
		.replaceAll(/^-|-$/gu, "")
	return `font:${slug || "system-sans"}`
}

export function designTextBrowserFontFamily(
	reference: DesignFontReference,
): string {
	const key = `${reference.id}\u0000${String(reference.revision ?? "unversioned")}`
	let hash = 2_166_136_261
	for (let index = 0; index < key.length; index += 1) {
		hash ^= key.charCodeAt(index)
		hash = Math.imul(hash, 16_777_619)
	}
	const slug = reference.id
		.slice("font:".length)
		.replaceAll(/[^a-zA-Z0-9_-]+/gu, "-")
		.replaceAll(/^-+|-+$/gu, "")
	return `CreateDesign-${slug || "font"}-${(hash >>> 0).toString(16).padStart(8, "0")}`
}

export function designTextCssFontFamily(family: string): string {
	return `"${family
		.replaceAll("\\", "\\\\")
		.replaceAll("\0", "�")
		.replaceAll("\n", "\\a ")
		.replaceAll("\r", "\\d ")
		.replaceAll("\f", "\\c ")
		.replaceAll('"', '\\"')}"`
}

export function designTextInteractionBounds(
	object: DesignObject & { readonly geometry: DesignTextGeometry },
	layout: DesignTextLayout,
): Bounds {
	const bounds = layout.bounds
	const points = [
		{ id: "text-layout:0", x: bounds.x, y: bounds.y },
		{ id: "text-layout:1", x: bounds.x + bounds.width, y: bounds.y },
		{
			id: "text-layout:2",
			x: bounds.x + bounds.width,
			y: bounds.y + bounds.height,
		},
		{ id: "text-layout:3", x: bounds.x, y: bounds.y + bounds.height },
	].map((point) => transformDesignPoint(object.transform, point))
	return {
		minX: Math.min(...points.map(({ x }) => x)),
		minY: Math.min(...points.map(({ y }) => y)),
		maxX: Math.max(...points.map(({ x }) => x)),
		maxY: Math.max(...points.map(({ y }) => y)),
	}
}

export function designObjectInteractionBounds(
	object: DesignObject,
	textService: DesignTextService,
): Bounds | null {
	if (object.geometry.kind !== "text") return visibleObjectBounds(object)
	const layout = textService.layout(object)
	return layout === null ||
		layout.diagnostics.some(({ severity }) => severity === "error")
		? visibleObjectBounds(object)
		: designTextInteractionBounds(
				object as DesignObject & { readonly geometry: DesignTextGeometry },
				layout,
			)
}

export function designTextOverlayStyle(
	object: DesignObject & { readonly geometry: DesignTextGeometry },
	layout: DesignTextLayout,
	registeredFamily: string,
	view: Readonly<{ x: number; y: number }>,
	worldScale: number,
): Readonly<Record<string, string | number>> {
	const { geometry, transform } = object
	const inset = geometry.frame?.inset ?? {
		top: 0,
		right: 0,
		bottom: 0,
		left: 0,
	}
	const width =
		geometry.frame === undefined
			? Math.max(1, layout.logicalBounds.width)
			: Math.max(1, geometry.frame.width - inset.left - inset.right)
	const height =
		geometry.frame === undefined
			? Math.max(1, layout.logicalBounds.height)
			: Math.max(1, geometry.frame.height - inset.top - inset.bottom)
	const localX =
		geometry.frame === undefined
			? layout.logicalBounds.x
			: geometry.x + inset.left
	const localY =
		geometry.frame === undefined
			? layout.logicalBounds.y
			: geometry.y + inset.top
	const variations = Object.entries(geometry.typography.variations ?? {})
		.toSorted(([left], [right]) => left.localeCompare(right))
		.map(([tag, value]) => `'${tag}' ${value}`)
		.join(", ")
	return {
		left: 0,
		top: 0,
		background: "transparent",
		color: "transparent",
		boxSizing: "content-box",
		width,
		height,
		whiteSpace: geometry.mode === "point" ? "pre" : "pre-wrap",
		overflowWrap: "normal",
		wordBreak: "normal",
		fontFamily: designTextCssFontFamily(registeredFamily),
		fontVariationSettings: variations.length === 0 ? "normal" : variations,
		fontKerning: geometry.typography.kerning === "auto" ? "auto" : "none",
		fontSize: `${geometry.typography.size}px`,
		lineHeight: String(geometry.typography.leading / geometry.typography.size),
		letterSpacing: `${geometry.typography.tracking / 1000}em`,
		textAlign:
			geometry.typography.alignment === "start"
				? geometry.typography.direction === "rtl"
					? "right"
					: "left"
				: geometry.typography.alignment === "end"
					? geometry.typography.direction === "rtl"
						? "left"
						: "right"
					: geometry.typography.alignment,
		direction: geometry.typography.direction === "rtl" ? "rtl" : "ltr",
		transformOrigin: "0 0",
		transform: `matrix(${worldScale * transform.a}, ${worldScale * transform.b}, ${worldScale * transform.c}, ${worldScale * transform.d}, ${view.x + worldScale * (transform.e + transform.a * localX + transform.c * localY)}, ${view.y + worldScale * (transform.f + transform.b * localX + transform.d * localY)})`,
	}
}

export function designTextKonvaTransform(
	transform: DesignObject["transform"],
): Readonly<{
	x: number
	y: number
	rotation: number
	scaleX: number
	scaleY: number
	skewX: number
}> {
	const scaleX = Math.hypot(transform.a, transform.b) || 1
	const determinant = transform.a * transform.d - transform.b * transform.c
	return {
		x: transform.e,
		y: transform.f,
		rotation: (Math.atan2(transform.b, transform.a) * 180) / Math.PI,
		scaleX,
		scaleY: determinant / scaleX,
		skewX:
			(Math.atan2(
				transform.a * transform.c + transform.b * transform.d,
				scaleX * scaleX,
			) *
				180) /
			Math.PI,
	}
}
