import {
	booleanContours,
	contourOrientation,
	fitCubicContour,
	flattenCubic,
	partitionContours,
	pointOnSegment,
	resolveFilledContours,
	selfIntersections,
	windingNumber,
	type BooleanOperationSignal,
	type Cubic,
	type PartitionContoursProgress,
} from "@create-art/vector-geometry"
import { DEFAULT_DESIGN_STROKE_STYLE } from "@create-design/source"

import {
	directSelectionKey,
	type DesignDirectSelectionTarget,
} from "./design-selection.ts"
import {
	designObjectFillRule,
	IDENTITY_DESIGN_TRANSFORM,
	projectDesignObjectContours,
} from "@create-design/model"
import { replaceDesignHierarchySelection } from "./design-hierarchy.ts"
import type {
	DesignContour,
	DesignDocument,
	DesignObject,
	DesignPoint,
} from "./types.ts"

/** Maximum geometric deviation used by Simplify Path, in document units. */
export const DEFAULT_PATH_SIMPLIFY_TOLERANCE = 0.25
/** Coincidence tolerance used by cleanup and endpoint joining. */
export const DEFAULT_PATH_CLEANUP_TOLERANCE = 1e-6
/** Maximum construction deviation for Pathfinder output, in document units. */
export const DEFAULT_PATHFINDER_TOLERANCE = 0.05

export type DesignPathCommand =
	| "close"
	| "join"
	| "make-compound"
	| "normalize-winding"
	| "pathfinder-crop"
	| "pathfinder-divide"
	| "pathfinder-exclude"
	| "pathfinder-intersect"
	| "pathfinder-merge"
	| "pathfinder-outline"
	| "pathfinder-subtract-front"
	| "pathfinder-trim"
	| "pathfinder-unite"
	| "release-compound"
	| "reverse"
	| "simplify"

export interface DesignPathCommandContext {
	readonly document: DesignDocument
	readonly objectSelection: readonly string[]
	readonly directSelection: readonly DesignDirectSelectionTarget[]
	/** Active structural editing scope; null means the root scene. */
	readonly scopeGroupId: string | null
	/** Inherited editor policy may block the complete path selection. */
	readonly editingDisabledReason?: string | null
}

export type DesignPathCommandEligibility =
	| Readonly<{ eligible: true }>
	| Readonly<{ eligible: false; reason: string }>

export type DesignPathCommandResult =
	| Readonly<{
			ok: true
			document: DesignDocument
			objectSelection: readonly string[]
			directSelection: readonly DesignDirectSelectionTarget[]
			message: string
	  }>
	| Readonly<{ ok: false; error: string }>

export interface DesignPathCommandOptions {
	readonly cleanupTolerance?: number
	readonly pathfinderTolerance?: number
	readonly pathfinderSignal?: BooleanOperationSignal
	readonly onPathfinderProgress?: (progress: PartitionContoursProgress) => void
	readonly simplifyTolerance?: number
	readonly nextId?: () => string
}

interface ContourReference {
	readonly object: DesignObject
	readonly contour: DesignContour
	readonly objectIndex: number
	readonly contourIndex: number
}

const reject = (reason: string): DesignPathCommandEligibility => ({
	eligible: false,
	reason,
})

function selectedPathObjects(context: DesignPathCommandContext) {
	const ids = new Set(context.objectSelection)
	return context.document.objects.filter((object) => ids.has(object.id))
}

function directContourKeys(
	directSelection: readonly DesignDirectSelectionTarget[],
): ReadonlySet<string> {
	return new Set(
		directSelection.map((target) => `${target.objectId}\0${target.contourId}`),
	)
}

function selectedContours(
	context: DesignPathCommandContext,
): readonly ContourReference[] {
	const direct = directContourKeys(context.directSelection)
	const objects = new Set(context.objectSelection)
	return context.document.objects.flatMap((object, objectIndex) => {
		if (object.geometry.kind !== "path") return []
		return object.geometry.contours.flatMap((contour, contourIndex) => {
			const selected =
				direct.size > 0
					? direct.has(`${object.id}\0${contour.id}`)
					: objects.has(object.id)
			return selected ? [{ object, contour, objectIndex, contourIndex }] : []
		})
	})
}

function editableContourEligibility(
	context: DesignPathCommandContext,
): DesignPathCommandEligibility {
	const contours = selectedContours(context)
	if (contours.length === 0) return reject("Select one or more path contours.")
	const locked = contours.find(({ object }) => object.locked)
	if (locked !== undefined)
		return reject(`Unlock ${locked.object.name} before editing its paths.`)
	return { eligible: true }
}

function compoundEligibility(
	context: DesignPathCommandContext,
): DesignPathCommandEligibility {
	const objects = selectedPathObjects(context)
	if (objects.length < 2)
		return reject("Select at least two path objects to make a compound path.")
	if (objects.length !== context.objectSelection.length)
		return reject("Compound paths can only be made from ordinary path objects.")
	const locked = objects.find((object) => object.locked)
	if (locked !== undefined)
		return reject(`Unlock ${locked.name} before making a compound path.`)
	if (
		objects.some(
			(object) =>
				object.geometry.kind !== "path" ||
				object.geometry.contours.some((contour) => !contour.closed),
		)
	)
		return reject("Close every selected contour before making a compound path.")
	return { eligible: true }
}

function releaseEligibility(
	context: DesignPathCommandContext,
): DesignPathCommandEligibility {
	if (context.objectSelection.length !== 1)
		return reject("Select one compound path to release.")
	const object = context.document.objects.find(
		(candidate) => candidate.id === context.objectSelection[0],
	)
	if (object === undefined) return reject("The selected object is unavailable.")
	if (object.locked) return reject(`Unlock ${object.name} before releasing it.`)
	if (object.geometry.kind !== "path" || object.geometry.contours.length < 2)
		return reject("The selected object is not a compound path.")
	return { eligible: true }
}

function pathfinderEligibility(
	command: DesignPathCommand,
	context: DesignPathCommandContext,
): DesignPathCommandEligibility {
	const minimum = command === "pathfinder-outline" ? 1 : 2
	if (context.objectSelection.length < minimum)
		return reject(
			minimum === 1
				? "Select at least one filled object for Pathfinder Outline."
				: "Select at least two filled objects for Pathfinder.",
		)
	const selected = new Set(context.objectSelection)
	if (selected.size < minimum)
		return reject(
			minimum === 1
				? "Select at least one filled object for Pathfinder Outline."
				: "Select at least two distinct filled objects for Pathfinder.",
		)
	const objects = context.document.objects.filter((object) =>
		selected.has(object.id),
	)
	if (objects.length !== selected.size)
		return reject("A selected Pathfinder object is unavailable.")
	const locked = objects.find((object) => object.locked)
	if (locked !== undefined)
		return reject(`Unlock ${locked.name} before using Pathfinder.`)
	const hidden = objects.find((object) => object.hidden)
	if (hidden !== undefined)
		return reject(`Show ${hidden.name} before using Pathfinder.`)
	const unfilled = objects.find(
		(object) => object.appearance.fill === undefined,
	)
	if (unfilled !== undefined)
		return reject(`${unfilled.name} needs a fill before using Pathfinder.`)
	const invalid = objects.find((object) => {
		const contours = projectDesignObjectContours(object)
		return (
			contours.length === 0 ||
			contours.some((contour) => !contour.closed || contour.points.length < 3)
		)
	})
	if (invalid !== undefined)
		return reject(
			`${invalid.name} needs non-empty closed geometry for Pathfinder.`,
		)
	return { eligible: true }
}

