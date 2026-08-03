import type { MasterId } from "@create-font/states"

export interface AuthoringPoint {
	readonly x: number
	readonly y: number
}

export interface AuthoringLayerTransform {
	readonly masterId: MasterId
	readonly xScale: number
}

const canonicalZero = (value: number): number =>
	Object.is(value, -0) ? 0 : value

/**
 * Projects one absolute font-space point using the affine x transform shared by
 * interactive outline-authoring tools. Y remains in the active layer's space.
 */
export function projectAuthoringPoint(
	point: AuthoringPoint,
	transform: AuthoringLayerTransform,
): AuthoringPoint {
	if (
		!Number.isFinite(point.x) ||
		!Number.isFinite(point.y) ||
		!Number.isFinite(transform.xScale) ||
		transform.xScale <= 0
	) {
		throw new TypeError(
			"Authoring projection values must be finite and positive.",
		)
	}
	return {
		x: canonicalZero(500 + (point.x - 500) * transform.xScale),
		y: canonicalZero(point.y),
	}
}
