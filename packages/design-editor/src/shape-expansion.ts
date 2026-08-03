import { geometryContours, objectBounds, type Bounds } from "./geometry.ts"
import type { DesignDocument, DesignObject, DesignPoint } from "./types.ts"

export type ShapeExpansionEligibility =
	| Readonly<{ eligible: true; object: DesignObject }>
	| Readonly<{ eligible: false; reason: string }>

export function shapeExpansionEligibility(
	document: DesignDocument,
	selection: readonly string[],
): ShapeExpansionEligibility {
	if (selection.length === 0)
		return { eligible: false, reason: "Select a live rectangle or ellipse." }
	if (selection.length > 1)
		return {
			eligible: false,
			reason: "Select exactly one live rectangle or ellipse.",
		}
	const object = document.objects.find(
		(candidate) => candidate.id === selection[0],
	)
	if (object === undefined)
		return { eligible: false, reason: "The selected object is unavailable." }
	if (object.locked)
		return {
			eligible: false,
			reason: "Unlock the selected shape before expanding it.",
		}
	if (object.geometry.kind === "path")
		return {
			eligible: false,
			reason: "The selected object is already ordinary path geometry.",
		}
	return { eligible: true, object }
}

/**
 * Converts live local geometry to an ordinary cubic path while retaining the
 * object's transform, appearance, stacking identity, and object selection.
 */
export function expandDesignShape(
	object: DesignObject,
	nextId: () => string,
): DesignObject {
	if (object.geometry.kind === "path") return object
	return {
		...object,
		geometry: {
			kind: "path",
			contours: geometryContours(object.geometry).map((contour) => ({
				...contour,
				id: `contour:${nextId()}`,
				points: contour.points.map(
					(point): DesignPoint => ({
						...point,
						id: `point:${nextId()}`,
					}),
				),
			})),
		},
	}
}

export interface ExactObjectBounds {
	readonly x: number
	readonly y: number
	readonly width: number
	readonly height: number
}

export function exactObjectBounds(
	object: DesignObject,
): ExactObjectBounds | null {
	const bounds: Bounds | null = objectBounds(object)
	return bounds === null
		? null
		: {
				x: bounds.minX,
				y: bounds.minY,
				width: bounds.maxX - bounds.minX,
				height: bounds.maxY - bounds.minY,
			}
}