function joinEligibility(
	context: DesignPathCommandContext,
): DesignPathCommandEligibility {
	const nodes = context.directSelection.filter(
		(target) => target.kind === "node",
	)
	if (nodes.length !== 2 || context.directSelection.length !== 2)
		return reject("Select exactly two open-path endpoints to join.")
	if (
		nodes[0]?.contourId === nodes[1]?.contourId &&
		nodes[0]?.pointId === nodes[1]?.pointId
	)
		return reject("Select two distinct open-path endpoints to join.")
	for (const node of nodes) {
		const object = context.document.objects.find(
			(candidate) => candidate.id === node.objectId,
		)
		if (object === undefined || object.geometry.kind !== "path")
			return reject("A selected path is unavailable.")
		if (object.locked)
			return reject(`Unlock ${object.name} before joining paths.`)
		const contour = object.geometry.contours.find(
			(candidate) => candidate.id === node.contourId,
		)
		if (contour === undefined || contour.closed)
			return reject("Join requires endpoints from open contours.")
		const index = contour.points.findIndex((point) => point.id === node.pointId)
		if (index !== 0 && index !== contour.points.length - 1)
			return reject(
				"Join requires the first or last node of each open contour.",
			)
	}
	if (nodes[0]?.objectId !== nodes[1]?.objectId) {
		const selectedObjects = nodes.map((node) =>
			context.document.objects.find((object) => object.id === node.objectId),
		)
		if (
			selectedObjects.some(
				(object) =>
					object?.geometry.kind !== "path" ||
					object.geometry.contours.length !== 1,
			)
		)
			return reject(
				"Join paths from separate objects only when each object has one contour.",
			)
	}
	return { eligible: true }
}

export function designPathCommandEligibility(
	command: DesignPathCommand,
	context: DesignPathCommandContext,
): DesignPathCommandEligibility {
	if (context.editingDisabledReason)
		return reject(context.editingDisabledReason)
	if (
		command === "pathfinder-unite" ||
		command === "pathfinder-subtract-front" ||
		command === "pathfinder-intersect" ||
		command === "pathfinder-exclude" ||
		command === "pathfinder-divide" ||
		command === "pathfinder-trim" ||
		command === "pathfinder-merge" ||
		command === "pathfinder-crop" ||
		command === "pathfinder-outline"
	)
		return pathfinderEligibility(command, context)
	if (command === "make-compound") return compoundEligibility(context)
	if (command === "release-compound") return releaseEligibility(context)
	if (command === "join") return joinEligibility(context)
	const base = editableContourEligibility(context)
	if (!base.eligible) return base
	const contours = selectedContours(context)
	if (command === "close" && contours.every(({ contour }) => contour.closed))
		return reject("Every selected contour is already closed.")
	if (
		command === "close" &&
		contours.some(({ contour }) => !contour.closed && contour.points.length < 3)
	)
		return reject("An open contour needs at least three points before closing.")
	if (
		command === "normalize-winding" &&
		contours.some(({ contour }) => !contour.closed)
	)
		return reject("Winding normalization requires closed contours.")
	return { eligible: true }
}

function reversePoint(point: DesignPoint): DesignPoint {
	return {
		id: point.id,
		x: point.x,
		y: point.y,
		...(point.outgoing === undefined
			? {}
			: { incoming: { ...point.outgoing } }),
		...(point.incoming === undefined
			? {}
			: { outgoing: { ...point.incoming } }),
	}
}

export function reverseDesignContour(contour: DesignContour): DesignContour {
	return { ...contour, points: contour.points.toReversed().map(reversePoint) }
}

function replaceSelectedContours(
	context: DesignPathCommandContext,
	replace: (contour: DesignContour, object: DesignObject) => DesignContour,
): DesignDocument {
	const keys = directContourKeys(
		context.directSelection.length > 0
			? context.directSelection
			: selectedContours(context).map(({ object, contour }) => ({
					kind: "contour" as const,
					objectId: object.id,
					contourId: contour.id,
				})),
	)
	const objects = context.document.objects.map((object) => {
		if (object.geometry.kind !== "path") return object
		const sourceContours = object.geometry.contours
		const contours = sourceContours.map((contour) =>
			keys.has(`${object.id}\0${contour.id}`)
				? replace(contour, object)
				: contour,
		)
		return contours.every((contour, index) => contour === sourceContours[index])
			? object
			: { ...object, geometry: { ...object.geometry, contours } }
	})
	return objects.every(
		(object, index) => object === context.document.objects[index],
	)
		? context.document
		: { ...context.document, objects }
}

const distance = (left: DesignPoint, right: DesignPoint): number =>
	Math.hypot(left.x - right.x, left.y - right.y)

function reversedForEndpoint(
	contour: DesignContour,
	pointId: string,
	desired: "first" | "last",
): DesignContour {
	const index = contour.points.findIndex((point) => point.id === pointId)
	const already =
		desired === "first" ? index === 0 : index === contour.points.length - 1
	return already ? contour : reverseDesignContour(contour)
}

function joinedOpenContour(
	firstSource: DesignContour,
	firstPointId: string,
	secondSource: DesignContour,
	secondPointId: string,
	tolerance: number,
): DesignContour | null {
	const first = reversedForEndpoint(firstSource, firstPointId, "last")
	const second = reversedForEndpoint(secondSource, secondPointId, "first")
	const left = first.points.at(-1)
	const right = second.points[0]
	if (left === undefined || right === undefined) return null
	const points =
		distance(left, right) <= tolerance
			? (() => {
					const { outgoing: _unusedOutgoing, ...joinedPoint } = left
					return [
						...first.points.slice(0, -1),
						{
							...joinedPoint,
							...(right.outgoing === undefined
								? {}
								: { outgoing: { ...right.outgoing } }),
						},
						...second.points.slice(1),
					]
				})()
			: [...first.points, ...second.points]
	return { ...first, points }
}

