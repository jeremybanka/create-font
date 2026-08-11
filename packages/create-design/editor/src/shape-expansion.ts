import {
	geometryContours,
	inverseTransformDesignPoint,
	objectBounds,
	projectDesignObjectContours,
	type Bounds,
} from "@create-design/model"
import type { DesignDocument, DesignObject, DesignPoint } from "./types.ts"

export type ShapeExpansionEligibility =
	| Readonly<{ eligible: true; object: DesignObject }>
	| Readonly<{ eligible: false; reason: string }>

const hasLiveCorners = (object: DesignObject): boolean =>
	object.geometry.kind === "path" &&
	object.geometry.contours.some((contour) =>
		contour.points.some(({ corner }) => corner !== undefined),
	)

export function shapeExpansionEligibility(
	document: DesignDocument,
	selection: readonly string[],
): ShapeExpansionEligibility {
	if (selection.length === 0)
		return {
			eligible: false,
			reason: "Select a live shape or a path with live corners.",
		}
	if (selection.length > 1)
		return {
			eligible: false,
			reason: "Select exactly one live shape or live-corner path.",
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
	if (object.geometry.kind === "path" && !hasLiveCorners(object))
		return {
			eligible: false,
			reason: "The selected object is already ordinary path geometry.",
		}
	if (
		object.geometry.kind !== "path" &&
		object.geometry.kind !== "rectangle" &&
		object.geometry.kind !== "ellipse"
	)
		return {
			eligible: false,
			reason:
				"Only live shapes and paths with live corners can expand as shapes.",
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
	if (
		(object.geometry.kind === "path" && !hasLiveCorners(object)) ||
		(object.geometry.kind !== "path" &&
			object.geometry.kind !== "rectangle" &&
			object.geometry.kind !== "ellipse")
	)
		return object
	const fillRule =
		object.geometry.kind === "path" ? object.geometry.fillRule : undefined
	const projected = projectDesignObjectContours(object)
	const localContours = projected.map((contour) => ({
		...contour,
		points: contour.points.map((point) =>
			inverseTransformDesignPoint(object.transform, point),
		),
	}))
	const contours = localContours.every((contour) =>
		contour.points.every((point) => point !== null),
	)
		? localContours.map((contour) => ({
				...contour,
				points: contour.points as readonly DesignPoint[],
			}))
		: geometryContours(object.geometry)
	return {
		...object,
		geometry: {
			kind: "path",
			...(fillRule === undefined ? {} : { fillRule }),
			contours: contours.map((contour) => ({
				...contour,
				id: `contour:${nextId()}`,
				points: contour.points.map((point): DesignPoint => ({
					...point,
					id: `point:${nextId()}`,
				})),
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
