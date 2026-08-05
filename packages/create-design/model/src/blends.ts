import type { Bounds } from "@create-art/vector-geometry"
import type {
	ColorDefinition,
	DesignAppearance,
	DesignBlend,
	DesignBlendContourCorrespondence,
	DesignContour,
	DesignDocument,
	DesignObject,
	DesignPoint,
	DesignStroke,
	DesignSwatch,
	DesignTransform,
	RgbColor,
} from "@create-design/source"

import { cmykToRgb, normalizeColor } from "./color.ts"
import { geometryContours, objectBounds } from "./geometry.ts"

export type DesignBlendDiagnosticCode =
	| "blend.endpoint.same"
	| "blend.endpoint.missing"
	| "blend.endpoint.hidden"
	| "blend.contour.count"
	| "blend.contour.missing"
	| "blend.contour.closed"
	| "blend.contour.direction"
	| "blend.contour.first-point"
	| "blend.point.count"
	| "blend.point.missing"
	| "blend.appearance.fill-rule"
	| "blend.appearance.missing-swatch"
	| "blend.appearance.missing-fill"
	| "blend.appearance.missing-stroke"
	| "blend.appearance.stroke-dash"
	| "blend.appearance.stroke-style"

export interface DesignBlendDiagnostic {
	readonly blendId: string
	readonly code: DesignBlendDiagnosticCode
	readonly message: string
	readonly severity: "error" | "warning" | "info"
}

export interface ResolvedDesignBlend {
	readonly blend: DesignBlend
	readonly diagnostics: readonly DesignBlendDiagnostic[]
	readonly objects: readonly DesignObject[]
	readonly status: "ready" | "hidden" | "error"
	readonly swatches: readonly DesignSwatch[]
}

export interface DesignBlendProjection {
	readonly diagnostics: readonly DesignBlendDiagnostic[]
	readonly objects: readonly DesignObject[]
	readonly swatches: readonly DesignSwatch[]
}

export interface DesignBlendClipboardPayload {
	readonly format: "create-design.blends"
	readonly version: 1
	readonly blends: readonly DesignBlend[]
	readonly objects: readonly DesignObject[]
	readonly swatches: readonly DesignSwatch[]
}

const lerp = (start: number, end: number, amount: number): number =>
	start + (end - start) * amount

const diagnostic = (
	blend: DesignBlend,
	code: DesignBlendDiagnosticCode,
	severity: DesignBlendDiagnostic["severity"],
	message: string,
): DesignBlendDiagnostic =>
	Object.freeze({ blendId: blend.id, code, severity, message })

function contourMap(object: DesignObject): ReadonlyMap<string, DesignContour> {
	return new Map(
		geometryContours(object.geometry, object.id).map((contour) => [
			contour.id,
			contour,
		]),
	)
}

function signedArea(contour: DesignContour): number {
	if (!contour.closed || contour.points.length < 3) return 0
	let twiceArea = 0
	for (let index = 0; index < contour.points.length; index += 1) {
		const point = contour.points[index]!
		const next = contour.points[(index + 1) % contour.points.length]!
		twiceArea += point.x * next.y - next.x * point.y
	}
	return twiceArea / 2
}