function joinEndpointsAcrossObjects(
	context: DesignPathCommandContext,
	firstTarget: Extract<DesignDirectSelectionTarget, { kind: "node" }>,
	secondTarget: Extract<DesignDirectSelectionTarget, { kind: "node" }>,
	tolerance: number,
): DesignPathCommandResult {
	const firstIndex = context.document.objects.findIndex(
		(object) => object.id === firstTarget.objectId,
	)
	const secondIndex = context.document.objects.findIndex(
		(object) => object.id === secondTarget.objectId,
	)
	const firstObject = context.document.objects[firstIndex]
	const secondObject = context.document.objects[secondIndex]
	if (
		firstObject === undefined ||
		secondObject === undefined ||
		firstObject.geometry.kind !== "path" ||
		secondObject.geometry.kind !== "path"
	)
		return { ok: false, error: "A selected path is unavailable." }
	const firstContour = projectDesignObjectContours(firstObject).find(
		(contour) => contour.id === firstTarget.contourId,
	)
	const secondContour = projectDesignObjectContours(secondObject).find(
		(contour) => contour.id === secondTarget.contourId,
	)
	if (firstContour === undefined || secondContour === undefined)
		return { ok: false, error: "A selected contour is unavailable." }
	const joined = joinedOpenContour(
		firstContour,
		firstTarget.pointId,
		secondContour,
		secondTarget.pointId,
		tolerance,
	)
	if (joined === null)
		return { ok: false, error: "Both contours need at least one point." }
	const survivor = firstIndex > secondIndex ? firstObject : secondObject
	const removed = survivor === firstObject ? secondObject : firstObject
	const updated: DesignObject = {
		...survivor,
		geometry: {
			kind: "path",
			fillRule: designObjectFillRule(survivor),
			contours: [joined],
		},
		transform: IDENTITY_DESIGN_TRANSFORM,
	}
	const document = replaceDesignHierarchySelection(
		{
			...context.document,
			objects: context.document.objects.flatMap((object) =>
				object.id === removed.id
					? []
					: [object.id === updated.id ? updated : object],
			),
		},
		[firstObject.id, secondObject.id],
		[updated.id],
		context.scopeGroupId,
	)
	if (document === null)
		return {
			ok: false,
			error: "Joining paths requires complete sibling objects or groups.",
		}
	return {
		ok: true,
		document,
		objectSelection: [updated.id],
		directSelection: [
			{ kind: "contour", objectId: updated.id, contourId: joined.id },
		],
		message: "Joined the selected open contours.",
	}
}

function joinSelectedEndpoints(
	context: DesignPathCommandContext,
	tolerance: number,
): DesignPathCommandResult {
	const [firstTarget, secondTarget] = context.directSelection
	if (firstTarget?.kind !== "node" || secondTarget?.kind !== "node")
		return {
			ok: false,
			error: "Select exactly two open-path endpoints to join.",
		}
	if (firstTarget.objectId !== secondTarget.objectId)
		return joinEndpointsAcrossObjects(
			context,
			firstTarget,
			secondTarget,
			tolerance,
		)
	const object = context.document.objects.find(
		(candidate) => candidate.id === firstTarget.objectId,
	)
	if (object === undefined || object.geometry.kind !== "path")
		return { ok: false, error: "The selected path is unavailable." }
	const firstIndex = object.geometry.contours.findIndex(
		(contour) => contour.id === firstTarget.contourId,
	)
	const secondIndex = object.geometry.contours.findIndex(
		(contour) => contour.id === secondTarget.contourId,
	)
	const firstSource = object.geometry.contours[firstIndex]
	const secondSource = object.geometry.contours[secondIndex]
	if (firstSource === undefined || secondSource === undefined)
		return { ok: false, error: "The selected contours are unavailable." }
	if (firstSource === secondSource) {
		const contour = { ...firstSource, closed: true }
		return {
			ok: true,
			document: replaceSelectedContours(context, () => contour),
			objectSelection: [object.id],
			directSelection: [
				{ kind: "contour", objectId: object.id, contourId: contour.id },
			],
			message: "Closed the selected contour.",
		}
	}
	const joined = joinedOpenContour(
		firstSource,
		firstTarget.pointId,
		secondSource,
		secondTarget.pointId,
		tolerance,
	)
	if (joined === null)
		return { ok: false, error: "Both contours need at least one point." }
	const removeIndex = secondIndex
	const keepIndex = firstIndex
	const updated: DesignObject = {
		...object,
		geometry: {
			...object.geometry,
			contours: object.geometry.contours.flatMap((contour, index) =>
				index === removeIndex ? [] : [index === keepIndex ? joined : contour],
			),
		},
	}
	return {
		ok: true,
		document: {
			...context.document,
			objects: context.document.objects.map((candidate) =>
				candidate.id === object.id ? updated : candidate,
			),
		},
		objectSelection: [object.id],
		directSelection: [
			{ kind: "contour", objectId: object.id, contourId: joined.id },
		],
		message: "Joined the selected open contours.",
	}
}

function cubic(from: DesignPoint, to: DesignPoint): Cubic {
	return {
		p0: from,
		c1: {
			x: from.x + (from.outgoing?.x ?? 0),
			y: from.y + (from.outgoing?.y ?? 0),
		},
		c2: {
			x: to.x + (to.incoming?.x ?? 0),
			y: to.y + (to.incoming?.y ?? 0),
		},
		p3: to,
	}
}

function flattenDesignContour(
	contour: DesignContour,
	flatness: number,
): readonly Readonly<{ x: number; y: number }>[] {
	const first = contour.points[0]
	if (first === undefined) return []
	const points: { x: number; y: number }[] = [first]
	const count = contour.closed
		? contour.points.length
		: Math.max(0, contour.points.length - 1)
	for (let index = 0; index < count; index += 1) {
		const from = contour.points[index]
		const to = contour.points[(index + 1) % contour.points.length]
		if (from === undefined || to === undefined) continue
		points.push(...flattenCubic(cubic(from, to), { flatness }).slice(1))
	}
	if (contour.closed) points.pop()
	return points
}

const vectorLength = (
	vector: Readonly<{ x: number; y: number }> | undefined,
): number => Math.hypot(vector?.x ?? 0, vector?.y ?? 0)

function zeroLengthSegment(
	from: DesignPoint,
	to: DesignPoint,
	tolerance: number,
): boolean {
	return (
		distance(from, to) <= tolerance &&
		vectorLength(from.outgoing) <= tolerance &&
		vectorLength(to.incoming) <= tolerance
	)
}

function outgoingAtAnchor(
	point: DesignPoint,
	anchor: DesignPoint,
): Readonly<{ x: number; y: number }> | undefined {
	return point.outgoing === undefined
		? undefined
		: {
				x: point.x + point.outgoing.x - anchor.x,
				y: point.y + point.outgoing.y - anchor.y,
			}
}

function incomingAtAnchor(
	point: DesignPoint,
	anchor: DesignPoint,
): Readonly<{ x: number; y: number }> | undefined {
	return point.incoming === undefined
		? undefined
		: {
				x: point.x + point.incoming.x - anchor.x,
				y: point.y + point.incoming.y - anchor.y,
			}
}

/** Removes only spans whose complete cubic control polygon is coincident. */
export function cleanupDesignContour(
	contour: DesignContour,
	tolerance = DEFAULT_PATH_CLEANUP_TOLERANCE,
): DesignContour {
	let points = [...contour.points]
	let changed = false
	while (points.length > 1) {
		let removed = false
		for (let index = 0; index + 1 < points.length; index += 1) {
			const from = points[index]
			const to = points[index + 1]
			if (
				from === undefined ||
				to === undefined ||
				!zeroLengthSegment(from, to, tolerance)
			)
				continue
			const outgoing = outgoingAtAnchor(to, from)
			const { outgoing: _previousOutgoing, ...withoutOutgoing } = from
			points.splice(index, 2, {
				...withoutOutgoing,
				...(outgoing === undefined ? {} : { outgoing }),
			})
			changed = true
			removed = true
			break
		}
		if (removed) continue
		const first = points[0]
		const last = points.at(-1)
		if (
			contour.closed &&
			first !== undefined &&
			last !== undefined &&
			zeroLengthSegment(last, first, tolerance)
		) {
			const incoming = incomingAtAnchor(last, first)
			const { incoming: _previousIncoming, ...withoutIncoming } = first
			points = [
				{
					...withoutIncoming,
					...(incoming === undefined ? {} : { incoming }),
				},
				...points.slice(1, -1),
			]
			changed = true
			continue
		}
		break
	}
	return changed ? { ...contour, points } : contour
}

