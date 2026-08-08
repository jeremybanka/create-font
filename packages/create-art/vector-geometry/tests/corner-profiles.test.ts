import { describe, expect, it } from "vitest"

import {
	GeometryError,
	cornerProfileEligibility,
	evaluateCubic,
	lowerCornerProfiles,
	type CornerContour,
	type Cubic,
} from "../src/index.ts"

const square = (
	profile: "sharp" | "circular" | "squircle" = "circular",
	amount = 20,
): CornerContour => ({
	closed: true,
	points: [
		{ id: "a", point: { x: 0, y: 0 } },
		{
			id: "b",
			point: { x: 100, y: 0 },
			corner: { profile, amount },
		},
		{ id: "c", point: { x: 100, y: 100 } },
		{ id: "d", point: { x: 0, y: 100 } },
	],
})

describe("corner profile eligibility", () => {
	it("classifies convex and concave corners independent of their angle", () => {
		expect(cornerProfileEligibility(square(), 1)).toEqual({
			eligible: true,
			convexity: "convex",
		})
		const concave: CornerContour = {
			closed: true,
			points: [
				{ id: "a", point: { x: 0, y: 0 } },
				{ id: "b", point: { x: 100, y: 0 } },
				{
					id: "notch",
					point: { x: 40, y: 30 },
					corner: { profile: "squircle", amount: 8 },
				},
				{ id: "d", point: { x: 100, y: 100 } },
				{ id: "e", point: { x: 0, y: 100 } },
			],
		}
		expect(cornerProfileEligibility(concave, 2)).toEqual({
			eligible: true,
			convexity: "concave",
		})
	})

	it.each([
		["acute", { x: 20, y: 80 }],
		["obtuse", { x: 180, y: 40 }],
	] as const)("accepts an %s turn", (_name, next) => {
		const contour: CornerContour = {
			closed: false,
			points: [
				{ id: "a", point: { x: 0, y: 0 } },
				{
					id: "corner",
					point: { x: 100, y: 0 },
					corner: { profile: "circular", amount: 10 },
				},
				{ id: "c", point: next },
			],
		}
		expect(cornerProfileEligibility(contour, 1)).toEqual({
			eligible: true,
			convexity: "unclassified",
		})
	})

	it("rejects open endpoints, collinear incidents, and invalid settings", () => {
		const open: CornerContour = {
			closed: false,
			points: [
				{
					id: "a",
					point: { x: 0, y: 0 },
					corner: { profile: "circular", amount: 2 },
				},
				{
					id: "b",
					point: { x: 10, y: 0 },
					corner: { profile: "circular", amount: -1 },
				},
				{ id: "c", point: { x: 20, y: 0 } },
			],
		}
		expect(cornerProfileEligibility(open, 0)).toMatchObject({
			eligible: false,
			reason: "open-endpoint",
		})
		expect(cornerProfileEligibility(open, 1)).toMatchObject({
			eligible: false,
			reason: "invalid-amount",
		})
		const collinear = {
			...open,
			points: open.points.map((point, index) =>
				index === 1
					? { ...point, corner: { profile: "circular" as const, amount: 1 } }
					: point,
			),
		}
		expect(cornerProfileEligibility(collinear, 1)).toMatchObject({
			eligible: false,
			reason: "collinear-incidents",
		})
	})
})

