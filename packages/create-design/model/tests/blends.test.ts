import { describe, expect, it } from "vitest"

import {
	createDesignBlend,
	copyDesignBlendSelection,
	designBlendBounds,
	projectDesignDocumentBlends,
	pasteDesignBlendSelection,
	resolveDesignBlend,
	selectableDesignBlendIds,
} from "../src/blends.ts"
import type {
	DesignContour,
	DesignDocument,
	DesignObject,
} from "@create-design/source"

const stroke = (swatchId: string) => ({
	swatchId,
	width: 2,
	cap: "round" as const,
	join: "round" as const,
	miterLimit: 4,
	dashArray: [2, 3],
	dashOffset: 0,
})

const contour = (
	id: string,
	x: number,
	options: Readonly<{
		closed?: boolean
		reverse?: boolean
		hole?: boolean
	}> = {},
): DesignContour => {
	const points = [
		{ id: `${id}:a`, x, y: 0, outgoing: { x: 2, y: 1 } },
		{ id: `${id}:b`, x: x + 10, y: 0, incoming: { x: -2, y: 1 } },
		{ id: `${id}:c`, x: x + 10, y: options.hole ? 4 : 10 },
		{ id: `${id}:d`, x, y: options.hole ? 4 : 10 },
	]
	return {
		id,
		closed: options.closed ?? true,
		points: options.reverse ? points.toReversed() : points,
	}
}

const object = (
	id: string,
	x: number,
	options: Readonly<{
		contours?: readonly DesignContour[]
		hidden?: boolean
		locked?: boolean
	}> = {},
): DesignObject => ({
	id,
	name: id,
	geometry: {
		kind: "path",
		fillRule: "evenodd",
		contours: options.contours ?? [contour(`${id}:outer`, x)],
	},
	transform: { a: 1, b: 0, c: 0, d: 1, e: x, f: x / 2 },
	appearance: {
		fill: { swatchId: id.endsWith("start") ? "swatch:red" : "swatch:cyan" },
		stroke: stroke(id.endsWith("start") ? "swatch:red" : "swatch:cyan"),
	},
	...(options.hidden === undefined ? {} : { hidden: options.hidden }),
	...(options.locked === undefined ? {} : { locked: options.locked }),
})

const documentWith = (
	start = object("object:start", 0),
	end = object("object:end", 20),
): DesignDocument => {
	const blend = createDesignBlend("blend:test", "Test blend", start, end, 2)
	return {
		format: "create-design.document",
		version: 6,
		title: "Blend",
		artboards: [
			{ id: "artboard:one", name: "One", x: 0, y: 0, width: 200, height: 200 },
		],
		swatches: [
			{
				id: "swatch:red",
				name: "Red",
				source: { space: "rgb", r: 255, g: 0, b: 0 },
			},
			{
				id: "swatch:cyan",
				name: "Cyan",
				source: { space: "cmyk", c: 100, m: 0, y: 0, k: 0 },
			},
		],
		objects: [start, end],
		blends: [blend],
		layers: [
			{
				id: "layer:artwork",
				name: "Artwork",
				children: [
					{ kind: "object", id: start.id },
					{ kind: "object", id: end.id },
				],
			},
		],
		groups: [],
		guides: [],
	}
}