function pointToSegmentDistance(
	point: Readonly<{ x: number; y: number }>,
	start: Readonly<{ x: number; y: number }>,
	end: Readonly<{ x: number; y: number }>,
): number {
	const x = end.x - start.x
	const y = end.y - start.y
	const denominator = x * x + y * y
	const amount =
		denominator === 0
			? 0
			: Math.max(
					0,
					Math.min(
						1,
						((point.x - start.x) * x + (point.y - start.y) * y) / denominator,
					),
				)
	return Math.hypot(
		start.x + amount * x - point.x,
		start.y + amount * y - point.y,
	)
}

function pointToPolylineDistance(
	point: Readonly<{ x: number; y: number }>,
	polyline: readonly Readonly<{ x: number; y: number }>[],
	closed: boolean,
): number {
	let result = Number.POSITIVE_INFINITY
	const count = polyline.length - (closed ? 0 : 1)
	for (let index = 0; index < count; index += 1) {
		const start = polyline[index]
		const end = polyline[(index + 1) % polyline.length]
		if (start !== undefined && end !== undefined)
			result = Math.min(result, pointToSegmentDistance(point, start, end))
	}
	return result
}

function directedPolylineWithin(
	from: readonly Readonly<{ x: number; y: number }>[],
	fromClosed: boolean,
	to: readonly Readonly<{ x: number; y: number }>[],
	toClosed: boolean,
	tolerance: number,
): boolean {
	if (to.length < 2) return false
	const count = from.length - (fromClosed ? 0 : 1)
	for (let index = 0; index < count; index += 1) {
		const start = from[index]
		const end = from[(index + 1) % from.length]
		if (start === undefined || end === undefined) continue
		const midpoint = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 }
		if (
			pointToPolylineDistance(start, to, toClosed) > tolerance ||
			pointToPolylineDistance(midpoint, to, toClosed) > tolerance
		)
			return false
	}
	return true
}

function nodeTurnDegrees(contour: DesignContour, index: number): number {
	if (!contour.closed && (index === 0 || index === contour.points.length - 1))
		return 180
	const previous =
		contour.points[(index - 1 + contour.points.length) % contour.points.length]
	const point = contour.points[index]
	const next = contour.points[(index + 1) % contour.points.length]
	if (previous === undefined || point === undefined || next === undefined)
		return 0
	const incoming =
		vectorLength(point.incoming) > 0
			? { x: -(point.incoming?.x ?? 0), y: -(point.incoming?.y ?? 0) }
			: { x: point.x - previous.x, y: point.y - previous.y }
	const outgoing =
		vectorLength(point.outgoing) > 0
			? (point.outgoing as Readonly<{ x: number; y: number }>)
			: { x: next.x - point.x, y: next.y - point.y }
	const incomingLength = Math.hypot(incoming.x, incoming.y)
	const outgoingLength = Math.hypot(outgoing.x, outgoing.y)
	if (incomingLength === 0 || outgoingLength === 0) return 180
	const cosine = Math.max(
		-1,
		Math.min(
			1,
			(incoming.x * outgoing.x + incoming.y * outgoing.y) /
				(incomingLength * outgoingLength),
		),
	)
	return (Math.acos(cosine) * 180) / Math.PI
}

function fittedContourPoints(
	pieces: readonly Cubic[],
	closed: boolean,
): readonly DesignPoint[] {
	if (closed)
		return pieces.map((piece, index) => {
			const previous = pieces[(index - 1 + pieces.length) % pieces.length]
			return {
				id: `__fit:${index}`,
				x: piece.p0.x,
				y: piece.p0.y,
				incoming: {
					x: (previous?.c2.x ?? piece.p0.x) - piece.p0.x,
					y: (previous?.c2.y ?? piece.p0.y) - piece.p0.y,
				},
				outgoing: { x: piece.c1.x - piece.p0.x, y: piece.c1.y - piece.p0.y },
			}
		})
	const points: DesignPoint[] = []
	for (const [index, piece] of pieces.entries()) {
		if (index === 0)
			points.push({
				id: "__fit:0",
				x: piece.p0.x,
				y: piece.p0.y,
				outgoing: { x: piece.c1.x - piece.p0.x, y: piece.c1.y - piece.p0.y },
			})
		const next = pieces[index + 1]
		points.push({
			id: `__fit:${index + 1}`,
			x: piece.p3.x,
			y: piece.p3.y,
			incoming: { x: piece.c2.x - piece.p3.x, y: piece.c2.y - piece.p3.y },
			...(next === undefined
				? {}
				: {
						outgoing: { x: next.c1.x - piece.p3.x, y: next.c1.y - piece.p3.y },
					}),
		})
	}
	return points
}

function validSimplification(
	source: DesignContour,
	candidate: DesignContour,
	maxError: number,
	cleanupTolerance: number,
): boolean {
	const validationFlatness = Math.max(cleanupTolerance, maxError / 16)
	const sourcePolyline = flattenDesignContour(source, validationFlatness)
	const candidatePolyline = flattenDesignContour(candidate, validationFlatness)
	if (
		selfIntersections(sourcePolyline, {
			closed: source.closed,
			tolerances: { distance: cleanupTolerance },
		}).length > 0 ||
		selfIntersections(candidatePolyline, {
			closed: candidate.closed,
			tolerances: { distance: cleanupTolerance },
		}).length > 0
	)
		return false
	if (
		!directedPolylineWithin(
			sourcePolyline,
			source.closed,
			candidatePolyline,
			candidate.closed,
			maxError,
		) ||
		!directedPolylineWithin(
			candidatePolyline,
			candidate.closed,
			sourcePolyline,
			source.closed,
			maxError,
		)
	)
		return false
	if (
		source.closed &&
		contourOrientation(sourcePolyline, { distance: cleanupTolerance }) !==
			contourOrientation(candidatePolyline, { distance: cleanupTolerance })
	)
		return false
	return source.points.every((point, index) =>
		nodeTurnDegrees(source, index) < 30
			? true
			: candidate.points.some(
					(candidatePoint) =>
						distance(point, candidatePoint) <= cleanupTolerance,
				),
	)
}

function assignFittedPointIds(
	points: readonly DesignPoint[],
	authored: readonly DesignPoint[],
	tolerance: number,
	nextId: () => string,
): readonly DesignPoint[] {
	const used = new Set<string>()
	return points.map((point) => {
		const match = authored.find(
			(candidate) =>
				!used.has(candidate.id) && distance(candidate, point) <= tolerance,
		)
		const id = match?.id ?? `point:${nextId()}`
		used.add(id)
		return { ...point, id }
	})
}

