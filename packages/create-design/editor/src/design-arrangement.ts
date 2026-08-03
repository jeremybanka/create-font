import {
	rotateObject,
	scaleObject,
	translateObject,
} from "@create-design/model"
import { visibleObjectBounds } from "@create-design/model"
import { selectionBounds } from "./design-selection.ts"
import { designSelectionUnits } from "./design-hierarchy.ts"
import type { DesignArtboard, DesignDocument, DesignObject } from "./types.ts"

export type DesignAlignment =
	| "left"
	| "center"
	| "right"
	| "top"
	| "middle"
	| "bottom"
export type DesignAlignmentTarget = "selection" | "key-object" | "artboard"
export type DesignTransformOrigin =
	| "top-left"
	| "top"
	| "top-right"
	| "left"
	| "center"
	| "right"
	| "bottom-left"
	| "bottom"
	| "bottom-right"

type Bounds = NonNullable<ReturnType<typeof visibleObjectBounds>>

const selected = (document: DesignDocument, ids: readonly string[]) => {
	const set = new Set(ids)
	return document.objects.filter(
		(object) => set.has(object.id) && !object.hidden && !object.locked,
	)
}

const boundsOf = (objects: readonly DesignObject[]) => selectionBounds(objects)

const targetBounds = (
	document: DesignDocument,
	objects: readonly DesignObject[],
	target: DesignAlignmentTarget,
	artboard: DesignArtboard,
	keyObjectId?: string,
): Bounds | null => {
	if (target === "artboard")
		return {
			minX: artboard.x,
			minY: artboard.y,
			maxX: artboard.x + artboard.width,
			maxY: artboard.y + artboard.height,
		}
	if (target === "key-object") {
		const key = document.objects.find((object) => object.id === keyObjectId)
		return key === undefined ? null : visibleObjectBounds(key)
	}
	return boundsOf(objects)
}

export function alignDesignObjects(
	document: DesignDocument,
	objectIds: readonly string[],
	alignment: DesignAlignment,
	target: DesignAlignmentTarget,
	artboard: DesignArtboard,
	keyObjectId?: string,
): DesignDocument | null {
	const objects = selected(document, objectIds)
	const targetValue = targetBounds(
		document,
		objects,
		target,
		artboard,
		keyObjectId,
	)
	if (objects.length === 0 || targetValue === null) return null
	const byId = new Map(objects.map((object) => [object.id, object]))
	const units = designSelectionUnits(
		document,
		objects.map((object) => object.id),
	)
	const moved = new Map(
		units.flatMap((ids) => {
			const members = ids.flatMap((id) => {
				const object = byId.get(id)
				return object === undefined ? [] : [object]
			})
			const bounds = boundsOf(members)
			if (bounds === null) return []
			const dx =
				alignment === "left"
					? targetValue.minX - bounds.minX
					: alignment === "center"
						? (targetValue.minX +
								targetValue.maxX -
								bounds.minX -
								bounds.maxX) /
							2
						: alignment === "right"
							? targetValue.maxX - bounds.maxX
							: 0
			const dy =
				alignment === "top"
					? targetValue.minY - bounds.minY
					: alignment === "middle"
						? (targetValue.minY +
								targetValue.maxY -
								bounds.minY -
								bounds.maxY) /
							2
						: alignment === "bottom"
							? targetValue.maxY - bounds.maxY
							: 0
			return members.map(
				(object) => [object.id, translateObject(object, dx, dy)] as const,
			)
		}),
	)
	return {
		...document,
		objects: document.objects.map((object) => moved.get(object.id) ?? object),
	}
}

