import {
	expandStroke,
	fitCubicContour,
	GeometryError,
	type Cubic,
} from "@create-art/vector-geometry"

import { geometryContours } from "./geometry.ts"
import { flattenDesignContourForStroke } from "./painted-geometry.ts"
import type {
	DesignContour,
	DesignDocument,
	DesignObject,
	DesignPoint,
} from "./types.ts"

export const STROKE_EXPANSION_TOLERANCES = Object.freeze({
	/** Half of the total budget: source/round polyline construction error. */
	flatness: 0.025,
	/** Local-coordinate threshold for coincident points and zero-length paths. */
	distance: 1e-7,
})

/** Half of the 0.05 local-unit construction budget is reserved for refitting. */
export const STROKE_EXPANSION_REFIT_ERROR = 0.025
export const STROKE_EXPANSION_MAX_ERROR =
	STROKE_EXPANSION_TOLERANCES.flatness + STROKE_EXPANSION_REFIT_ERROR

export type StrokeExpansionEligibility =
	| Readonly<{ eligible: true; object: DesignObject }>
	| Readonly<{ eligible: false; reason: string }>

export type DesignStrokeExpansionResult =
	| Readonly<{
			ok: true
			/** Replacement objects in their intended stacking order. */
			objects: readonly DesignObject[]
			selectedObjectId: string
	  }>
	| Readonly<{ ok: false; error: string }>

export function strokeExpansionEligibility(
	document: DesignDocument,
	selection: readonly string[],
): StrokeExpansionEligibility {
	if (selection.length === 0)
		return { eligible: false, reason: "Select one stroked object." }
	if (selection.length > 1)
		return { eligible: false, reason: "Select exactly one stroked object." }
	const object = document.objects.find(
		(candidate) => candidate.id === selection[0],
	)
	if (object === undefined)
		return { eligible: false, reason: "The selected object is unavailable." }
	if (object.hidden)
		return {
			eligible: false,
			reason: "Show the selected object before expanding its stroke.",
		}
	if (object.locked)
		return {
			eligible: false,
			reason: "Unlock the selected object before expanding its stroke.",
		}
	if (object.appearance.stroke === undefined)
		return {
			eligible: false,
			reason: "Assign a stroke paint before expanding the stroke.",
		}
	if (object.appearance.stroke.width <= STROKE_EXPANSION_TOLERANCES.distance)
		return {
			eligible: false,
			reason: "Set a positive visible stroke width before expanding it.",
		}
	return { eligible: true, object }
}

function expansionError(error: unknown): string {
	if (error instanceof GeometryError)
		return `Could not expand the stroke: ${error.message}`
	return error instanceof Error
		? `Could not expand the stroke: ${error.message}`
		: "Could not expand the stroke because its geometry is invalid."
}

const vectorFrom = (
	anchor: Readonly<{ x: number; y: number }>,
	control: Readonly<{ x: number; y: number }>,
) => ({ x: control.x - anchor.x, y: control.y - anchor.y })

function designPointsFromCubics(
	cubics: readonly Cubic[],
	nextId: () => string,
): readonly DesignPoint[] {
	return cubics.map((cubic, index) => {
		const previous = cubics[(index - 1 + cubics.length) % cubics.length]
		return {
			id: `point:${nextId()}`,
			x: cubic.p0.x,
			y: cubic.p0.y,
			...(previous === undefined
				? {}
				: { incoming: vectorFrom(cubic.p0, previous.c2) }),
			outgoing: vectorFrom(cubic.p0, cubic.c1),
		}
	})
}

/**
 * Builds the complete replacement before requesting identities, so every
 * failure is side-effect free. The source object identity and affine transform
 * stay on the expanded stroke. A differently painted source fill is retained
 * as an adjacent fill-only sibling below it.
 */
export function expandDesignStroke(
	object: DesignObject,
	nextId: () => string,
): DesignStrokeExpansionResult {
	const stroke = object.appearance.stroke
	if (stroke === undefined)
		return { ok: false, error: "Assign a stroke paint before expanding it." }
	try {
		if (!Object.values(object.transform).every(Number.isFinite))
			throw new GeometryError(
				"NON_FINITE_COORDINATE",
				"Object transform values must be finite.",
			)
		const contours = geometryContours(object.geometry)
			.flatMap((contour) => {
				const flattened = flattenDesignContourForStroke(
					contour,
					stroke.join,
					STROKE_EXPANSION_TOLERANCES.flatness,
				)
				return expandStroke(
					{
						closed: contour.closed,
						points: flattened.points,
					},
					{
						width: stroke.width,
						cap: stroke.cap,
						join: stroke.join,
						miterLimit: stroke.miterLimit,
						dashArray: stroke.dashArray,
						dashOffset: stroke.dashOffset,
						vertexJoins: flattened.vertexJoins,
						tolerances: STROKE_EXPANSION_TOLERANCES,
					},
				)
			})
			.map((contour) => ({
				closed: contour.closed,
				cubics: fitCubicContour(contour, {
					maxError: STROKE_EXPANSION_REFIT_ERROR,
					tolerances: STROKE_EXPANSION_TOLERANCES,
				}),
			}))
		if (contours.length === 0)
			return {
				ok: false,
				error:
					"Could not expand the stroke because its centerline has no visible length.",
			}

		const pathContours: readonly DesignContour[] = contours.map((contour) => ({
			id: `contour:${nextId()}`,
			closed: contour.closed,
			points: designPointsFromCubics(contour.cubics, nextId),
		}))
		const expanded: DesignObject = {
			...object,
			geometry: { kind: "path", contours: pathContours },
			appearance: { fill: { swatchId: stroke.swatchId } },
		}
		const authoredFill = object.appearance.fill
		if (authoredFill === undefined)
			return { ok: true, objects: [expanded], selectedObjectId: expanded.id }
		const fill: DesignObject = {
			...object,
			id: `object:${nextId()}`,
			name: `${object.name} fill`,
			appearance: { fill: authoredFill },
		}
		return {
			ok: true,
			objects: [fill, expanded],
			selectedObjectId: expanded.id,
		}
	} catch (error) {
		return { ok: false, error: expansionError(error) }
	}
}