function simplifyDesignContour(
	contour: DesignContour,
	maxError: number,
	cleanupTolerance: number,
	nextId: () => string,
): DesignContour {
	const cleaned = cleanupDesignContour(contour, cleanupTolerance)
	const minimum = cleaned.closed ? 3 : 2
	if (cleaned.points.length < minimum) return cleaned
	const samplingBudget = maxError / 4
	const fittingBudget = maxError - samplingBudget
	const source = flattenDesignContour(cleaned, samplingBudget)
	if (
		selfIntersections(source, {
			closed: cleaned.closed,
			tolerances: { distance: cleanupTolerance },
		}).length > 0
	)
		return cleaned
	const pieces = fitCubicContour(
		{ points: source, closed: cleaned.closed },
		{
			maxError: fittingBudget,
			cornerAngleDegrees: 30,
			tolerances: { distance: cleanupTolerance },
		},
	)
	const candidateCount = cleaned.closed ? pieces.length : pieces.length + 1
	if (pieces.length === 0 || candidateCount >= cleaned.points.length)
		return cleaned
	const candidate: DesignContour = {
		...cleaned,
		points: fittedContourPoints(pieces, cleaned.closed),
	}
	if (!validSimplification(cleaned, candidate, maxError, cleanupTolerance))
		return cleaned
	return {
		...candidate,
		points: assignFittedPointIds(
			candidate.points,
			cleaned.points,
			cleanupTolerance,
			nextId,
		),
	}
}

function contourInDocument(
	document: DesignDocument,
	objectId: string,
	contourId: string,
): DesignContour | undefined {
	const object = document.objects.find((candidate) => candidate.id === objectId)
	return object?.geometry.kind === "path"
		? object.geometry.contours.find((contour) => contour.id === contourId)
		: undefined
}

function repairSimplifiedDirectSelection(
	context: DesignPathCommandContext,
	document: DesignDocument,
): readonly DesignDirectSelectionTarget[] {
	const repaired = context.directSelection.flatMap(
		(target): readonly DesignDirectSelectionTarget[] => {
			const before = contourInDocument(
				context.document,
				target.objectId,
				target.contourId,
			)
			const after = contourInDocument(
				document,
				target.objectId,
				target.contourId,
			)
			if (before === undefined || after === undefined) return []
			if (target.kind === "contour") return [target]
			if (target.kind === "node")
				return after.points.some((point) => point.id === target.pointId)
					? [target]
					: []
			if (target.kind === "handle") {
				const point = after.points.find(
					(candidate) => candidate.id === target.pointId,
				)
				return point?.[target.handle] === undefined ? [] : [target]
			}
			const beforeCount = before.closed
				? before.points.length
				: Math.max(0, before.points.length - 1)
			if (target.segmentIndex < 0 || target.segmentIndex >= beforeCount)
				return []
			const beforeFrom = before.points[target.segmentIndex]
			const beforeTo =
				before.points[(target.segmentIndex + 1) % before.points.length]
			if (beforeFrom === undefined || beforeTo === undefined) return []
			const afterCount = after.closed
				? after.points.length
				: Math.max(0, after.points.length - 1)
			for (let index = 0; index < afterCount; index += 1) {
				const afterFrom = after.points[index]
				const afterTo = after.points[(index + 1) % after.points.length]
				if (afterFrom?.id === beforeFrom.id && afterTo?.id === beforeTo.id)
					return [{ ...target, segmentIndex: index }]
			}
			return []
		},
	)
	return repaired.filter(
		(target, index) =>
			repaired.findIndex(
				(candidate) =>
					directSelectionKey(candidate) === directSelectionKey(target),
			) === index,
	)
}

function normalizeSelectedWinding(
	context: DesignPathCommandContext,
): DesignDocument {
	const references = selectedContours(context)
	const flattened = new Map<
		string,
		readonly Readonly<{ x: number; y: number }>[]
	>()
	for (const object of context.document.objects) {
		if (object.geometry.kind !== "path") continue
		for (const contour of object.geometry.contours) {
			if (!contour.closed) continue
			flattened.set(
				`${object.id}\0${contour.id}`,
				flattenDesignContour(contour, DEFAULT_PATH_SIMPLIFY_TOLERANCE / 4),
			)
		}
	}
	const depth = references.map((reference) => {
		const points =
			flattened.get(`${reference.object.id}\0${reference.contour.id}`) ?? []
		const probe = points[0]
		if (probe === undefined) return 0
		return reference.object.geometry.kind === "path"
			? reference.object.geometry.contours.reduce((sum, other) => {
					if (other.id === reference.contour.id || !other.closed) return sum
					const otherPoints =
						flattened.get(`${reference.object.id}\0${other.id}`) ?? []
					if (otherPoints.length < 3) return sum
					return (
						sum +
						(windingNumber(probe, otherPoints).classification === "inside"
							? 1
							: 0)
					)
				}, 0)
			: 0
	})
	const desired = references.map((_, index) =>
		(depth[index] ?? 0) % 2 === 0 ? "counter-clockwise" : "clockwise",
	)
	const byKey = new Map(
		references.map((reference, index) => {
			const orientation = contourOrientation(
				flattened.get(`${reference.object.id}\0${reference.contour.id}`) ?? [],
			)
			return [
				`${reference.object.id}\0${reference.contour.id}`,
				orientation !== "degenerate" && orientation !== desired[index]
					? reverseDesignContour(reference.contour)
					: reference.contour,
			] as const
		}),
	)
	const objects = context.document.objects.map((object) => {
		if (object.geometry.kind !== "path") return object
		const sourceContours = object.geometry.contours
		const contours = sourceContours.map(
			(contour) => byKey.get(`${object.id}\0${contour.id}`) ?? contour,
		)
		return contours.every((contour, index) => contour === sourceContours[index])
			? object
			: { ...object, geometry: { ...object.geometry, contours } }
	})
	return objects.every(
		(object, index) => object === context.document.objects[index],
	)
		? context.document
		: { ...context.document, objects }
}

function makeCompound(
	context: DesignPathCommandContext,
): DesignPathCommandResult {
	const selected = new Set(context.objectSelection)
	const entries = context.document.objects.flatMap((object, index) =>
		selected.has(object.id) ? [{ object, index }] : [],
	)
	const survivor = entries.at(-1)
	if (survivor === undefined)
		return { ok: false, error: "The selected paths are unavailable." }
	const contours = entries.flatMap(({ object }) =>
		projectDesignObjectContours(object),
	)
	const compound: DesignObject = {
		...survivor.object,
		name: `Compound ${survivor.object.name}`,
		geometry: { kind: "path", fillRule: "evenodd", contours },
		transform: IDENTITY_DESIGN_TRANSFORM,
	}
	const document = replaceDesignHierarchySelection(
		{
			...context.document,
			objects: context.document.objects.flatMap((object) =>
				object.id === compound.id
					? [compound]
					: selected.has(object.id)
						? []
						: [object],
			),
		},
		context.objectSelection,
		[compound.id],
		context.scopeGroupId,
	)
	if (document === null)
		return {
			ok: false,
			error: "Compound paths require complete sibling objects or groups.",
		}
	return {
		ok: true,
		document,
		objectSelection: [compound.id],
		directSelection: [],
		message: `Made a compound path from ${entries.length} objects.`,
	}
}