function validateCorrespondence(
	blend: DesignBlend,
	start: DesignObject,
	end: DesignObject,
): readonly DesignBlendDiagnostic[] {
	const diagnostics: DesignBlendDiagnostic[] = []
	const startContours = geometryContours(start.geometry, start.id)
	const endContours = geometryContours(end.geometry, end.id)
	if (
		startContours.length !== endContours.length ||
		blend.contours.length !== startContours.length
	)
		diagnostics.push(
			diagnostic(
				blend,
				"blend.contour.count",
				"error",
				`Blend ${blend.name || blend.id} requires equal contour counts and one persisted correspondence per contour (${startContours.length}, ${endContours.length}, ${blend.contours.length}).`,
			),
		)
	const starts = contourMap(start)
	const ends = contourMap(end)
	for (const correspondence of blend.contours) {
		const first = starts.get(correspondence.startContourId)
		const second = ends.get(correspondence.endContourId)
		if (first === undefined || second === undefined) {
			diagnostics.push(
				diagnostic(
					blend,
					"blend.contour.missing",
					"error",
					`Blend correspondence references a missing contour (${correspondence.startContourId}, ${correspondence.endContourId}).`,
				),
			)
			continue
		}
		if (first.closed !== second.closed)
			diagnostics.push(
				diagnostic(
					blend,
					"blend.contour.closed",
					"error",
					`Contours ${first.id} and ${second.id} disagree on open/closed topology.`,
				),
			)
		if (
			first.points.length !== second.points.length ||
			correspondence.points.length !== first.points.length
		)
			diagnostics.push(
				diagnostic(
					blend,
					"blend.point.count",
					"error",
					`Contours ${first.id} and ${second.id} require equal point counts and complete correspondence (${first.points.length}, ${second.points.length}, ${correspondence.points.length}).`,
				),
			)
		const firstArea = signedArea(first)
		const secondArea = signedArea(second)
		if (
			firstArea !== 0 &&
			secondArea !== 0 &&
			Math.sign(firstArea) !== Math.sign(secondArea)
		)
			diagnostics.push(
				diagnostic(
					blend,
					"blend.contour.direction",
					"error",
					`Contours ${first.id} and ${second.id} run in opposite directions.`,
				),
			)
		const startById = new Map(
			first.points.map((point, index) => [point.id, index]),
		)
		const endById = new Map(
			second.points.map((point, index) => [point.id, index]),
		)
		const mapped = correspondence.points.map((pair) => ({
			start: startById.get(pair.startPointId),
			end: endById.get(pair.endPointId),
		}))
		if (
			mapped.some(({ start: a, end: b }) => a === undefined || b === undefined)
		)
			diagnostics.push(
				diagnostic(
					blend,
					"blend.point.missing",
					"error",
					`A point correspondence for contours ${first.id} and ${second.id} no longer resolves.`,
				),
			)
		else if (
			mapped.some(({ start: a, end: b }, index) => a !== index || b !== index)
		)
			diagnostics.push(
				diagnostic(
					blend,
					"blend.contour.first-point",
					"error",
					`Contours ${first.id} and ${second.id} no longer share the persisted first point and forward point order.`,
				),
			)
	}
	const startRule =
		start.geometry.kind === "path"
			? (start.geometry.fillRule ?? "evenodd")
			: "evenodd"
	const endRule =
		end.geometry.kind === "path"
			? (end.geometry.fillRule ?? "evenodd")
			: "evenodd"
	if (startRule !== endRule)
		diagnostics.push(
			diagnostic(
				blend,
				"blend.appearance.fill-rule",
				"error",
				"Blend endpoints use incompatible fill rules.",
			),
		)
	return diagnostics
}

/** Captures the current contour and point ordering as explicit correspondence. */
export function createDesignBlend(
	id: string,
	name: string,
	start: DesignObject,
	end: DesignObject,
	steps: number,
): DesignBlend {
	if (!Number.isInteger(steps) || steps < 1 || steps > 10_000)
		throw new RangeError("Blend steps must be an integer from 1 through 10000.")
	const endContours = geometryContours(end.geometry, end.id)
	return {
		id,
		name,
		startObjectId: start.id,
		endObjectId: end.id,
		steps,
		contours: geometryContours(start.geometry, start.id).flatMap(
			(contour, index): readonly DesignBlendContourCorrespondence[] => {
				const other = endContours[index]
				return other === undefined
					? []
					: [
							{
								startContourId: contour.id,
								endContourId: other.id,
								points: contour.points.flatMap((point, pointIndex) => {
									const otherPoint = other.points[pointIndex]
									return otherPoint === undefined
										? []
										: [{ startPointId: point.id, endPointId: otherPoint.id }]
								}),
							},
						]
			},
		),
	}
}

