import { describe, expect, it } from "vitest"

import {
	ELLIPSE_KAPPA,
	resolveShapeGesture,
	shapeGeometry,
	shapeLayerCoordinates,
	shapeSnapsForDisplay,
} from "../src/shape-gesture.ts"

const resolve = (
	rawCandidate: Readonly<{ x: number; y: number }>,
	overrides: Partial<Parameters<typeof resolveShapeGesture>[0]> = {},
) =>
	resolveShapeGesture({
		anchor: { x: 100, y: 200 },
		rawCandidate,
		snappedCandidate: rawCandidate,
		downScreen: { x: 20, y: 30 },
		currentScreen: { x: 100, y: 100 },
		...overrides,
	})

describe("shape gestures", () => {
	it("shows hover guides before a drag and hands them off to the live gesture", () => {
		const hover = [{ id: "hover" }]
		const drag = [{ id: "drag" }]
		expect(shapeSnapsForDisplay(null, hover)).toBe(hover)
		expect(shapeSnapsForDisplay({ shiftKey: false, snaps: drag }, hover)).toBe(
			drag,
		)
		expect(
			shapeSnapsForDisplay({ shiftKey: true, snaps: drag }, hover),
		).toEqual([])
	})

	it.each([
		[
			{ x: 300, y: 500 },
			{ minX: 100, minY: 200, maxX: 300, maxY: 500 },
		],
		[
			{ x: -100, y: 500 },
			{ minX: -100, minY: 200, maxX: 100, maxY: 500 },
		],
		[
			{ x: 300, y: -100 },
			{ minX: 100, minY: -100, maxX: 300, maxY: 200 },
		],
		[
			{ x: -100, y: -100 },
			{ minX: -100, minY: -100, maxX: 100, maxY: 200 },
		],
	])(
		"normalizes every drag quadrant from an immutable anchor",
		(raw, bounds) => {
			expect(resolve(raw)).toMatchObject({ bounds, valid: true })
		},
	)

	it("uses independently snapped axes only while unconstrained", () => {
		const unconstrained = resolve(
			{ x: 275, y: 240 },
			{ snappedCandidate: { x: 280, y: 250 } },
		)
		const constrained = resolve(
			{ x: 275, y: 240 },
			{ snappedCandidate: { x: 280, y: 250 }, shiftKey: true },
		)
		expect(unconstrained.bounds).toEqual({
			minX: 100,
			minY: 200,
			maxX: 280,
			maxY: 250,
		})
		expect(constrained.bounds).toEqual({
			minX: 100,
			minY: 200,
			maxX: 275,
			maxY: 375,
		})
	})

	it.each([
		[
			{ x: 300, y: 500 },
			{ minX: -100, minY: -100, maxX: 300, maxY: 500 },
		],
		[
			{ x: -100, y: 500 },
			{ minX: -100, minY: -100, maxX: 300, maxY: 500 },
		],
		[
			{ x: 300, y: -100 },
			{ minX: -100, minY: -100, maxX: 300, maxY: 500 },
		],
		[
			{ x: -100, y: -100 },
			{ minX: -100, minY: -100, maxX: 300, maxY: 500 },
		],
	])(
		"draws symmetrically around the anchor in every quadrant",
		(raw, bounds) => {
			expect(resolve(raw, { altKey: true })).toMatchObject({
				bounds,
				valid: true,
			})
		},
	)

	it("reflects snapped extrema without moving the center", () => {
		const result = resolve(
			{ x: 275, y: 240 },
			{ altKey: true, snappedCandidate: { x: 280, y: 250 } },
		)
		expect(result.bounds).toEqual({
			minX: -80,
			minY: 150,
			maxX: 280,
			maxY: 250,
		})
		expect((result.bounds.minX + result.bounds.maxX) / 2).toBe(100)
		expect((result.bounds.minY + result.bounds.maxY) / 2).toBe(200)
	})

	it("combines Alt and Shift using the raw dominant axis and remembered direction", () => {
		const first = resolve({ x: 260, y: 240 }, { altKey: true, shiftKey: true })
		expect(first.bounds).toEqual({ minX: -60, minY: 40, maxX: 260, maxY: 360 })
		const crossing = resolve(
			{ x: 100, y: 40 },
			{
				altKey: true,
				shiftKey: true,
				previousDirection: first.direction,
			},
		)
		expect(crossing.bounds).toEqual({
			minX: -60,
			minY: 40,
			maxX: 260,
			maxY: 360,
		})
	})

	it("preserves the last non-zero quadrant direction across axis crossings", () => {
		const first = resolve({ x: 250, y: 350 }, { shiftKey: true })
		const onAxis = resolve(
			{ x: 100, y: 320 },
			{ shiftKey: true, previousDirection: first.direction },
		)
		expect(onAxis.direction).toEqual({ x: 1, y: 1 })
		expect(onAxis.bounds).toEqual({
			minX: 100,
			minY: 200,
			maxX: 220,
			maxY: 320,
		})
	})

	it("keeps a constrained preview degenerate until both axes have a direction", () => {
		const result = resolve({ x: 240, y: 200 }, { shiftKey: true })
		expect(result.direction).toEqual({ x: 1, y: null })
		expect(result.valid).toBe(false)
		expect(result.bounds.minY).toBe(result.bounds.maxY)
	})

	it("uses the CSS-pixel threshold independently of zoom or font distance", () => {
		const below = resolve(
			{ x: 900, y: 900 },
			{ downScreen: { x: 0, y: 0 }, currentScreen: { x: 3, y: 0 } },
		)
		const exact = resolve(
			{ x: 101, y: 201 },
			{ downScreen: { x: 0, y: 0 }, currentScreen: { x: 4, y: 0 } },
		)
		expect(below.valid).toBe(false)
		expect(exact.valid).toBe(true)
	})

	it("rounds bounds once and canonicalizes negative zero", () => {
		const result = resolveShapeGesture({
			anchor: { x: -0.4, y: 9.6 },
			rawCandidate: { x: 10.49, y: -0.49 },
			snappedCandidate: { x: 10.49, y: -0.49 },
			downScreen: { x: 0, y: 0 },
			currentScreen: { x: 10, y: 10 },
		})
		expect(result.bounds).toEqual({ minX: 0, minY: 0, maxX: 10, maxY: 10 })
		expect(Object.is(result.bounds.minX, -0)).toBe(false)
	})
})