function releaseCompound(
	context: DesignPathCommandContext,
	nextId: () => string,
): DesignPathCommandResult {
	const index = context.document.objects.findIndex(
		(object) => object.id === context.objectSelection[0],
	)
	const object = context.document.objects[index]
	if (object === undefined || object.geometry.kind !== "path")
		return { ok: false, error: "The selected compound path is unavailable." }
	const released = object.geometry.contours.map(
		(contour, contourIndex): DesignObject => ({
			...object,
			id: contourIndex === 0 ? object.id : `object:${nextId()}`,
			name: `${object.name} ${contourIndex + 1}`,
			geometry: {
				kind: "path",
				fillRule: designObjectFillRule(object),
				contours: [contour],
			},
		}),
	)
	const document = replaceDesignHierarchySelection(
		{
			...context.document,
			objects: [
				...context.document.objects.slice(0, index),
				...released,
				...context.document.objects.slice(index + 1),
			],
		},
		context.objectSelection,
		released.map(({ id }) => id),
		context.scopeGroupId,
	)
	if (document === null)
		return { ok: false, error: "The compound path hierarchy is unavailable." }
	return {
		ok: true,
		document,
		objectSelection: released.map(({ id }) => id),
		directSelection: [],
		message: `Released ${released.length} paths from the compound path.`,
	}
}

function pathfinderContour(
	contour: Readonly<{
		closed: true
		points: readonly Readonly<{ x: number; y: number }>[]
	}>,
	fitTolerance: number,
	nextId: () => string,
): DesignContour {
	const pieces = fitCubicContour(contour, {
		maxError: fitTolerance,
		cornerAngleDegrees: 30,
		tolerances: { distance: DEFAULT_PATH_CLEANUP_TOLERANCE },
	})
	if (pieces.length === 0)
		throw new Error("Pathfinder could not fit editable output geometry.")
	return {
		id: `contour:${nextId()}`,
		closed: true,
		points: fittedContourPoints(pieces, true).map((point) => ({
			...point,
			id: `point:${nextId()}`,
		})),
	}
}

type DesignPathfinderCommand = Extract<
	DesignPathCommand,
	| "pathfinder-exclude"
	| "pathfinder-intersect"
	| "pathfinder-subtract-front"
	| "pathfinder-unite"
>

type DesignPartitionPathfinderCommand = Extract<
	DesignPathCommand,
	| "pathfinder-crop"
	| "pathfinder-divide"
	| "pathfinder-merge"
	| "pathfinder-outline"
	| "pathfinder-trim"
>

function pathfinderLabel(command: DesignPathfinderCommand): string {
	switch (command) {
		case "pathfinder-unite":
			return "Unite"
		case "pathfinder-subtract-front":
			return "Subtract Front"
		case "pathfinder-intersect":
			return "Intersect"
		case "pathfinder-exclude":
			return "Exclude"
	}
}

function pathfinderSuccessMessage(
	command: DesignPathfinderCommand,
	objectCount: number,
): string {
	switch (command) {
		case "pathfinder-unite":
			return `United ${objectCount} filled objects.`
		case "pathfinder-subtract-front":
			return `Subtracted ${objectCount - 1} front object${objectCount === 2 ? "" : "s"}.`
		case "pathfinder-intersect":
			return `Intersected ${objectCount} filled objects.`
		case "pathfinder-exclude":
			return `Excluded even coverage across ${objectCount} filled objects.`
	}
}

function applyPathfinder(
	command: DesignPathfinderCommand,
	context: DesignPathCommandContext,
	tolerance: number,
	nextId: () => string,
): DesignPathCommandResult {
	const selectedIds = new Set(context.objectSelection)
	const entries = context.document.objects.filter((object) =>
		selectedIds.has(object.id),
	)
	const subtract = command === "pathfinder-subtract-front"
	const survivor = subtract ? entries[0] : entries.at(-1)
	if (survivor === undefined)
		return {
			ok: false,
			error: "The selected Pathfinder objects are unavailable.",
		}
	const inputFlatness = tolerance / 4
	const fittingTolerance = tolerance - inputFlatness
	try {
		const regions = entries.map((object) =>
			resolveFilledContours(
				projectDesignObjectContours(object).map((contour) => ({
					closed: true,
					points: flattenDesignContour(contour, inputFlatness),
				})),
				{
					fillRule: designObjectFillRule(object),
					tolerances: { normalization: DEFAULT_PATH_CLEANUP_TOLERANCE },
				},
			),
		)
		let resolved: ReturnType<typeof booleanContours>
		if (subtract) {
			resolved = booleanContours([regions[0] ?? []], {
				operation: "difference",
				clips: regions.slice(1),
				tolerances: { normalization: DEFAULT_PATH_CLEANUP_TOLERANCE },
			})
		} else {
			const operation =
				command === "pathfinder-unite"
					? "union"
					: command === "pathfinder-intersect"
						? "intersection"
						: "xor"
			resolved = booleanContours(regions, {
				operation,
				tolerances: { normalization: DEFAULT_PATH_CLEANUP_TOLERANCE },
			})
		}
		const contours = resolved.map((contour) =>
			pathfinderContour(
				{ closed: true, points: contour.points },
				fittingTolerance,
				nextId,
			),
		)
		const result: DesignObject | undefined =
			contours.length === 0
				? undefined
				: {
						...survivor,
						name: `${pathfinderLabel(command)} ${survivor.name}`,
						geometry: { kind: "path", fillRule: "evenodd", contours },
						transform: IDENTITY_DESIGN_TRANSFORM,
					}
		const document = replaceDesignHierarchySelection(
			{
				...context.document,
				objects: context.document.objects.flatMap((object) =>
					object.id === survivor.id
						? result === undefined
							? []
							: [result]
						: selectedIds.has(object.id)
							? []
							: [object],
				),
			},
			context.objectSelection,
			result === undefined ? [] : [result.id],
			context.scopeGroupId,
		)
		if (document === null)
			return {
				ok: false,
				error: "Pathfinder requires complete sibling objects or groups.",
			}
		return {
			ok: true,
			document,
			objectSelection: result === undefined ? [] : [result.id],
			directSelection: [],
			message:
				result === undefined
					? `${pathfinderLabel(command)} produced an empty filled region.`
					: pathfinderSuccessMessage(command, entries.length),
		}
	} catch (error) {
		return {
			ok: false,
			error:
				error instanceof Error
					? error.message
					: "Pathfinder could not resolve the selected fills.",
		}
	}
}

type PathfinderEntry = Readonly<{
	object: DesignObject
}>

type OrderedPathfinderObject = Readonly<{
	object: DesignObject
	sourceIndex: number
	geometryOrder: number
}>

function pathfinderEntries(
	context: DesignPathCommandContext,
): readonly PathfinderEntry[] {
	const selectedIds = new Set(context.objectSelection)
	return context.document.objects.flatMap((object) =>
		selectedIds.has(object.id) ? [{ object }] : [],
	)
}