function interpolateVector(
	start: Readonly<{ x: number; y: number }> | undefined,
	end: Readonly<{ x: number; y: number }> | undefined,
	amount: number,
): Readonly<{ x: number; y: number }> | undefined {
	if (start === undefined && end === undefined) return undefined
	return {
		x: lerp(start?.x ?? 0, end?.x ?? 0, amount),
		y: lerp(start?.y ?? 0, end?.y ?? 0, amount),
	}
}

function interpolatePoint(
	id: string,
	start: DesignPoint,
	end: DesignPoint,
	amount: number,
): DesignPoint {
	const incoming = interpolateVector(start.incoming, end.incoming, amount)
	const outgoing = interpolateVector(start.outgoing, end.outgoing, amount)
	return {
		id,
		x: lerp(start.x, end.x, amount),
		y: lerp(start.y, end.y, amount),
		...(incoming === undefined ? {} : { incoming }),
		...(outgoing === undefined ? {} : { outgoing }),
	}
}

function interpolateTransform(
	start: DesignTransform,
	end: DesignTransform,
	amount: number,
): DesignTransform {
	return {
		a: lerp(start.a, end.a, amount),
		b: lerp(start.b, end.b, amount),
		c: lerp(start.c, end.c, amount),
		d: lerp(start.d, end.d, amount),
		e: lerp(start.e, end.e, amount),
		f: lerp(start.f, end.f, amount),
	}
}

function rgb(color: ColorDefinition): RgbColor {
	return color.space === "rgb"
		? (normalizeColor(color) as RgbColor)
		: cmykToRgb(color)
}

function interpolateColor(
	start: ColorDefinition,
	end: ColorDefinition,
	amount: number,
): ColorDefinition {
	if (start.space === "cmyk" && end.space === "cmyk")
		return normalizeColor({
			space: "cmyk",
			c: lerp(start.c, end.c, amount),
			m: lerp(start.m, end.m, amount),
			y: lerp(start.y, end.y, amount),
			k: lerp(start.k, end.k, amount),
		})
	const first = rgb(start)
	const second = rgb(end)
	return normalizeColor({
		space: "rgb",
		r: lerp(first.r, second.r, amount),
		g: lerp(first.g, second.g, amount),
		b: lerp(first.b, second.b, amount),
	})
}

function strokeStyleDiagnostics(
	blend: DesignBlend,
	start: DesignStroke,
	end: DesignStroke,
): readonly DesignBlendDiagnostic[] {
	const diagnostics: DesignBlendDiagnostic[] = []
	if (start.dashArray.length !== end.dashArray.length)
		diagnostics.push(
			diagnostic(
				blend,
				"blend.appearance.stroke-dash",
				"error",
				"Blend endpoint stroke dash arrays have incompatible lengths.",
			),
		)
	if (start.cap !== end.cap || start.join !== end.join)
		diagnostics.push(
			diagnostic(
				blend,
				"blend.appearance.stroke-style",
				"warning",
				"Stroke cap and join transitions switch deterministically at the midpoint.",
			),
		)
	return diagnostics
}

function appearanceDiagnostics(
	document: DesignDocument,
	blend: DesignBlend,
	start: DesignObject,
	end: DesignObject,
): readonly DesignBlendDiagnostic[] {
	const diagnostics: DesignBlendDiagnostic[] = []
	for (const [kind, first, second] of [
		["fill", start.appearance.fill, end.appearance.fill],
		["stroke", start.appearance.stroke, end.appearance.stroke],
	] as const) {
		if ((first === undefined) !== (second === undefined))
			diagnostics.push(
				diagnostic(
					blend,
					kind === "fill"
						? "blend.appearance.missing-fill"
						: "blend.appearance.missing-stroke",
					"warning",
					`${kind === "fill" ? "Fill" : "Stroke"} presence switches deterministically at the midpoint.`,
				),
			)
		for (const paint of [first, second]) {
			if (
				paint !== undefined &&
				!document.swatches.some(({ id }) => id === paint.swatchId)
			)
				diagnostics.push(
					diagnostic(
						blend,
						"blend.appearance.missing-swatch",
						"error",
						`Blend endpoint references missing swatch ${paint.swatchId}.`,
					),
				)
		}
	}
	if (
		start.appearance.stroke !== undefined &&
		end.appearance.stroke !== undefined
	)
		diagnostics.push(
			...strokeStyleDiagnostics(
				blend,
				start.appearance.stroke,
				end.appearance.stroke,
			),
		)
	return diagnostics
}

