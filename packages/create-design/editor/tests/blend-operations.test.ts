import { resolveDesignBlend } from "@create-design/model"
import { describe, expect, it } from "vitest"

import {
	designBlendEligibility,
	expandDesignBlend,
	makeDesignBlend,
	reverseDesignBlendEndpoint,
	setDesignBlendFirstPoint,
	updateDesignBlend,
} from "../src/blend-operations.ts"
import { expandDesignShape } from "../src/shape-expansion.ts"
import { createInitialDocument } from "../src/document.ts"
import type { DesignDocument } from "../src/types.ts"

const ids = () => {
	let value = 0
	return () => `test-${++value}`
}

function liveBlendDocument(): DesignDocument {
	const document = createInitialDocument()
	const result = makeDesignBlend(
		document,
		document.objects.slice(0, 2).map(({ id }) => id),
		ids(),
		3,
	)
	if (result === null) throw new Error("Expected compatible initial objects.")
	return result.document
}

describe("user-facing live blend operations", () => {
	it("explains invalid selections and creates a ready persisted blend", () => {
		const initial = createInitialDocument()
		expect(designBlendEligibility(initial, [])).toEqual({
			eligible: false,
			reason: "Select exactly two ordinary objects to make a blend.",
		})
		const result = makeDesignBlend(
			initial,
			initial.objects.slice(0, 2).map(({ id }) => id),
			ids(),
			7,
		)
		expect(result?.document.blends?.[0]?.steps).toBe(7)
		expect(
			resolveDesignBlend(result!.document, result!.document.blends![0]!).status,
		).toBe("ready")
	})

	it("updates specified steps without replacing endpoint or blend identities", () => {
		const document = liveBlendDocument()
		const blend = document.blends![0]!
		const next = updateDesignBlend(document, blend.id, { steps: 12 })!
		expect(next.blends![0]).toMatchObject({
			id: blend.id,
			startObjectId: blend.startObjectId,
			endObjectId: blend.endObjectId,
			steps: 12,
		})
		expect(resolveDesignBlend(next, next.blends![0]!).objects).toHaveLength(12)
	})

	it("reverses path endpoint handles and rotates a closed first point", () => {
		const initial = createInitialDocument()
		const nextId = ids()
		const paths = initial.objects
			.slice(0, 2)
			.map((object) => expandDesignShape(object, nextId))
		const document: DesignDocument = { ...initial, objects: paths }
		const made = makeDesignBlend(
			document,
			paths.map(({ id }) => id),
			nextId,
			2,
		)!
		const blend = made.document.blends![0]!
		const start = made.document.objects[0]!
		if (start.geometry.kind !== "path") throw new Error("Expected a path.")
		const contour = start.geometry.contours[0]!
		const chosen = contour.points[2]!
		const shifted = setDesignBlendFirstPoint(
			made.document,
			blend.id,
			"start",
			contour.id,
			chosen.id,
		)!
		const shiftedStart = shifted.objects[0]!
		expect(
			shiftedStart.geometry.kind === "path"
				? shiftedStart.geometry.contours[0]!.points[0]!.id
				: null,
		).toBe(chosen.id)
		const reversed = reverseDesignBlendEndpoint(shifted, blend.id, "start")!
		const reversedStart = reversed.objects[0]!
		expect(
			reversedStart.geometry.kind === "path"
				? reversedStart.geometry.contours[0]!.points.at(-1)!.id
				: null,
		).toBe(chosen.id)
	})

	it("expands fresh ordinary intermediates in projection order and retains endpoints", () => {
		const document = liveBlendDocument()
		const blend = document.blends![0]!
		const endpointIds = [blend.startObjectId, blend.endObjectId]
		const resolved = resolveDesignBlend(document, blend)
		const result = expandDesignBlend(document, blend.id, ids())!
		expect(result.document.blends).toEqual([])
		expect(result.selection).toHaveLength(resolved.objects.length)
		expect(result.selection.every((id) => id.startsWith("object:test-"))).toBe(
			true,
		)
		expect(
			endpointIds.every((id) =>
				result.document.objects.some((object) => object.id === id),
			),
		).toBe(true)
		const later = Math.max(
			...endpointIds.map((id) =>
				result.document.objects.findIndex((object) => object.id === id),
			),
		)
		expect(
			result.document.objects
				.slice(later - result.selection.length, later)
				.map(({ id }) => id),
		).toEqual(result.selection)
	})

	it("does not mutate the source document while previewing an operation", () => {
		const document = liveBlendDocument()
		const snapshot = structuredClone(document)
		expandDesignBlend(document, document.blends![0]!.id, ids())
		expect(document).toEqual(snapshot)
	})
})