function pathfinderRegions(
	entries: readonly PathfinderEntry[],
	inputFlatness: number,
): readonly (readonly Readonly<{
	readonly closed: boolean
	readonly points: readonly Readonly<{ x: number; y: number }>[]
}>[])[] {
	return entries.map(({ object }) =>
		resolveFilledContours(
			projectDesignObjectContours(object).map((contour) => ({
				closed: true,
				points: flattenDesignContour(contour, inputFlatness),
			})),
			{
				fillRule: designObjectFillRule(object),
				tolerances: { normalization: DEFAULT_PATH_CLEANUP_TOLERANCE },
			},
		),
	)
}

function filledAppearance(object: DesignObject): DesignObject["appearance"] {
	return object.appearance.fill === undefined
		? {}
		: { fill: object.appearance.fill }
}

function freshFilledPathfinderObject(
	source: DesignObject,
	label: string,
	contours: readonly Readonly<{
		closed: boolean
		points: readonly Readonly<{ x: number; y: number }>[]
	}>[],
	fitTolerance: number,
	appearance: DesignObject["appearance"],
	nextId: () => string,
): DesignObject {
	const id = `object:${nextId()}`
	return {
		...source,
		id,
		name: `${label} ${source.name}`,
		geometry: {
			kind: "path",
			fillRule: "evenodd",
			contours: contours.map((contour) =>
				pathfinderContour(
					{ closed: true, points: contour.points },
					fitTolerance,
					nextId,
				),
			),
		},
		transform: IDENTITY_DESIGN_TRANSFORM,
		appearance,
	}
}

function installPartitionPathfinderResult(
	context: DesignPathCommandContext,
	ordered: readonly OrderedPathfinderObject[],
	message: string,
): DesignPathCommandResult {
	const replacements = ordered
		.toSorted(
			(left, right) =>
				left.sourceIndex - right.sourceIndex ||
				left.geometryOrder - right.geometryOrder,
		)
		.map(({ object }) => object)
	const selectedIds = new Set(context.objectSelection)
	const insertionIndex = context.document.objects.findLastIndex((object) =>
		selectedIds.has(object.id),
	)
	const document = replaceDesignHierarchySelection(
		{
			...context.document,
			objects: context.document.objects.flatMap((object, index) =>
				index === insertionIndex
					? replacements
					: selectedIds.has(object.id)
						? []
						: [object],
			),
		},
		context.objectSelection,
		replacements.map(({ id }) => id),
		context.scopeGroupId,
	)
	if (document === null)
		return {
			ok: false,
			error: "Pathfinder requires complete sibling objects or groups.",
		}
	return {
		ok: true,
		document,
		objectSelection: replacements.map(({ id }) => id),
		directSelection: [],
		message,
	}
}

function partitionLabel(command: DesignPartitionPathfinderCommand): string {
	switch (command) {
		case "pathfinder-divide":
			return "Divide"
		case "pathfinder-trim":
			return "Trim"
		case "pathfinder-merge":
			return "Merge"
		case "pathfinder-crop":
			return "Crop"
		case "pathfinder-outline":
			return "Outline"
	}
}

function partitionSuccessMessage(
	command: DesignPartitionPathfinderCommand,
	pieceCount: number,
): string {
	const label = partitionLabel(command)
	return pieceCount === 0
		? `${label} produced an empty result.`
		: `${label} produced ${pieceCount} editable path${pieceCount === 1 ? "" : "s"}.`
}

function topContributor(
	contributors: readonly number[],
	maximum = Number.POSITIVE_INFINITY,
): number | undefined {
	return contributors.findLast((index) => index < maximum)
}

type PathfinderPartition = ReturnType<typeof partitionContours>[number]

function filledPartitionObjects(
	command: "pathfinder-crop" | "pathfinder-divide" | "pathfinder-trim",
	partitions: readonly PathfinderPartition[],
	entries: readonly PathfinderEntry[],
	fitTolerance: number,
	nextId: () => string,
): readonly OrderedPathfinderObject[] {
	const maskIndex = entries.length - 1
	return partitions.flatMap((partition, geometryOrder) => {
		const sourceIndex =
			command === "pathfinder-crop"
				? partition.contributors.includes(maskIndex)
					? topContributor(partition.contributors, maskIndex)
					: undefined
				: topContributor(partition.contributors)
		if (sourceIndex === undefined) return []
		const source = entries[sourceIndex]?.object
		if (source === undefined) return []
		return [
			{
				object: freshFilledPathfinderObject(
					source,
					partitionLabel(command),
					partition.contours,
					fitTolerance,
					command === "pathfinder-divide"
						? source.appearance
						: filledAppearance(source),
					nextId,
				),
				sourceIndex,
				geometryOrder,
			},
		]
	})
}

function mergedPartitionObjects(
	partitions: readonly PathfinderPartition[],
	entries: readonly PathfinderEntry[],
	fitTolerance: number,
	nextId: () => string,
): readonly OrderedPathfinderObject[] {
	const groups = new Map<
		string,
		{
			pieces: PathfinderPartition[]
			sourceIndexes: Set<number>
		}
	>()
	for (const partition of partitions) {
		const sourceIndex = topContributor(partition.contributors)
		const source =
			sourceIndex === undefined ? undefined : entries[sourceIndex]?.object
		const swatchId = source?.appearance.fill?.swatchId
		if (sourceIndex === undefined || swatchId === undefined) continue
		const group = groups.get(swatchId) ?? {
			pieces: [],
			sourceIndexes: new Set<number>(),
		}
		group.pieces.push(partition)
		group.sourceIndexes.add(sourceIndex)
		groups.set(swatchId, group)
	}
	let geometryOrder = 0
	return [...groups.entries()].flatMap(([swatchId, group]) => {
		const sourceIndex = Math.max(...group.sourceIndexes)
		const source = entries[sourceIndex]?.object
		if (source === undefined) return []
		const united = booleanContours(
			group.pieces.map(({ contours }) => contours),
			{
				operation: "union",
				tolerances: { normalization: DEFAULT_PATH_CLEANUP_TOLERANCE },
			},
		)
		return partitionContours([united], {
			tolerances: { normalization: DEFAULT_PATH_CLEANUP_TOLERANCE },
		}).map(({ contours }) => ({
			object: freshFilledPathfinderObject(
				source,
				"Merge",
				contours,
				fitTolerance,
				{ fill: { swatchId } },
				nextId,
			),
			sourceIndex,
			geometryOrder: geometryOrder++,
		}))
	})
}

type OutlineSegment = {
	readonly start: Readonly<{ x: number; y: number }>
	readonly end: Readonly<{ x: number; y: number }>
	readonly contributors: readonly number[]
}

function comparePathfinderPoints(
	left: Readonly<{ x: number; y: number }>,
	right: Readonly<{ x: number; y: number }>,
): number {
	return left.x - right.x || left.y - right.y
}