function interpolatedSwatch(
	document: DesignDocument,
	blend: DesignBlend,
	kind: "fill" | "stroke",
	startId: string,
	endId: string,
	amount: number,
	step: number,
): DesignSwatch | null {
	const start = document.swatches.find(({ id }) => id === startId)
	const end = document.swatches.find(({ id }) => id === endId)
	if (start === undefined || end === undefined) return null
	return {
		id: `swatch:${blend.id}:step:${step}:${kind}`,
		name: `${blend.name || blend.id} ${kind} ${step}`,
		source: interpolateColor(start.source, end.source, amount),
	}
}

function interpolateStroke(
	start: DesignStroke,
	end: DesignStroke,
	amount: number,
	swatchId: string,
): DesignStroke {
	const discrete = amount < 0.5 ? start : end
	return {
		swatchId,
		width: lerp(start.width, end.width, amount),
		cap: discrete.cap,
		join: discrete.join,
		miterLimit: lerp(start.miterLimit, end.miterLimit, amount),
		dashArray: start.dashArray.map((value, index) =>
			lerp(value, end.dashArray[index] ?? value, amount),
		),
		dashOffset: lerp(start.dashOffset, end.dashOffset, amount),
	}
}

function interpolateAppearance(
	document: DesignDocument,
	blend: DesignBlend,
	start: DesignObject,
	end: DesignObject,
	amount: number,
	step: number,
): Readonly<{
	appearance: DesignAppearance
	swatches: readonly DesignSwatch[]
}> {
	const swatches: DesignSwatch[] = []
	const fill = (() => {
		const first = start.appearance.fill
		const second = end.appearance.fill
		if (first === undefined || second === undefined)
			return amount < 0.5 ? first : second
		const swatch = interpolatedSwatch(
			document,
			blend,
			"fill",
			first.swatchId,
			second.swatchId,
			amount,
			step,
		)
		if (swatch === null) return undefined
		swatches.push(swatch)
		return { swatchId: swatch.id }
	})()
	const stroke = (() => {
		const first = start.appearance.stroke
		const second = end.appearance.stroke
		if (first === undefined || second === undefined)
			return amount < 0.5 ? first : second
		const swatch = interpolatedSwatch(
			document,
			blend,
			"stroke",
			first.swatchId,
			second.swatchId,
			amount,
			step,
		)
		if (swatch === null) return undefined
		swatches.push(swatch)
		return interpolateStroke(first, second, amount, swatch.id)
	})()
	return {
		appearance: {
			...(fill === undefined ? {} : { fill }),
			...(stroke === undefined ? {} : { stroke }),
		},
		swatches,
	}
}

function interpolateContours(
	blend: DesignBlend,
	start: DesignObject,
	end: DesignObject,
	amount: number,
	step: number,
): readonly DesignContour[] {
	const starts = contourMap(start)
	const ends = contourMap(end)
	return blend.contours.map((correspondence, contourIndex) => {
		const first = starts.get(correspondence.startContourId)!
		const second = ends.get(correspondence.endContourId)!
		const startPoints = new Map(first.points.map((point) => [point.id, point]))
		const endPoints = new Map(second.points.map((point) => [point.id, point]))
		return {
			id: `${blend.id}:step:${step}:contour:${contourIndex}`,
			closed: first.closed,
			points: correspondence.points.map((pair, pointIndex) =>
				interpolatePoint(
					`${blend.id}:step:${step}:contour:${contourIndex}:point:${pointIndex}`,
					startPoints.get(pair.startPointId)!,
					endPoints.get(pair.endPointId)!,
					amount,
				),
			),
		}
	})
}

