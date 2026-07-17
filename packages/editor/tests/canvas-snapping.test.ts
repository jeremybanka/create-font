import { describe, expect, it } from "vitest"

import { resolveVerticalMetricGuides } from "@create-font/states"

import {
	incidentStraightProjectionCandidates,
	orthogonalConstraint,
	projectionGuidePoints,
	resolveGesturePoint,
	snapDraggedPoint,
	snapDraggedTarget,
	snapGroupTranslation,
	type DragPositionTarget,
	type SegmentProjectionCandidate,
} from "../src/canvas-snapping.ts"
import { restoreCancelledGroupDragTarget } from "../src/canvas-group-drag.ts"
import { makeDemoFont } from "../src/demo-font.ts"
import { parseNumericInput } from "../src/numeric-input.ts"

const metricLines = resolveVerticalMetricGuides(makeDemoFont().metrics).filter(
	(guide) => guide.kind === "line",
)

const diagonalProjection: SegmentProjectionCandidate = {
	id: "contour:test/0",
	label: "Straight segment projection",
	origin: { x: 0, y: 0 },
	neighbor: { x: 100, y: 100 },
}

const projectionInput = (
	x: number,
	y: number,
	projectionCandidates: readonly SegmentProjectionCandidate[] = [
		diagonalProjection,
	],
) => ({
	pointId: "point:dragged" as const,
	x,
	y,
	nodes: [],
	metrics: [],
	worldScale: 1,
	thresholdPixels: 10,
	projectionCandidates,
})

