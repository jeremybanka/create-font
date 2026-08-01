import {
	contourOrientation,
	fitCubicContour,
	flattenCubic,
	windingNumber,
	type Cubic,
} from "@create-art/vector-geometry"

import type { DesignDirectSelectionTarget } from "./design-selection.ts"
import {
	IDENTITY_DESIGN_TRANSFORM,
	projectDesignObjectContours,
} from "./geometry.ts"
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

export type DesignPathCommand =
	| "close"
	| "join"
	| "make-compound"
	| "normalize-winding"
	| "release-compound"
	| "reverse"
	| "simplify"

export interface DesignPathCommandContext {
	readonly document: DesignDocument
	readonly objectSelection: readonly string[]
	readonly directSelection: readonly DesignDirectSelectionTarget[]
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
	return {
		...context.document,
		objects: context.document.objects.map((object) =>
			object.geometry.kind !== "path"
				? object
				: {
						...object,
						geometry: {
							kind: "path" as const,
							contours: object.geometry.contours.map((contour) =>
								keys.has(`${object.id}\0${contour.id}`)
									? replace(contour, object)
									: contour,
							),
						},
					},
		),
	}
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
		geometry: { kind: "path", contours: [joined] },
		transform: IDENTITY_DESIGN_TRANSFORM,
	}
	return {
		ok: true,
		document: {
			...context.document,
			objects: context.document.objects.flatMap((object) =>
				object.id === removed.id
					? []
					: [object.id === updated.id ? updated : object],
			),
		},
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
			kind: "path",
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

function fittedPoints(
	contour: DesignContour,
	maxError: number,
	cleanupTolerance: number,
	nextId: () => string,
): readonly DesignPoint[] {
	const samplingBudget = maxError / 4
	const fittingBudget = maxError - samplingBudget
	const source = flattenDesignContour(contour, samplingBudget)
	const pieces = fitCubicContour(
		{ points: source, closed: contour.closed },
		{
			maxError: fittingBudget,
			cornerAngleDegrees: 30,
			tolerances: { distance: cleanupTolerance },
		},
	)
	if (pieces.length === 0) return contour.points
	const authoredId = (point: Readonly<{ x: number; y: number }>): string => {
		const match = contour.points.find(
			(candidate) =>
				Math.hypot(candidate.x - point.x, candidate.y - point.y) <=
				cleanupTolerance,
		)
		return match?.id ?? `point:${nextId()}`
	}
	if (contour.closed)
		return pieces.map((piece, index) => {
			const previous = pieces[(index - 1 + pieces.length) % pieces.length]
			return {
				id: authoredId(piece.p0),
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
				id: authoredId(piece.p0),
				x: piece.p0.x,
				y: piece.p0.y,
				outgoing: { x: piece.c1.x - piece.p0.x, y: piece.c1.y - piece.p0.y },
			})
		const next = pieces[index + 1]
		points.push({
			id: authoredId(piece.p3),
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
	return {
		...context.document,
		objects: context.document.objects.map((object) =>
			object.geometry.kind !== "path"
				? object
				: {
						...object,
						geometry: {
							kind: "path" as const,
							contours: object.geometry.contours.map(
								(contour) =>
									byKey.get(`${object.id}\0${contour.id}`) ?? contour,
							),
						},
					},
		),
	}
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
		geometry: { kind: "path", contours },
		transform: IDENTITY_DESIGN_TRANSFORM,
	}
	return {
		ok: true,
		document: {
			...context.document,
			objects: context.document.objects.flatMap((object) =>
				object.id === compound.id
					? [compound]
					: selected.has(object.id)
						? []
						: [object],
			),
		},
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
			geometry: { kind: "path", contours: [contour] },
		}),
	)
	return {
		ok: true,
		document: {
			...context.document,
			objects: [
				...context.document.objects.slice(0, index),
				...released,
				...context.document.objects.slice(index + 1),
			],
		},
		objectSelection: released.map(({ id }) => id),
		directSelection: [],
		message: `Released ${released.length} paths from the compound path.`,
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
	const nextId = options.nextId ?? (() => crypto.randomUUID())
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
						: replaceSelectedContours(context, (contour) => ({
								...contour,
								points: fittedPoints(
									contour,
									simplifyTolerance,
									cleanupTolerance,
									nextId,
								),
							}))
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
		directSelection: context.directSelection,
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
