import type { CanvasPoint } from "@create-font/editor/shared"

import type { DesignDocument } from "./types.ts"

export type DocumentPoint = Readonly<{ readonly x: number; readonly y: number }>
export type InterchangePoint = Readonly<{
	readonly x: number
	readonly y: number
}>
export type PdfPoint = Readonly<{ readonly x: number; readonly y: number }>

export interface CoordinateTransform {
	readonly a: number
	readonly b: number
	readonly c: number
	readonly d: number
	readonly e: number
	readonly f: number
}

/**
 * Canvas world coordinates are the global document plane: points are measured
 * in pt, X increases right, and Y increases down. Screen pan/zoom is a separate
 * view transform owned by the shared canvas foundations.
 */
export function documentToCanvasPoint(point: DocumentPoint): CanvasPoint {
	return { x: point.x, y: point.y }
}

export function canvasToDocumentPoint(point: CanvasPoint): DocumentPoint {
	return { x: point.x, y: point.y }
}

/** Create-* vector and font clipboards use a Cartesian Y-up plane. */
export function documentToInterchangePoint(
	point: DocumentPoint,
): InterchangePoint {
	return { x: point.x, y: -point.y }
}

export function interchangeToDocumentPoint(
	point: InterchangePoint,
): DocumentPoint {
	return { x: point.x, y: -point.y }
}

export function documentToInterchangeVector(
	vector: DocumentPoint,
): InterchangePoint {
	return { x: vector.x, y: -vector.y }
}

export const interchangeToDocumentVector = documentToInterchangeVector

/**
 * Converts global document coordinates into one PDF page's bottom-left,
 * Y-up coordinate system. Moving or resizing the page changes this boundary
 * transform without rewriting any object geometry.
 */
export function documentToPdfTransform(
	page: DesignDocument["page"],
): CoordinateTransform {
	return {
		a: 1,
		b: 0,
		c: 0,
		d: -1,
		e: -page.x,
		f: page.y + page.height,
	}
}

export function documentToPdfPoint(
	point: DocumentPoint,
	page: DesignDocument["page"],
): PdfPoint {
	const transform = documentToPdfTransform(page)
	return {
		x: transform.a * point.x + transform.c * point.y + transform.e,
		y: transform.b * point.x + transform.d * point.y + transform.f,
	}
}

export function pdfToDocumentPoint(
	point: PdfPoint,
	page: DesignDocument["page"],
): DocumentPoint {
	return { x: point.x + page.x, y: page.y + page.height - point.y }
}