describe("canvas snapping", () => {
	it("holds a cancelled group drag at its original target position", () => {
		let position = { x: 80, y: 90 }
		const target = {
			position: (next: Readonly<{ x: number; y: number }>) => {
				position = { ...next }
			},
		}
		expect(
			restoreCancelledGroupDragTarget({ target, x: 10, y: 20 }, target),
		).toBe(true)
		expect(position).toEqual({ x: 10, y: 20 })
		expect(
			restoreCancelledGroupDragTarget(
				{ target, x: 10, y: 20 },
				{ position: () => undefined },
			),
		).toBe(false)
	})

	it.each([
		{
			name: "north-east horizontal",
			candidate: { x: 140, y: 110 },
			expected: { x: 140, y: 100, axis: "y" },
		},
		{
			name: "north-west vertical",
			candidate: { x: 90, y: 140 },
			expected: { x: 100, y: 140, axis: "x" },
		},
		{
			name: "south-west horizontal",
			candidate: { x: 60, y: 90 },
			expected: { x: 60, y: 100, axis: "y" },
		},
		{
			name: "south-east vertical",
			candidate: { x: 110, y: 60 },
			expected: { x: 100, y: 60, axis: "x" },
		},
	] as const)(
		"constrains a $name drag through its immutable anchor",
		({ candidate, expected }) => {
			const result = resolveGesturePoint({
				pointId: "point:dragged",
				anchor: { x: 100, y: 100 },
				candidate,
				shiftKey: true,
				nodes: [],
				metrics: [],
				worldScale: 1,
			})
			expect(result).toMatchObject({ x: expected.x, y: expected.y })
			expect(result.snaps).toEqual([
				expect.objectContaining({
					axis: expected.axis,
					kind: "orthogonal-constraint",
				}),
			])
		},
	)

	it("chooses horizontal motion for exact diagonal ties", () => {
		expect(
			orthogonalConstraint({ x: 100, y: 100 }, { x: 60, y: 140 }, true),
		).toEqual({ axis: "y", value: 100 })
	})

	it("applies and removes Shift against the same raw candidate without moving the anchor", () => {
		const input = {
			pointId: "point:dragged" as const,
			anchor: { x: 100, y: 100 },
			candidate: { x: 180, y: 130 },
			nodes: [],
			metrics: [],
			worldScale: 1,
		}
		expect(resolveGesturePoint({ ...input, shiftKey: false })).toMatchObject({
			x: 180,
			y: 130,
		})
		expect(resolveGesturePoint({ ...input, shiftKey: true })).toMatchObject({
			x: 180,
			y: 100,
		})
		expect(resolveGesturePoint({ ...input, shiftKey: false })).toMatchObject({
			x: 180,
			y: 130,
		})
	})

	it("lets ordinary snapping adjust only the free axis", () => {
		const horizontal = resolveGesturePoint({
			pointId: "point:dragged",
			anchor: { x: 0, y: 0 },
			candidate: { x: 96, y: 20 },
			shiftKey: true,
			nodes: [{ pointId: "point:other", x: 100, y: 999 }],
			metrics: [{ ...metricLines[0]!, y: 20 }],
			worldScale: 1,
		})
		expect(horizontal).toMatchObject({ x: 100, y: 0 })
		expect(horizontal.snaps.map((snap) => [snap.axis, snap.kind])).toEqual([
			["y", "orthogonal-constraint"],
			["x", "node"],
		])

		const vertical = resolveGesturePoint({
			pointId: "point:dragged",
			anchor: { x: 0, y: 0 },
			candidate: { x: 20, y: 496 },
			shiftKey: true,
			nodes: [{ pointId: "point:other", x: 20, y: 999 }],
			metrics: [{ ...metricLines[0]!, y: 500 }],
			worldScale: 1,
		})
		expect(vertical).toMatchObject({ x: 0, y: 500 })
		expect(vertical.snaps.map((snap) => [snap.axis, snap.kind])).toEqual([
			["x", "orthogonal-constraint"],
			["y", "metric"],
		])
	})

	it("gives Shift precedence over projected segments at every zoom", () => {
		const input = {
			pointId: "point:dragged" as const,
			anchor: { x: 0, y: 0 },
			candidate: { x: 50, y: 56 },
			shiftKey: true,
			nodes: [{ pointId: "point:other" as const, x: 64, y: 999 }],
			metrics: [],
			projectionCandidates: [diagonalProjection],
		}
		const atOneToOne = resolveGesturePoint({ ...input, worldScale: 1 })
		expect(atOneToOne).toMatchObject({ x: 0, y: 56 })
		expect(atOneToOne.snaps).toEqual([
			expect.objectContaining({ kind: "orthogonal-constraint" }),
		])
		const zoomedOut = resolveGesturePoint({ ...input, worldScale: 0.5 })
		expect(zoomedOut).toMatchObject({ x: 0, y: 56 })
		expect(
			zoomedOut.snaps.some((snap) => snap.kind === "segment-projection"),
		).toBe(false)

		const freeAxisInput = {
			...input,
			candidate: { x: 86, y: 5 },
			nodes: [{ pointId: "point:other" as const, x: 100, y: 999 }],
		}
		expect(resolveGesturePoint({ ...freeAxisInput, worldScale: 1 }).x).toBe(86)
		expect(resolveGesturePoint({ ...freeAxisInput, worldScale: 0.5 }).x).toBe(
			100,
		)
	})

	it("uses font-space y deltas and leaves a first Pen point unconstrained", () => {
		const invertedUpward = resolveGesturePoint({
			pointId: "point:dragged",
			anchor: { x: 0, y: 0 },
			candidate: { x: 5, y: 80 },
			shiftKey: true,
			nodes: [],
			metrics: [],
			worldScale: 1,
		})
		expect(invertedUpward).toMatchObject({ x: 0, y: 80 })
		const firstPenPoint = resolveGesturePoint({
			pointId: "point:pen-preview",
			anchor: null,
			candidate: { x: 30, y: 70 },
			shiftKey: true,
			nodes: [],
			metrics: [],
			worldScale: 4,
		})
		expect(firstPenPoint).toEqual({ x: 30, y: 70, snaps: [] })
	})

	it("returns identical coordinates for preview and commit resolution", () => {
		const input = {
			pointId: "point:gesture" as const,
			anchor: { x: 10, y: 20 },
			candidate: { x: 83.4, y: 44.6 },
			shiftKey: true,
			nodes: [{ pointId: "point:snap" as const, x: 80, y: 500 }],
			metrics: [],
			worldScale: 1,
		}
		const preview = resolveGesturePoint(input)
		const commit = resolveGesturePoint(input)
		expect(commit).toEqual(preview)
	})

	it("snaps axes independently and excludes the dragged node", () => {
		const snapped = snapDraggedPoint({
			pointId: "point:dragged",
			x: 103,
			y: 497,
			nodes: [
				{ pointId: "point:dragged", x: 103, y: 497 },
				{ pointId: "point:other", x: 100, y: 300 },
			],
			metrics: metricLines,
			worldScale: 1,
			thresholdPixels: 7,
		})
		expect(snapped).toMatchObject({ x: 100, y: 500 })
		expect(snapped.snaps.map((snap) => [snap.axis, snap.kind])).toEqual([
			["x", "node"],
			["y", "metric"],
		])
	})

	it("uses a screen-pixel threshold and deterministic tie breaks", () => {
		const input = {
			pointId: "point:dragged" as const,
			x: 100,
			y: 100,
			nodes: [
				{ pointId: "point:z" as const, x: 114, y: 300 },
				{ pointId: "point:a" as const, x: 86, y: 300 },
			],
			metrics: [],
			thresholdPixels: 7,
		}
		expect(snapDraggedPoint({ ...input, worldScale: 0.5 }).x).toBe(86)
		expect(snapDraggedPoint({ ...input, worldScale: 2 }).x).toBe(100)
	})

	it("reasserts the snapped canvas target position on every drag event", () => {
		let position = { x: 103, y: 497 }
		const target: DragPositionTarget = {
			x: () => position.x,
			y: () => position.y,
			position: (next) => {
				position = { ...next }
			},
		}
		const context = {
			pointId: "point:dragged" as const,
			nodes: [
				{ pointId: "point:dragged" as const, x: 103, y: 497 },
				{ pointId: "point:other" as const, x: 100, y: 300 },
			],
			metrics: metricLines,
			worldScale: 1,
			thresholdPixels: 7,
		}

		expect(snapDraggedTarget(target, context)).toMatchObject({ x: 100, y: 500 })
		expect(position).toEqual({ x: 100, y: 500 })

		position = { x: 105, y: 496 }
		expect(snapDraggedTarget(target, context)).toMatchObject({ x: 100, y: 500 })
		expect(position).toEqual({ x: 100, y: 500 })

		position = { x: 120, y: 480 }
		expect(snapDraggedTarget(target, context)).toMatchObject({ x: 120, y: 480 })
		expect(position).toEqual({ x: 120, y: 480 })
	})

	it("snapshots only non-degenerate incident straight segments", () => {
		const next = { pointId: "point:next" as const, x: 100, y: 100 }
		const openCandidates = incidentStraightProjectionCandidates(
			[
				{
					id: "contour:open",
					closed: false,
					nodes: [
						{ pointId: "point:previous", x: 0, y: 0 },
						next,
						{
							pointId: "point:curved",
							x: 200,
							y: 50,
							incoming: { x: -20, y: 10 },
						},
					],
				},
			],
			"point:next",
		)
		expect(openCandidates).toEqual([
			{
				id: "contour:open/0",
				label: "Straight segment projection",
				origin: { x: 100, y: 100 },
				neighbor: { x: 0, y: 0 },
			},
		])
		next.x = 900
		expect(openCandidates[0]?.origin).toEqual({ x: 100, y: 100 })

		const closedCandidates = incidentStraightProjectionCandidates(
			[
				{
					id: "contour:closed",
					closed: true,
					nodes: [
						{ pointId: "point:dragged", x: 0, y: 0 },
						{ pointId: "point:next", x: 100, y: 100 },
						{ pointId: "point:previous", x: -100, y: 100 },
					],
				},
			],
			"point:dragged",
		)
		expect(closedCandidates.map((candidate) => candidate.id)).toEqual([
			"contour:closed/0",
			"contour:closed/2",
		])
		expect(
			incidentStraightProjectionCandidates(
				[
					{
						id: "contour:degenerate",
						closed: false,
						nodes: [
							{ pointId: "point:dragged", x: 0, y: 0 },
							{ pointId: "point:same", x: 0, y: 0 },
						],
					},
				],
				"point:dragged",
			),
		).toEqual([])
	})

	it.each([
		{
			name: "horizontal",
			candidate: { ...diagonalProjection, neighbor: { x: 100, y: 0 } },
			point: { x: 60, y: 6 },
			expected: { x: 60, y: 0, amount: 0.6 },
		},
		{
			name: "vertical",
			candidate: { ...diagonalProjection, neighbor: { x: 0, y: 100 } },
			point: { x: -6, y: 60 },
			expected: { x: 0, y: 60, amount: 0.6 },
		},
		{
			name: "reversed diagonal",
			candidate: {
				...diagonalProjection,
				origin: { x: 100, y: 100 },
				neighbor: { x: 0, y: 0 },
			},
			point: { x: 40, y: 50 },
			expected: { x: 45, y: 45, amount: 0.55 },
		},
	])(
		"projects onto an eligible $name line",
		({ candidate, point, expected }) => {
			const result = snapDraggedPoint(
				projectionInput(point.x, point.y, [candidate]),
			)
			expect(result.x).toBeCloseTo(expected.x)
			expect(result.y).toBeCloseTo(expected.y)
			expect(result.snaps[0]).toMatchObject({
				axis: "projection",
				kind: "segment-projection",
				amount: expected.amount,
			})
		},
	)

	it("leaves projection amounts unbounded for interpolation and extrapolation", () => {
		const inward = snapDraggedPoint(projectionInput(40, 30))
		expect(inward).toMatchObject({ x: 35, y: 35 })
		expect(inward.snaps[0]).toMatchObject({ amount: 0.35 })

		const beforeOrigin = snapDraggedPoint(projectionInput(-50, -40))
		expect(beforeOrigin).toMatchObject({ x: -45, y: -45 })
		expect(beforeOrigin.snaps[0]).toMatchObject({ amount: -0.45 })

		const pastNeighbor = snapDraggedPoint(projectionInput(150, 160))
		expect(pastNeighbor).toMatchObject({ x: 155, y: 155 })
		expect(pastNeighbor.snaps[0]).toMatchObject({ amount: 1.55 })
	})

	it("uses screen distance, stable ties, and explicit constraint precedence", () => {
		const outsideAtOneToOne = snapDraggedPoint({
			...projectionInput(50, 60),
			thresholdPixels: 7,
		})
		expect(outsideAtOneToOne).toMatchObject({ x: 50, y: 60, snaps: [] })
		const insideWhenZoomedOut = snapDraggedPoint({
			...projectionInput(50, 60),
			thresholdPixels: 7,
			worldScale: 0.5,
		})
		expect(insideWhenZoomedOut.x).toBeCloseTo(55)
		expect(insideWhenZoomedOut.y).toBeCloseTo(55)

		const tied = snapDraggedPoint(
			projectionInput(5, 5, [
				{
					...diagonalProjection,
					id: "segment:z-horizontal",
					neighbor: { x: 100, y: 0 },
				},
				{
					...diagonalProjection,
					id: "segment:a-vertical",
					neighbor: { x: 0, y: 100 },
				},
			]),
		)
		expect(tied).toMatchObject({ x: 0, y: 5 })
		expect(tied.snaps[0]).toMatchObject({ id: "segment:a-vertical" })

		const explicit = snapDraggedPoint({
			...projectionInput(5, 5),
			explicitConstraint: () => ({ x: 20, y: 30, snaps: [] }),
		})
		expect(explicit).toEqual({ x: 20, y: 30, snaps: [] })
	})

	it("keeps the live target on the coupled projection and extends its guide", () => {
		let position = { x: 150, y: 160 }
		const target: DragPositionTarget = {
			x: () => position.x,
			y: () => position.y,
			position: (next) => {
				position = { ...next }
			},
		}
		const result = snapDraggedTarget(target, {
			...projectionInput(position.x, position.y),
		})
		expect(position).toEqual({ x: 155, y: 155 })
		const snap = result.snaps[0]
		expect(snap?.axis).toBe("projection")
		if (snap?.axis !== "projection") throw new Error("Missing projection snap.")
		expect(projectionGuidePoints(snap, 1_000)).toEqual([
			-707.1067811865474, -707.1067811865474, 707.1067811865474,
			707.1067811865474,
		])
	})

	it("snaps group edges and centers independently", () => {
		const snapped = snapGroupTranslation({
			bounds: { minX: 10, minY: 20, maxX: 30, maxY: 60 },
			deltaX: 67,
			deltaY: 37,
			selectedPointIds: new Set(["point:selected"]),
			nodes: [
				{ pointId: "point:selected", x: 10, y: 20 },
				{ pointId: "point:target", x: 100, y: 60 },
			],
			metrics: [
				{
					kind: "line",
					id: "baseline",
					label: "Baseline",
					y: 0,
					overshoot: { minY: 0, maxY: 0 },
				},
			],
			worldScale: 1,
			thresholdPixels: 7,
		})
		expect(snapped).toMatchObject({ deltaX: 70, deltaY: 40 })
		expect(snapped.snaps).toEqual([
			expect.objectContaining({ axis: "x", anchor: "max", value: 100 }),
			expect.objectContaining({ axis: "y", anchor: "min", value: 60 }),
		])
	})

	it("constrains a multi-node selection as one rigid Shift translation", () => {
		const common = {
			bounds: { minX: 10, minY: 20, maxX: 30, maxY: 60 },
			deltaX: 67,
			deltaY: 37,
			selectedPointIds: new Set(["point:a" as const, "point:b" as const]),
			nodes: [
				{ pointId: "point:a" as const, x: 10, y: 20 },
				{ pointId: "point:b" as const, x: 30, y: 60 },
				{ pointId: "point:target" as const, x: 100, y: 60 },
			],
			metrics: [],
			worldScale: 1,
			thresholdPixels: 7,
		}

		const horizontal = snapGroupTranslation({
			...common,
			axisConstraint: { axis: "y", value: 20 },
		})
		expect(horizontal).toMatchObject({ deltaX: 70, deltaY: 0 })
		expect(horizontal.snaps).toEqual([
			expect.objectContaining({
				axis: "y",
				kind: "orthogonal-constraint",
				value: 20,
			}),
			expect.objectContaining({ axis: "x", anchor: "max", value: 100 }),
		])

		const vertical = snapGroupTranslation({
			...common,
			axisConstraint: { axis: "x", value: 10 },
		})
		expect(vertical).toMatchObject({ deltaX: 0, deltaY: 40 })
		expect(vertical.snaps).toEqual([
			expect.objectContaining({
				axis: "x",
				kind: "orthogonal-constraint",
				value: 10,
			}),
			expect.objectContaining({ axis: "y", anchor: "min", value: 60 }),
		])
	})

	it("excludes selected owners and uses zoom-stable deterministic group ties", () => {
		const input = {
			bounds: { minX: 0, minY: 0, maxX: 20, maxY: 20 },
			deltaX: 4,
			deltaY: 0,
			selectedPointIds: new Set(["point:selected" as const]),
			nodes: [
				{ pointId: "point:selected" as const, x: 4, y: 0 },
				{ pointId: "point:z" as const, x: 17, y: 100 },
				{ pointId: "point:a" as const, x: 11, y: 100 },
			],
			metrics: [],
			thresholdPixels: 3,
		}
		const wide = snapGroupTranslation({ ...input, worldScale: 1 })
		expect(wide.deltaX).toBe(1)
		expect(wide.snaps[0]).toEqual(
			expect.objectContaining({ anchor: "center", id: "point:a" }),
		)
		const zoomed = snapGroupTranslation({ ...input, worldScale: 2 })
		expect(zoomed.deltaX).toBe(4)
		expect(zoomed.snaps).toHaveLength(0)
	})

	it("allows half-unit translations when a group center snaps exactly", () => {
		const snapped = snapGroupTranslation({
			bounds: { minX: 0, minY: 0, maxX: 9, maxY: 10 },
			deltaX: 5,
			deltaY: 0,
			selectedPointIds: new Set(),
			nodes: [{ pointId: "point:target", x: 10, y: 100 }],
			metrics: [],
			worldScale: 1,
			thresholdPixels: 1,
		})
		expect(snapped.deltaX).toBe(5.5)
		expect(snapped.snaps[0]).toEqual(
			expect.objectContaining({ anchor: "center", value: 10 }),
		)
	})
})

describe("numeric input parsing", () => {
	it("retains only finite in-range integers for commit", () => {
		expect(parseNumericInput("42", 0, 100)).toBe(42)
		expect(parseNumericInput("", 0, 100)).toBeNull()
		expect(parseNumericInput("2.5", 0, 100)).toBeNull()
		expect(parseNumericInput("Infinity", 0, 100)).toBeNull()
		expect(parseNumericInput("101", 0, 100)).toBeNull()
	})
})