function outlineSegments(
	partitions: readonly PathfinderPartition[],
): readonly OutlineSegment[] {
	const raw: OutlineSegment[] = []
	for (const partition of partitions)
		for (const contour of partition.contours)
			for (const [index, point] of contour.points.entries()) {
				const next = contour.points[(index + 1) % contour.points.length]
				if (next === undefined) continue
				const [start, end] =
					comparePathfinderPoints(point, next) <= 0
						? [point, next]
						: [next, point]
				raw.push({ start, end, contributors: partition.contributors })
			}
	const points = new Map<string, Readonly<{ x: number; y: number }>>()
	for (const segment of raw)
		for (const point of [segment.start, segment.end])
			points.set(`${point.x},${point.y}`, point)
	const segments = new Map<string, OutlineSegment>()
	for (const segment of raw) {
		const noded = [...points.values()]
			.filter((point) =>
				pointOnSegment(point, segment.start, segment.end, {
					distance: DEFAULT_PATH_CLEANUP_TOLERANCE,
				}),
			)
			.toSorted(comparePathfinderPoints)
		for (let index = 0; index + 1 < noded.length; index += 1) {
			const start = noded[index]
			const end = noded[index + 1]
			if (start === undefined || end === undefined) continue
			const key = `${start.x},${start.y}\0${end.x},${end.y}`
			const previous = segments.get(key)
			segments.set(key, {
				start,
				end,
				contributors: [
					...new Set([
						...(previous?.contributors ?? []),
						...segment.contributors,
					]),
				].toSorted((left, right) => left - right),
			})
		}
	}
	return [...segments.values()].toSorted(
		(left, right) =>
			comparePathfinderPoints(left.start, right.start) ||
			comparePathfinderPoints(left.end, right.end),
	)
}

function outlinePartitionObjects(
	partitions: readonly PathfinderPartition[],
	entries: readonly PathfinderEntry[],
	nextId: () => string,
): readonly OrderedPathfinderObject[] {
	return outlineSegments(partitions).flatMap((segment, geometryOrder) => {
		const sourceIndex = topContributor(segment.contributors)
		const source =
			sourceIndex === undefined ? undefined : entries[sourceIndex]?.object
		const swatchId = source?.appearance.fill?.swatchId
		if (
			sourceIndex === undefined ||
			source === undefined ||
			swatchId === undefined
		)
			return []
		const id = `object:${nextId()}`
		const contourId = `contour:${nextId()}`
		const object: DesignObject = {
			...source,
			id,
			name: `Outline ${source.name}`,
			geometry: {
				kind: "path",
				contours: [
					{
						id: contourId,
						closed: false,
						points: [segment.start, segment.end].map((point) => ({
							...point,
							id: `point:${nextId()}`,
						})),
					},
				],
			},
			transform: IDENTITY_DESIGN_TRANSFORM,
			appearance: {
				stroke: source.appearance.stroke ?? {
					...DEFAULT_DESIGN_STROKE_STYLE,
					swatchId,
					width: 1,
				},
			},
		}
		return [{ object, sourceIndex, geometryOrder }]
	})
}

function applyPartitionPathfinder(
	command: DesignPartitionPathfinderCommand,
	context: DesignPathCommandContext,
	tolerance: number,
	nextId: () => string,
	options: DesignPathCommandOptions,
): DesignPathCommandResult {
	const entries = pathfinderEntries(context)
	const inputFlatness = tolerance / 4
	const fittingTolerance = tolerance - inputFlatness
	try {
		const partitions = partitionContours(
			pathfinderRegions(entries, inputFlatness),
			{
				tolerances: { normalization: DEFAULT_PATH_CLEANUP_TOLERANCE },
				...(options.pathfinderSignal === undefined
					? {}
					: { signal: options.pathfinderSignal }),
				...(options.onPathfinderProgress === undefined
					? {}
					: { onProgress: options.onPathfinderProgress }),
			},
		)
		const objects =
			command === "pathfinder-merge"
				? mergedPartitionObjects(partitions, entries, fittingTolerance, nextId)
				: command === "pathfinder-outline"
					? outlinePartitionObjects(partitions, entries, nextId)
					: filledPartitionObjects(
							command,
							partitions,
							entries,
							fittingTolerance,
							nextId,
						)
		return installPartitionPathfinderResult(
			context,
			objects,
			partitionSuccessMessage(command, objects.length),
		)
	} catch (error) {
		return {
			ok: false,
			error:
				error instanceof Error
					? error.message
					: "Pathfinder could not partition the selected fills.",
		}
	}
}

export function applyDesignPathCommand(
	command: DesignPathCommand,
	context: DesignPathCommandContext,
	options: DesignPathCommandOptions = {},
): DesignPathCommandResult {
	const eligibility = designPathCommandEligibility(command, context)
	if (!eligibility.eligible) return { ok: false, error: eligibility.reason }
	const cleanupTolerance =
		options.cleanupTolerance ?? DEFAULT_PATH_CLEANUP_TOLERANCE
	const simplifyTolerance =
		options.simplifyTolerance ?? DEFAULT_PATH_SIMPLIFY_TOLERANCE
	const pathfinderTolerance =
		options.pathfinderTolerance ?? DEFAULT_PATHFINDER_TOLERANCE
	if (!(cleanupTolerance >= 0) || !Number.isFinite(cleanupTolerance))
		return {
			ok: false,
			error: "Cleanup tolerance must be finite and non-negative.",
		}
	if (!(simplifyTolerance > 0) || !Number.isFinite(simplifyTolerance))
		return {
			ok: false,
			error: "Simplify tolerance must be finite and positive.",
		}
	if (!(pathfinderTolerance > 0) || !Number.isFinite(pathfinderTolerance))
		return {
			ok: false,
			error: "Pathfinder tolerance must be finite and positive.",
		}
	const nextId = options.nextId ?? (() => crypto.randomUUID())
	if (
		command === "pathfinder-unite" ||
		command === "pathfinder-subtract-front" ||
		command === "pathfinder-intersect" ||
		command === "pathfinder-exclude"
	)
		return applyPathfinder(command, context, pathfinderTolerance, nextId)
	if (
		command === "pathfinder-divide" ||
		command === "pathfinder-trim" ||
		command === "pathfinder-merge" ||
		command === "pathfinder-crop" ||
		command === "pathfinder-outline"
	)
		return applyPartitionPathfinder(
			command,
			context,
			pathfinderTolerance,
			nextId,
			options,
		)
	if (command === "join")
		return joinSelectedEndpoints(context, cleanupTolerance)
	if (command === "make-compound") return makeCompound(context)
	if (command === "release-compound") return releaseCompound(context, nextId)
	let document: DesignDocument
	try {
		document =
			command === "reverse"
				? replaceSelectedContours(context, reverseDesignContour)
				: command === "close"
					? replaceSelectedContours(context, (contour) => ({
							...contour,
							closed: true,
						}))
					: command === "normalize-winding"
						? normalizeSelectedWinding(context)
						: replaceSelectedContours(context, (contour) =>
								simplifyDesignContour(
									contour,
									simplifyTolerance,
									cleanupTolerance,
									nextId,
								),
							)
	} catch (error) {
		return {
			ok: false,
			error: error instanceof Error ? error.message : "Path cleanup failed.",
		}
	}
	return {
		ok: true,
		document,
		objectSelection: context.objectSelection,
		directSelection:
			command === "simplify"
				? repairSimplifiedDirectSelection(context, document)
				: context.directSelection,
		message:
			command === "reverse"
				? "Reversed the selected paths."
				: command === "close"
					? "Closed the selected paths."
					: command === "normalize-winding"
						? "Normalized selected outer and hole winding."
						: `Simplified selected paths within ${simplifyTolerance} document units.`,
	}
}