export function distributeDesignObjects(
	document: DesignDocument,
	objectIds: readonly string[],
	axis: "x" | "y",
): DesignDocument | null {
	const objects = selected(document, objectIds)
	const byId = new Map(objects.map((object) => [object.id, object]))
	const items = designSelectionUnits(
		document,
		objects.map((object) => object.id),
	)
		.flatMap((ids, index) => {
			const members = ids.flatMap((id) => {
				const object = byId.get(id)
				return object === undefined ? [] : [object]
			})
			const bounds = boundsOf(members)
			return bounds === null ? [] : [{ objects: members, bounds, index }]
		})
		.toSorted((left, right) => {
			const a = axis === "x" ? left.bounds.minX : left.bounds.minY
			const b = axis === "x" ? right.bounds.minX : right.bounds.minY
			return a - b || left.index - right.index
		})
	if (items.length < 3) return null
	const start = axis === "x" ? items[0]!.bounds.minX : items[0]!.bounds.minY
	const end =
		axis === "x" ? items.at(-1)!.bounds.maxX : items.at(-1)!.bounds.maxY
	const sizes = items.map(({ bounds }) =>
		axis === "x" ? bounds.maxX - bounds.minX : bounds.maxY - bounds.minY,
	)
	const gap =
		(end - start - sizes.reduce((sum, size) => sum + size, 0)) /
		(items.length - 1)
	let cursor = start
	const moved = new Map<string, DesignObject>()
	for (const [index, item] of items.entries()) {
		const current = axis === "x" ? item.bounds.minX : item.bounds.minY
		if (index !== 0 && index !== items.length - 1) {
			const delta = cursor - current
			for (const object of item.objects)
				moved.set(
					object.id,
					translateObject(
						object,
						axis === "x" ? delta : 0,
						axis === "y" ? delta : 0,
					),
				)
		}
		cursor += sizes[index]! + gap
	}
	return {
		...document,
		objects: document.objects.map((object) => moved.get(object.id) ?? object),
	}
}

const originPoint = (bounds: Bounds, origin: DesignTransformOrigin) => ({
	x:
		origin.endsWith("left") || origin === "left"
			? bounds.minX
			: origin.endsWith("right") || origin === "right"
				? bounds.maxX
				: (bounds.minX + bounds.maxX) / 2,
	y:
		origin.startsWith("top") || origin === "top"
			? bounds.minY
			: origin.startsWith("bottom") || origin === "bottom"
				? bounds.maxY
				: (bounds.minY + bounds.maxY) / 2,
})

export function transformDesignSelection(
	document: DesignDocument,
	objectIds: readonly string[],
	input: Readonly<{
		x?: number
		y?: number
		width?: number
		height?: number
		rotation?: number
		origin: DesignTransformOrigin
		constrainProportions?: boolean
	}>,
): DesignDocument | null {
	if (
		![input.x, input.y, input.width, input.height, input.rotation]
			.filter((value) => value !== undefined)
			.every(Number.isFinite)
	)
		return null
	const objects = selected(document, objectIds)
	const bounds = boundsOf(objects)
	if (objects.length === 0 || bounds === null) return null
	const width = bounds.maxX - bounds.minX
	const height = bounds.maxY - bounds.minY
	if (
		(input.width !== undefined && (input.width < 0 || width === 0)) ||
		(input.height !== undefined && (input.height < 0 || height === 0))
	)
		return null
	const anchor = originPoint(bounds, input.origin)
	let sx = input.width === undefined ? 1 : input.width / width
	let sy = input.height === undefined ? 1 : input.height / height
	if (input.constrainProportions) {
		const factor = input.width !== undefined ? sx : sy
		sx = factor
		sy = factor
	}
	const scaled = objects.map((object) => scaleObject(object, anchor, sx, sy))
	const rotated =
		input.rotation === undefined
			? scaled
			: scaled.map((object) => rotateObject(object, anchor, input.rotation!))
	const projected = boundsOf(rotated)
	if (projected === null) return null
	const positioned = originPoint(projected, input.origin)
	const dx = input.x === undefined ? 0 : input.x - positioned.x
	const dy = input.y === undefined ? 0 : input.y - positioned.y
	const moved = new Map(
		rotated.map((object) => [object.id, translateObject(object, dx, dy)]),
	)
	return {
		...document,
		objects: document.objects.map((object) => moved.get(object.id) ?? object),
	}
}