describe("corner profile lowering", () => {
	it("lowers a right-angle circular profile with the standard quarter-circle error", () => {
		const result = lowerCornerProfiles(square())
		expect(result.points.map((point) => point.id)).toEqual([
			"a",
			"b::corner:entry",
			"b::corner:exit",
			"c",
			"d",
		])
		const entry = result.points[1]!
		const exit = result.points[2]!
		expect(entry.point).toEqual({ x: 80, y: 0 })
		expect(exit.point).toEqual({ x: 100, y: 20 })
		const cubic: Cubic = {
			p0: entry.point,
			c1: entry.outgoing!,
			c2: exit.incoming!,
			p3: exit.point,
		}
		let maximumRadialError = 0
		for (let index = 0; index <= 100; index += 1) {
			const point = evaluateCubic(cubic, index / 100)
			maximumRadialError = Math.max(
				maximumRadialError,
				Math.abs(Math.hypot(point.x - 80, point.y - 20) - 20),
			)
		}
		expect(maximumRadialError / 20).toBeLessThan(0.000273)
	})

	it("uses fixed, stably identified squircle subdivisions", () => {
		const first = lowerCornerProfiles(square("squircle"), {
			squircleExponent: 4,
			squircleSubdivisions: 4,
		})
		const second = lowerCornerProfiles(square("squircle"), {
			squircleExponent: 4,
			squircleSubdivisions: 4,
		})
		expect(first.points.map((point) => point.id)).toEqual([
			"a",
			"b::corner:entry",
			"b::corner:squircle:1",
			"b::corner:squircle:2",
			"b::corner:squircle:3",
			"b::corner:exit",
			"c",
			"d",
		])
		expect(JSON.stringify(first)).toBe(JSON.stringify(second))
		expect(first.points.every((point) => Number.isFinite(point.point.x))).toBe(
			true,
		)
	})

	it("safely clamps adjacent large requests on tiny incidents", () => {
		const tiny: CornerContour = {
			closed: true,
			points: [
				{
					id: "a",
					point: { x: 0, y: 0 },
					corner: { profile: "circular", amount: 100 },
				},
				{
					id: "b",
					point: { x: 10, y: 0 },
					corner: { profile: "circular", amount: 100 },
				},
				{
					id: "c",
					point: { x: 10, y: 10 },
					corner: { profile: "circular", amount: 100 },
				},
				{
					id: "d",
					point: { x: 0, y: 10 },
					corner: { profile: "circular", amount: 100 },
				},
			],
		}
		const result = lowerCornerProfiles(tiny)
		expect(result.corners.every((corner) => corner.clamped)).toBe(true)
		expect(result.corners.every((corner) => corner.appliedAmount < 5)).toBe(
			true,
		)
		for (const point of result.points) {
			expect(Number.isFinite(point.point.x)).toBe(true)
			expect(Number.isFinite(point.point.y)).toBe(true)
		}
	})

	it("trims curved incidents without crossing and preserves their boundary controls", () => {
		const curved: CornerContour = {
			closed: false,
			points: [
				{ id: "a", point: { x: 0, y: 0 }, outgoing: { x: 25, y: -40 } },
				{
					id: "b",
					point: { x: 100, y: 0 },
					incoming: { x: 75, y: -40 },
					outgoing: { x: 130, y: 10 },
					corner: { profile: "circular", amount: 30 },
				},
				{ id: "c", point: { x: 100, y: 100 }, incoming: { x: 130, y: 60 } },
			],
		}
		const result = lowerCornerProfiles(curved, {
			tolerances: { flatness: 0.01 },
		})
		expect(result.corners[1]).toMatchObject({
			appliedAmount: 30,
			clamped: false,
		})
		const entry = result.points.find((point) => point.id.endsWith(":entry"))!
		const exit = result.points.find((point) => point.id.endsWith(":exit"))!
		expect(entry.incoming).toBeDefined()
		expect(entry.outgoing).toBeDefined()
		expect(exit.incoming).toBeDefined()
		expect(exit.outgoing).toBeDefined()
		expect(entry.point).not.toEqual(curved.points[1]!.point)
		expect(exit.point).not.toEqual(curved.points[1]!.point)
		const entrySourceTangent = {
			x: entry.point.x - entry.incoming!.x,
			y: entry.point.y - entry.incoming!.y,
		}
		const entryCornerTangent = {
			x: entry.outgoing!.x - entry.point.x,
			y: entry.outgoing!.y - entry.point.y,
		}
		const exitCornerTangent = {
			x: exit.point.x - exit.incoming!.x,
			y: exit.point.y - exit.incoming!.y,
		}
		const exitSourceTangent = {
			x: exit.outgoing!.x - exit.point.x,
			y: exit.outgoing!.y - exit.point.y,
		}
		expect(
			Math.abs(
				entrySourceTangent.x * entryCornerTangent.y -
					entrySourceTangent.y * entryCornerTangent.x,
			),
		).toBeLessThan(1e-8)
		expect(
			Math.abs(
				exitCornerTangent.x * exitSourceTangent.y -
					exitCornerTangent.y * exitSourceTangent.x,
			),
		).toBeLessThan(1e-8)
	})

	it("remains stable at large translated coordinates", () => {
		const translated: CornerContour = {
			...square(),
			points: square().points.map((point) => ({
				...point,
				point: { x: point.point.x + 1e12, y: point.point.y - 1e12 },
			})),
		}
		const result = lowerCornerProfiles(translated)
		expect(result.corners[1]).toMatchObject({
			appliedAmount: 20,
			clamped: false,
		})
		expect(result.points.every((point) => Number.isFinite(point.point.x))).toBe(
			true,
		)
	})

	it("rejects invalid contour and approximation options deterministically", () => {
		expect(() =>
			lowerCornerProfiles(square("squircle"), { squircleExponent: 1 }),
		).toThrowError(expect.objectContaining({ code: "INVALID_ARGUMENT" }))
		expect(() =>
			lowerCornerProfiles(square("squircle"), { squircleSubdivisions: 0 }),
		).toThrow(GeometryError)
		expect(() =>
			lowerCornerProfiles({
				closed: false,
				points: [
					{ id: "same", point: { x: 0, y: 0 } },
					{ id: "same", point: { x: Number.NaN, y: 0 } },
				],
			}),
		).toThrowError(expect.objectContaining({ code: "NON_FINITE_COORDINATE" }))
		expect(() =>
			lowerCornerProfiles(square(), {
				createId: () => "duplicate",
			}),
		).toThrowError(expect.objectContaining({ code: "INVALID_ARGUMENT" }))
	})
})
