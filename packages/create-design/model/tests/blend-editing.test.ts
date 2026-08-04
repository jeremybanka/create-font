import { describe, expect, it } from "vitest"
import { createInitialDocument } from "@create-design/source"

import { createDesignBlend, resolveDesignBlend } from "../src/blends.ts"
import {
	expandDesignBlend,
	reverseDesignBlendEndpoint,
	setDesignBlendFirstPoint,
	updateDesignBlend,
} from "../src/blend-editing.ts"
import type { DesignDocument } from "@create-design/source"

const ids = () => {
	let value = 0
	return () => `model-${++value}`
}

function blended(paths = false): DesignDocument {
	const initial = createInitialDocument()
	const objects = paths
		? initial.objects.slice(0, 2).map((object, objectIndex) => ({
				...object,
				geometry: {
					kind: "path" as const,
					contours: [
						{
							id: `contour:${objectIndex}`,
							closed: true,
							points: [
								{ id: `point:${objectIndex}:0`, x: 0, y: 0 },
								{ id: `point:${objectIndex}:1`, x: 20, y: 0 },
								{ id: `point:${objectIndex}:2`, x: 20, y: 20 },
								{ id: `point:${objectIndex}:3`, x: 0, y: 20 },
							],
						},
					],
				},
			}))
		: initial.objects.slice(0, 2)
	const document: DesignDocument = { ...initial, objects }
	return {
		...document,
		blends: [
			createDesignBlend(
				"blend:editing",
				"Editing",
				objects[0]!,
				objects[1]!,
				3,
			),
		],
	}
}

describe("headless blend editing", () => {
	it("updates options and correspondence without changing live identity", () => {
		const document = blended(true)
		const blend = document.blends![0]!
		const configured = updateDesignBlend(document, blend.id, { steps: 8 })!
		expect(configured.blends![0]).toMatchObject({ id: blend.id, steps: 8 })
		const start = configured.objects[0]!
		if (start.geometry.kind !== "path") throw new Error("Expected path.")
		const shifted = setDesignBlendFirstPoint(
			configured,
			blend.id,
			"start",
			start.geometry.contours[0]!.id,
			start.geometry.contours[0]!.points[2]!.id,
		)!
		expect(resolveDesignBlend(shifted, shifted.blends![0]!).status).toBe(
			"ready",
		)
		expect(shifted.blends![0]!.contours[0]!.points[0]!.startPointId).toBe(
			start.geometry.contours[0]!.points[2]!.id,
		)
		expect(
			reverseDesignBlendEndpoint(shifted, blend.id, "start"),
		).not.toBeNull()
	})

	it("expands fresh intermediates in place while retaining endpoints", () => {
		const document = blended()
		const blend = document.blends![0]!
		const result = expandDesignBlend(document, blend.id, ids())!
		expect(result.selection).toHaveLength(3)
		expect(result.document.blends).toEqual([])
		expect(
			[blend.startObjectId, blend.endObjectId].every((id) =>
				result.document.objects.some((object) => object.id === id),
			),
		).toBe(true)
		expect(new Set(result.document.objects.map(({ id }) => id)).size).toBe(
			result.document.objects.length,
		)
	})
})