describe("shape geometry", () => {
	it("emits a clockwise four-hard-node rectangle", () => {
		const points = shapeGeometry("rect", {
			minX: 10,
			minY: 20,
			maxX: 110,
			maxY: 220,
		})
		expect(points).toEqual([
			{ mode: "hard", x: 10, y: 220 },
			{ mode: "hard", x: 110, y: 220 },
			{ mode: "hard", x: 110, y: 20 },
			{ mode: "hard", x: 10, y: 20 },
		])
		const twiceArea = points.reduce((area, point, index) => {
			const next = points[(index + 1) % points.length]!
			return area + point.x * next.y - next.x * point.y
		}, 0)
		expect(twiceArea).toBeLessThan(0)
	})

	it("emits top/right/bottom/left soft ellipse extrema with kappa handles", () => {
		const points = shapeGeometry("ellipse", {
			minX: 0,
			minY: 10,
			maxX: 101,
			maxY: 210,
		})
		expect(points.map(({ x, y }) => ({ x, y }))).toEqual([
			{ x: 50.5, y: 210 },
			{ x: 101, y: 110 },
			{ x: 50.5, y: 10 },
			{ x: 0, y: 110 },
		])
		expect(points[0]?.incoming?.x).toBeCloseTo(-50.5 * ELLIPSE_KAPPA)
		expect(points[1]?.incoming?.y).toBeCloseTo(100 * ELLIPSE_KAPPA)
		for (const point of points) {
			expect(point.mode).toBe("soft")
			expect(point.incoming?.x).toBeCloseTo(-(point.outgoing?.x ?? NaN))
			expect(point.incoming?.y).toBeCloseTo(-(point.outgoing?.y ?? NaN))
		}
	})

	it("returns no geometry for degenerate bounds", () => {
		expect(
			shapeGeometry("ellipse", { minX: 5, minY: 0, maxX: 5, maxY: 10 }),
		).toEqual([])
	})

	it("keeps the active layer exact and projects absolute handle endpoints", () => {
		const geometry = shapeGeometry("ellipse", {
			minX: 100,
			minY: 200,
			maxX: 301,
			maxY: 500,
		})
		const pointIds = [
			"point:shape:0",
			"point:shape:1",
			"point:shape:2",
			"point:shape:3",
		] as const
		const layers = shapeLayerCoordinates(geometry, pointIds, [
			{ masterId: "master:active", xScale: 1 },
			{ masterId: "master:other", xScale: 0.5 },
		])
		expect(layers[0]?.points).toEqual(
			geometry.map((point, index) => ({
				pointId: pointIds[index],
				x: point.x,
				y: point.y,
				...(point.incoming === undefined ? {} : { incoming: point.incoming }),
				...(point.outgoing === undefined ? {} : { outgoing: point.outgoing }),
			})),
		)
		expect(layers[1]?.points[0]).toMatchObject({
			x: 350.25,
			y: 500,
			incoming: { x: expect.closeTo(-50.25 * ELLIPSE_KAPPA), y: 0 },
			outgoing: { x: expect.closeTo(50.25 * ELLIPSE_KAPPA), y: 0 },
		})
	})
})