describe("live contour blends", () => {
	it("deterministically interpolates points, handles, transforms, RGB/CMYK paint, and stroke metrics", () => {
		const document = documentWith()
		const blend = document.blends![0]!
		const first = resolveDesignBlend(document, blend)
		const second = resolveDesignBlend(
			structuredClone(document),
			structuredClone(blend),
		)
		expect(second).toEqual(first)
		expect(first.status).toBe("ready")
		expect(first.objects).toHaveLength(2)
		expect(first.objects[0]).toMatchObject({
			id: "object:blend:test:step:1",
			transform: { a: 1, d: 1 },
			appearance: { stroke: { width: 2, dashArray: [2, 3] } },
		})
		expect(first.objects[0]!.transform.e).toBeCloseTo(20 / 3)
		expect(first.objects[0]!.transform.f).toBeCloseTo(10 / 3)
		const geometry = first.objects[0]!.geometry
		if (geometry.kind !== "path") throw new Error("Expected projected path.")
		expect(geometry.contours[0]!.points[0]!.x).toBeCloseTo(20 / 3)
		expect(geometry.contours[0]!.points[0]).toMatchObject({
			y: 0,
			outgoing: { x: 2, y: 1 },
		})
		expect(first.swatches[0]?.source).toEqual({
			space: "rgb",
			r: 170,
			g: 85,
			b: 85,
		})
	})

	it("supports multiple contours and holes by persisted correspondence", () => {
		const start = object("object:start", 0, {
			contours: [
				contour("start:outer", 0),
				contour("start:hole", 2, { hole: true }),
			],
		})
		const end = object("object:end", 20, {
			contours: [
				contour("end:outer", 20),
				contour("end:hole", 22, { hole: true }),
			],
		})
		const result = resolveDesignBlend(
			documentWith(start, end),
			createDesignBlend("blend:holes", "Holes", start, end, 3),
		)
		expect(result.status).toBe("ready")
		expect(result.objects).toHaveLength(3)
		expect(
			result.objects.every(
				({ geometry }) =>
					geometry.kind === "path" && geometry.contours.length === 2,
			),
		).toBe(true)
	})

	it("diagnoses reversed direction and a shifted persisted first point", () => {
		const original = documentWith()
		const reversedEnd = object("object:end", 20, {
			contours: [contour("object:end:outer", 20, { reverse: true })],
		})
		const reversed = {
			...original,
			objects: [original.objects[0]!, reversedEnd],
		}
		expect(
			resolveDesignBlend(reversed, reversed.blends![0]!).diagnostics.map(
				({ code }) => code,
			),
		).toEqual(
			expect.arrayContaining([
				"blend.contour.direction",
				"blend.contour.first-point",
			]),
		)
		const end = original.objects[1]!
		if (end.geometry.kind !== "path") throw new Error("path fixture")
		const shiftedEnd = {
			...end,
			geometry: {
				...end.geometry,
				contours: [
					{
						...end.geometry.contours[0]!,
						points: [
							...end.geometry.contours[0]!.points.slice(1),
							end.geometry.contours[0]!.points[0]!,
						],
					},
				],
			},
		}
		const shifted = { ...original, objects: [original.objects[0]!, shiftedEnd] }
		expect(
			resolveDesignBlend(shifted, shifted.blends![0]!).diagnostics.map(
				({ code }) => code,
			),
		).toContain("blend.contour.first-point")
	})

	it("diagnoses contour, point, and open/closed incompatibilities", () => {
		const document = documentWith()
		const end = document.objects[1]!
		if (end.geometry.kind !== "path") throw new Error("path fixture")
		const incompatible = {
			...end,
			geometry: {
				...end.geometry,
				contours: [
					{
						...end.geometry.contours[0]!,
						closed: false,
						points: end.geometry.contours[0]!.points.slice(0, 3),
					},
				],
			},
		}
		const changed = {
			...document,
			objects: [document.objects[0]!, incompatible],
		}
		const codes = resolveDesignBlend(
			changed,
			changed.blends![0]!,
		).diagnostics.map(({ code }) => code)
		expect(codes).toEqual(
			expect.arrayContaining([
				"blend.contour.closed",
				"blend.point.count",
				"blend.point.missing",
			]),
		)
		const noContours = {
			...document,
			objects: [
				document.objects[0]!,
				{ ...end, geometry: { ...end.geometry, contours: [] } },
			],
		}
		expect(
			resolveDesignBlend(noContours, noContours.blends![0]!).diagnostics.map(
				({ code }) => code,
			),
		).toContain("blend.contour.count")
	})

	it("documents recoverable missing-paint and incompatible stroke transitions", () => {
		const document = documentWith()
		const start = document.objects[0]!
		const end = document.objects[1]!
		const transition = {
			...document,
			objects: [
				{ ...start, appearance: { stroke: start.appearance.stroke! } },
				{
					...end,
					appearance: {
						...end.appearance,
						stroke: { ...end.appearance.stroke!, cap: "square" as const },
					},
				},
			],
		}
		const warnings = resolveDesignBlend(
			transition,
			transition.blends![0]!,
		).diagnostics
		expect(warnings).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: "blend.appearance.missing-fill",
					severity: "warning",
				}),
				expect.objectContaining({
					code: "blend.appearance.stroke-style",
					severity: "warning",
				}),
			]),
		)
		const incompatible = {
			...transition,
			objects: [
				transition.objects[0]!,
				{
					...transition.objects[1]!,
					appearance: {
						...transition.objects[1]!.appearance,
						stroke: {
							...transition.objects[1]!.appearance.stroke!,
							dashArray: [1],
						},
					},
				},
			],
		}
		expect(
			resolveDesignBlend(incompatible, incompatible.blends![0]!),
		).toMatchObject({
			status: "error",
			diagnostics: expect.arrayContaining([
				expect.objectContaining({ code: "blend.appearance.stroke-dash" }),
			]),
		})
	})

	it("updates from endpoints, recovers after replacement, and suppresses hidden endpoints", () => {
		const document = documentWith()
		const blend = document.blends![0]!
		const deleted = { ...document, objects: document.objects.slice(0, 1) }
		expect(resolveDesignBlend(deleted, blend)).toMatchObject({
			status: "error",
			diagnostics: [{ code: "blend.endpoint.missing" }],
		})
		expect(resolveDesignBlend(document, blend).status).toBe("ready")
		const moved = {
			...document,
			objects: [
				document.objects[0]!,
				{
					...document.objects[1]!,
					transform: { ...document.objects[1]!.transform, e: 100 },
				},
			],
		}
		expect(
			resolveDesignBlend(moved, blend).objects[0]!.transform.e,
		).toBeCloseTo(100 / 3)
		const hidden = {
			...document,
			objects: [
				document.objects[0]!,
				{ ...document.objects[1]!, hidden: true },
			],
		}
		expect(resolveDesignBlend(hidden, blend)).toMatchObject({
			status: "hidden",
			objects: [],
		})
	})

	it("inherits endpoint locks, exposes aggregate bounds, and selects only unlocked blends", () => {
		const document = documentWith()
		expect(selectableDesignBlendIds(document)).toEqual(["blend:test"])
		expect(designBlendBounds(document, document.blends![0]!)).not.toBeNull()
		const locked = {
			...document,
			objects: [
				{ ...document.objects[0]!, locked: true },
				document.objects[1]!,
			],
		}
		expect(
			resolveDesignBlend(locked, locked.blends![0]!).objects.every(
				({ locked }) => locked,
			),
		).toBe(true)
		expect(selectableDesignBlendIds(locked)).toEqual([])
	})

	it("places derived steps before the later-painted endpoint after reordering", () => {
		const document = documentWith()
		expect(
			projectDesignDocumentBlends(document).objects.map(({ id }) => id),
		).toEqual([
			"object:start",
			"object:blend:test:step:1",
			"object:blend:test:step:2",
			"object:end",
		])
		const reordered = { ...document, objects: document.objects.toReversed() }
		expect(
			projectDesignDocumentBlends(reordered).objects.map(({ id }) => id),
		).toEqual([
			"object:end",
			"object:blend:test:step:1",
			"object:blend:test:step:2",
			"object:start",
		])
	})

	it("copies and pastes a complete live unit with remapped endpoint and topology identities", () => {
		const document = documentWith()
		const payload = copyDesignBlendSelection(document, ["blend:test"])
		expect(payload).not.toBeNull()
		let next = 0
		const pasted = pasteDesignBlendSelection(
			document,
			payload!,
			() => `copy-${next++}`,
		)
		expect(pasted?.document.objects).toHaveLength(4)
		expect(pasted?.document.blends).toHaveLength(2)
		const pastedBlend = pasted?.document.blends?.[1]
		expect(pastedBlend).toMatchObject({
			id: expect.stringMatching(/^blend:copy-/u),
			startObjectId: expect.stringMatching(/^object:copy-/u),
			endObjectId: expect.stringMatching(/^object:copy-/u),
			steps: 2,
		})
		expect(resolveDesignBlend(pasted!.document, pastedBlend!).status).toBe(
			"ready",
		)
	})
})