/** Resolves a live blend without mutating the document or authoring intermediates. */
export function resolveDesignBlend(
	document: DesignDocument,
	blend: DesignBlend,
): ResolvedDesignBlend {
	const start = document.objects.find(({ id }) => id === blend.startObjectId)
	const end = document.objects.find(({ id }) => id === blend.endObjectId)
	if (start === undefined || end === undefined) {
		return {
			blend,
			status: "error",
			objects: [],
			swatches: [],
			diagnostics: [
				diagnostic(
					blend,
					"blend.endpoint.missing",
					"error",
					`Blend ${blend.name || blend.id} references a missing endpoint (${blend.startObjectId}, ${blend.endObjectId}).`,
				),
			],
		}
	}
	if (start.id === end.id) {
		return {
			blend,
			status: "error",
			objects: [],
			swatches: [],
			diagnostics: [
				diagnostic(
					blend,
					"blend.endpoint.same",
					"error",
					"A blend requires two different endpoint objects.",
				),
			],
		}
	}
	if (blend.hidden || start.hidden || end.hidden) {
		return {
			blend,
			status: "hidden",
			objects: [],
			swatches: [],
			diagnostics: [
				diagnostic(
					blend,
					"blend.endpoint.hidden",
					"info",
					"A hidden blend or endpoint suppresses all derived intermediate steps.",
				),
			],
		}
	}
	const diagnostics = [
		...validateCorrespondence(blend, start, end),
		...appearanceDiagnostics(document, blend, start, end),
	]
	if (diagnostics.some(({ severity }) => severity === "error"))
		return { blend, status: "error", diagnostics, objects: [], swatches: [] }
	const objects: DesignObject[] = []
	const swatches: DesignSwatch[] = []
	for (let index = 1; index <= blend.steps; index += 1) {
		const amount = index / (blend.steps + 1)
		const appearance = interpolateAppearance(
			document,
			blend,
			start,
			end,
			amount,
			index,
		)
		swatches.push(...appearance.swatches)
		objects.push({
			id: `object:${blend.id}:step:${index}`,
			name: `${blend.name || blend.id} ${index}/${blend.steps}`,
			geometry: {
				kind: "path",
				...(start.geometry.kind === "path" &&
				start.geometry.fillRule !== undefined
					? { fillRule: start.geometry.fillRule }
					: {}),
				contours: interpolateContours(blend, start, end, amount, index),
			},
			transform: interpolateTransform(start.transform, end.transform, amount),
			appearance: appearance.appearance,
			...(blend.locked || start.locked || end.locked ? { locked: true } : {}),
		})
	}
	return { blend, status: "ready", diagnostics, objects, swatches }
}

/**
 * Projects all blends into paint order. Derived steps are inserted immediately
 * before the later-painted endpoint, so endpoint reordering predictably moves
 * the blend while preserving endpoint references.
 */
export function projectDesignDocumentBlends(
	document: DesignDocument,
): DesignBlendProjection {
	const resolutions = (document.blends ?? []).map((blend) =>
		resolveDesignBlend(document, blend),
	)
	const objectIndex = new Map(
		document.objects.map(({ id }, index) => [id, index]),
	)
	const insertions = new Map<number, DesignObject[]>()
	for (const resolution of resolutions) {
		const start = objectIndex.get(resolution.blend.startObjectId)
		const end = objectIndex.get(resolution.blend.endObjectId)
		if (
			start === undefined ||
			end === undefined ||
			resolution.objects.length === 0
		)
			continue
		const insertion = Math.max(start, end)
		const prior = insertions.get(insertion) ?? []
		insertions.set(insertion, [...prior, ...resolution.objects])
	}
	return {
		objects: document.objects.flatMap((object, index) => [
			...(insertions.get(index) ?? []),
			object,
		]),
		swatches: [
			...document.swatches,
			...resolutions.flatMap(({ swatches }) => swatches),
		],
		diagnostics: resolutions.flatMap(({ diagnostics }) => diagnostics),
	}
}

