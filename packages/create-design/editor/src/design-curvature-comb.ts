import type { CurvatureSide } from "@create-art/editor"
import {
	createCurvatureComb,
	type CurvatureCombCell,
	type CurvatureContour,
	type CurvatureNormalResolver,
} from "@create-art/vector-geometry"
import {
	createDesignObjectGeometryHitTest,
	objectBounds,
	projectDesignObjectContours,
} from "@create-design/model"

import type { DesignObject } from "./types.ts"

export interface DesignCurvatureCombOptions {
	readonly gain: number
	readonly referenceUnits: number
	readonly side: CurvatureSide
}

const PROBE_FACTORS = [1e-6, 4e-6, 16e-6, 64e-6, 256e-6, 1e-3]

/**
 * Resolves the unfilled side of a closed design contour from the complete
 * object's fill topology. Winding is deliberately not consulted: even-odd
 * counters and nonzero compounds are classified by the same hit-test contract
 * used by create-design. Open contours have no exterior boundary, so Outer
 * intentionally falls back to the signed-curvature normal for their authored
 * segments rather than inventing a side from their implicit fill closure.
 */
export function createDesignOuterNormalResolver(
	object: DesignObject,
): CurvatureNormalResolver {
	const bounds = objectBounds(object)
	const extent =
		bounds === null
			? 1
			: Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY, 1)
	const hitTest = createDesignObjectGeometryHitTest(object)
	return (sample, { contour }) => {
		if (!contour.closed) return "curvature"
		const speed = Math.hypot(sample.tangent.x, sample.tangent.y)
		if (!Number.isFinite(speed) || speed === 0) return null
		const right = {
			x: sample.tangent.y / speed,
			y: -sample.tangent.x / speed,
		}
		for (const factor of PROBE_FACTORS) {
			const distance = extent * factor
			const rightFilled = hitTest.containsPoint({
				x: sample.point.x + right.x * distance,
				y: sample.point.y + right.y * distance,
			})
			const leftFilled = hitTest.containsPoint({
				x: sample.point.x - right.x * distance,
				y: sample.point.y - right.y * distance,
			})
			if (rightFilled !== leftFilled) return rightFilled ? "left" : "right"
		}
		// A contour buried inside an already-filled nonzero region is not part of
		// the exterior topology, so it contributes no Outer cells.
		return null
	}
}

/** Builds one budgeted comb across multiple selected design objects. */
export function createDesignCurvatureComb(
	objects: readonly DesignObject[],
	options: DesignCurvatureCombOptions,
): readonly CurvatureCombCell[] {
	const resolverByContour = new Map<CurvatureContour, CurvatureNormalResolver>()
	const contours = objects.flatMap((object) => {
		const resolver = createDesignOuterNormalResolver(object)
		return projectDesignObjectContours(object).map((contour) => {
			const projected: CurvatureContour = {
				closed: contour.closed,
				nodes: contour.points.map((point) => ({
					x: point.x,
					y: point.y,
					...(point.incoming === undefined
						? {}
						: { incoming: point.incoming }),
					...(point.outgoing === undefined
						? {}
						: { outgoing: point.outgoing }),
				})),
			}
			resolverByContour.set(projected, resolver)
			return projected
		})
	})
	return createCurvatureComb(contours, {
		gain: options.gain,
		normalDirection:
			options.side === "signed"
				? "curvature"
				: (sample, location) =>
						resolverByContour.get(location.contour)?.(sample, location) ?? null,
		referenceUnits: options.referenceUnits,
	})
}
