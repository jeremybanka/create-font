import {
	IDENTITY_DESIGN_TRANSFORM,
	type DesignTextGeometry,
	type DesignTextTypography,
} from "@create-design/source"

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

export function designTextOverlayStyle(
	object: DesignObject & { readonly geometry: DesignTextGeometry },
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
			? Math.max(160, geometry.text.length * geometry.typography.size * 0.7)
			: Math.max(1, geometry.frame.width - inset.left - inset.right)
	const height =
		geometry.frame === undefined
			? Math.max(
					geometry.typography.leading,
					geometry.text.split(/\r\n|\r|\n/u).length *
						geometry.typography.leading,
				)
			: Math.max(1, geometry.frame.height - inset.top - inset.bottom)
	return {
		left: 0,
		top: 0,
		background: "transparent",
		width,
		height,
		fontFamily: geometry.typography.font.family,
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
		transform: `matrix(${worldScale * transform.a}, ${worldScale * transform.b}, ${worldScale * transform.c}, ${worldScale * transform.d}, ${view.x + worldScale * (transform.e + geometry.x + inset.left)}, ${view.y + worldScale * (transform.f + geometry.y - geometry.typography.size + inset.top)})`,
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