export function designBlendBounds(
	document: DesignDocument,
	blend: DesignBlend,
): Bounds | null {
	const bounds = resolveDesignBlend(document, blend).objects.flatMap(
		(object) => {
			const value = objectBounds(object)
			return value === null ? [] : [value]
		},
	)
	if (bounds.length === 0) return null
	return {
		minX: Math.min(...bounds.map(({ minX }) => minX)),
		minY: Math.min(...bounds.map(({ minY }) => minY)),
		maxX: Math.max(...bounds.map(({ maxX }) => maxX)),
		maxY: Math.max(...bounds.map(({ maxY }) => maxY)),
	}
}

/** Blends are selectable as one unit; locked/hidden blends and endpoints are not. */
export function selectableDesignBlendIds(
	document: DesignDocument,
): readonly string[] {
	return (document.blends ?? []).flatMap((blend) => {
		const start = document.objects.find(({ id }) => id === blend.startObjectId)
		const end = document.objects.find(({ id }) => id === blend.endObjectId)
		return blend.hidden ||
			blend.locked ||
			start?.hidden ||
			start?.locked ||
			end?.hidden ||
			end?.locked
			? []
			: [blend.id]
	})
}

/**
 * Captures complete live blend units for native clipboard serialization.
 * Endpoint objects and referenced swatches travel with each selected blend.
 */
export function copyDesignBlendSelection(
	document: DesignDocument,
	blendIds: readonly string[],
): DesignBlendClipboardPayload | null {
	const selected = new Set(blendIds)
	const blends = (document.blends ?? []).filter(({ id }) => selected.has(id))
	if (blends.length === 0) return null
	const endpointIds = new Set(
		blends.flatMap(({ startObjectId, endObjectId }) => [
			startObjectId,
			endObjectId,
		]),
	)
	const objects = document.objects.filter(({ id }) => endpointIds.has(id))
	const swatchIds = new Set(
		objects.flatMap(({ appearance }) => [
			...(appearance.fill === undefined ? [] : [appearance.fill.swatchId]),
			...(appearance.stroke === undefined ? [] : [appearance.stroke.swatchId]),
		]),
	)
	return {
		format: "create-design.blends",
		version: 1,
		blends,
		objects,
		swatches: document.swatches.filter(({ id }) => swatchIds.has(id)),
	}
}

/** Pastes blend endpoints and live records as one deterministic document edit. */
export function pasteDesignBlendSelection(
	document: DesignDocument,
	payload: DesignBlendClipboardPayload,
	nextId: () => string,
	offset: Readonly<{ x: number; y: number }> = { x: 12, y: 12 },
): Readonly<{ document: DesignDocument; blendIds: readonly string[] }> | null {
	if (
		payload.format !== "create-design.blends" ||
		payload.version !== 1 ||
		payload.blends.length === 0
	)
		return null
	const swatchIds = new Map<string, string>()
	const additions: DesignSwatch[] = []
	for (const swatch of payload.swatches) {
		const existing = document.swatches.find(({ id }) => id === swatch.id)
		if (existing === undefined) {
			swatchIds.set(swatch.id, swatch.id)
			additions.push(swatch)
		} else if (JSON.stringify(existing) === JSON.stringify(swatch)) {
			swatchIds.set(swatch.id, swatch.id)
		} else {
			const id = `swatch:${nextId()}`
			swatchIds.set(swatch.id, id)
			additions.push({ ...swatch, id, name: `${swatch.name} copy` })
		}
	}
	const objectIds = new Map<string, string>()
	const contourIds = new Map<string, string>()
	const pointIds = new Map<string, string>()
	const scoped = (objectId: string, entityId: string) =>
		`${objectId}\u0000${entityId}`
	const objects = payload.objects.map((object) => {
		const id = `object:${nextId()}`
		objectIds.set(object.id, id)
		const geometry =
			object.geometry.kind !== "path"
				? object.geometry
				: {
						...object.geometry,
						contours: object.geometry.contours.map((contour) => {
							const contourId = `contour:${nextId()}`
							contourIds.set(scoped(object.id, contour.id), contourId)
							return {
								...contour,
								id: contourId,
								points: contour.points.map((point) => {
									const pointId = `point:${nextId()}`
									pointIds.set(scoped(object.id, point.id), pointId)
									return { ...point, id: pointId }
								}),
							}
						}),
					}
		const clone: DesignObject = {
			...object,
			id,
			geometry,
			transform: {
				...object.transform,
				e: object.transform.e + offset.x,
				f: object.transform.f + offset.y,
			},
			appearance: {
				...(object.appearance.fill === undefined
					? {}
					: {
							fill: {
								swatchId:
									swatchIds.get(object.appearance.fill.swatchId) ??
									object.appearance.fill.swatchId,
							},
						}),
				...(object.appearance.stroke === undefined
					? {}
					: {
							stroke: {
								...object.appearance.stroke,
								swatchId:
									swatchIds.get(object.appearance.stroke.swatchId) ??
									object.appearance.stroke.swatchId,
							},
						}),
			},
		}
		if (object.geometry.kind !== "path") {
			const originalContours = geometryContours(object.geometry, object.id)
			const clonedContours = geometryContours(clone.geometry, clone.id)
			for (const [index, original] of originalContours.entries()) {
				const cloned = clonedContours[index]
				if (cloned === undefined) continue
				contourIds.set(scoped(object.id, original.id), cloned.id)
				for (const [pointIndex, point] of original.points.entries()) {
					const clonedPoint = cloned.points[pointIndex]
					if (clonedPoint !== undefined)
						pointIds.set(scoped(object.id, point.id), clonedPoint.id)
				}
			}
		}
		return clone
	})
	const blends = payload.blends.flatMap((blend) => {
		const startObjectId = objectIds.get(blend.startObjectId)
		const endObjectId = objectIds.get(blend.endObjectId)
		if (startObjectId === undefined || endObjectId === undefined) return []
		return [
			{
				...blend,
				id: `blend:${nextId()}`,
				name: `${blend.name} copy`,
				startObjectId,
				endObjectId,
				contours: blend.contours.map((contour) => ({
					startContourId:
						contourIds.get(
							scoped(blend.startObjectId, contour.startContourId),
						) ?? contour.startContourId,
					endContourId:
						contourIds.get(scoped(blend.endObjectId, contour.endContourId)) ??
						contour.endContourId,
					points: contour.points.map((point) => ({
						startPointId:
							pointIds.get(scoped(blend.startObjectId, point.startPointId)) ??
							point.startPointId,
						endPointId:
							pointIds.get(scoped(blend.endObjectId, point.endPointId)) ??
							point.endPointId,
					})),
				})),
			},
		]
	})
	if (blends.length === 0) return null
	const targetLayer = document.layers.at(-1)
	if (targetLayer === undefined) return null
	return {
		document: {
			...document,
			swatches: [...document.swatches, ...additions],
			objects: [...document.objects, ...objects],
			blends: [...(document.blends ?? []), ...blends],
			layers: document.layers.map((layer) =>
				layer.id === targetLayer.id
					? {
							...layer,
							children: [
								...layer.children,
								...objects.map(({ id }) => ({
									kind: "object" as const,
									id,
								})),
							],
						}
					: layer,
			),
		},
		blendIds: blends.map(({ id }) => id),
	}
}
