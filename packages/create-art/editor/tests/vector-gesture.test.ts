import { describe, expect, it } from "vitest"

import {
	reduceVectorGesture,
	shouldCloseVectorPen,
	type VectorGestureDown,
	type VectorGestureDownInput,
	type VectorGestureEvent,
	type VectorGesturePolicy,
	type VectorGestureState,
	type VectorTransformHandle,
} from "../src/vector-gesture.ts"

const fontPolicy = {
	yAxis: "up",
	rotationSnapDegrees: 15,
} as const satisfies VectorGesturePolicy
const designPolicy = {
	yAxis: "down",
	rotationSnapDegrees: 15,
} as const satisfies VectorGesturePolicy

const pointer = (
	x: number,
	y: number,
	options: {
		readonly screenX?: number
		readonly screenY?: number
		readonly shiftKey?: boolean
		readonly altKey?: boolean
		readonly additive?: boolean
	} = {},
) => ({
	world: { x, y },
	rawWorld: { x, y },
	screen: {
		x: options.screenX ?? x,
		y: options.screenY ?? y,
	},
	modifiers: {
		shiftKey: options.shiftKey ?? false,
		altKey: options.altKey ?? false,
		additive: options.additive ?? false,
	},
	snaps: [],
})

function transition(
	state: VectorGestureState | null,
	event: VectorGestureEvent,
	policy: VectorGesturePolicy = designPolicy,
) {
	return reduceVectorGesture(state, event, policy)
}

function down(
	input: VectorGestureDownInput,
	policy: VectorGesturePolicy = designPolicy,
) {
	return transition(
		null,
		{
			...input,
			type: "pointer-down",
			pointerId: 7,
			pointer: pointer(10, 20),
		} as VectorGestureDown,
		policy,
	)
}

describe("shared vector gesture reducer parity", () => {
	it("drives Select move and marquee through deterministic lifecycle intents", () => {
		const started = down({ tool: "select", targetId: "object:a" })
		const moved = transition(started.state, {
			type: "pointer-move",
			pointerId: 7,
			pointer: pointer(40, 55),
		})
		expect(moved.preview).toMatchObject({
			kind: "select-move",
			targetId: "object:a",
			delta: { x: 30, y: 35 },
		})
		const committed = transition(moved.state, {
			type: "pointer-up",
			pointerId: 7,
			pointer: pointer(40, 55),
		})
		expect(committed).toMatchObject({
			state: null,
			intent: { kind: "select-move", targetId: "object:a" },
		})

		const marquee = down({ tool: "select", targetId: null })
		const additive = transition(marquee.state, {
			type: "modifiers",
			pointerId: 7,
			modifiers: { shiftKey: true, altKey: false, additive: true },
		})
		const boxed = transition(additive.state, {
			type: "pointer-up",
			pointerId: 7,
			pointer: pointer(-5, 60, { shiftKey: true, additive: true }),
		})
		expect(boxed.intent).toEqual({
			kind: "select-marquee",
			bounds: { minX: -5, minY: 20, maxX: 10, maxY: 60 },
			additive: true,
		})
	})

	it("uses the same Pen state machine with an explicit coordinate policy", () => {
		const commits = [fontPolicy, designPolicy].map((policy) => {
			const started = down({ tool: "pen", targetId: "outline" }, policy)
			return transition(
				started.state,
				{
					type: "pointer-up",
					pointerId: 7,
					pointer: pointer(30, 32, { screenX: 30, screenY: 32 }),
				},
				policy,
			).intent
		})
		expect(commits[0]).toMatchObject({
			kind: "pen-node",
			mode: "soft",
			handles: { outgoing: { x: 20, y: -12 } },
		})
		expect(commits[1]).toMatchObject({
			kind: "pen-node",
			mode: "soft",
			handles: { outgoing: { x: 20, y: 12 } },
		})
	})

	it("keeps Pen clicks hard, switches to symmetric handles at four pixels, and closes near the start", () => {
		const click = down({ tool: "pen" })
		const hard = transition(click.state, {
			type: "pointer-up",
			pointerId: 7,
			pointer: pointer(13, 20, { screenX: 13, screenY: 20 }),
		})
		expect(hard.intent).toMatchObject({
			kind: "pen-node",
			mode: "hard",
			handles: null,
		})

		const drag = down({ tool: "pen" })
		const soft = transition(drag.state, {
			type: "pointer-up",
			pointerId: 7,
			pointer: pointer(14, 20, { screenX: 14, screenY: 20 }),
		})
		expect(soft.intent).toMatchObject({
			kind: "pen-node",
			mode: "soft",
			handles: {
				incoming: { x: -4, y: 0 },
				outgoing: { x: 4, y: 0 },
			},
		})
		expect(
			shouldCloseVectorPen(
				[
					{ x: 10, y: 20 },
					{ x: 40, y: 20 },
					{ x: 40, y: 50 },
				],
				{ x: 14, y: 20 },
				2,
			),
		).toBe(true)
		expect(
			shouldCloseVectorPen(
				[
					{ x: 10, y: 20 },
					{ x: 40, y: 20 },
				],
				{ x: 10, y: 20 },
				2,
			),
		).toBe(false)
	})

	it.each(["rect", "ellipse"] as const)(
		"shares %s previews, live modifiers, and commit thresholds",
		(tool) => {
			const started = down({ tool })
			const moved = transition(started.state, {
				type: "pointer-move",
				pointerId: 7,
				pointer: pointer(40, 40),
			})
			const modified = transition(moved.state, {
				type: "modifiers",
				pointerId: 7,
				modifiers: { shiftKey: true, altKey: true, additive: false },
			})
			expect(modified.preview).toMatchObject({
				kind: "shape",
				shape: tool,
				bounds: { minX: -20, minY: -10, maxX: 40, maxY: 50 },
			})
			const committed = transition(modified.state, {
				type: "pointer-up",
				pointerId: 7,
				pointer: pointer(40, 40, { shiftKey: true, altKey: true }),
			})
			expect(committed.intent).toMatchObject({ kind: "shape", shape: tool })
		},
	)

	it("shares Transform resize and rotation with deterministic snapping", () => {
		const resize = down({
			tool: "transform",
			targetId: "object:a",
			bounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
			handle: "se",
		})
		const resized = transition(resize.state, {
			type: "pointer-move",
			pointerId: 7,
			pointer: pointer(50, 80),
		})
		expect(resized.preview).toMatchObject({
			kind: "transform",
			targetId: "object:a",
			handle: "se",
		})
		const rotation = down({
			tool: "transform",
			targetId: "object:a",
			bounds: { minX: 0, minY: 0, maxX: 20, maxY: 20 },
			handle: "rotation",
		})
		const rotated = transition(rotation.state, {
			type: "pointer-move",
			pointerId: 7,
			pointer: pointer(20, 10, { shiftKey: true }),
		})
		expect(rotated.preview).toMatchObject({
			kind: "transform",
			rotationDegrees: -90,
		})
	})

	it.each([
		["down", "nw", { x: 0, y: 0 }, { x: 100, y: 80 }],
		["down", "n", { x: 50, y: 0 }, { x: 50, y: 80 }],
		["down", "ne", { x: 100, y: 0 }, { x: 0, y: 80 }],
		["down", "e", { x: 100, y: 40 }, { x: 0, y: 40 }],
		["down", "se", { x: 100, y: 80 }, { x: 0, y: 0 }],
		["down", "s", { x: 50, y: 80 }, { x: 50, y: 0 }],
		["down", "sw", { x: 0, y: 80 }, { x: 100, y: 0 }],
		["down", "w", { x: 0, y: 40 }, { x: 100, y: 40 }],
		["up", "nw", { x: 0, y: 80 }, { x: 100, y: 0 }],
		["up", "n", { x: 50, y: 80 }, { x: 50, y: 0 }],
		["up", "ne", { x: 100, y: 80 }, { x: 0, y: 0 }],
		["up", "e", { x: 100, y: 40 }, { x: 0, y: 40 }],
		["up", "se", { x: 100, y: 0 }, { x: 0, y: 80 }],
		["up", "s", { x: 50, y: 0 }, { x: 50, y: 80 }],
		["up", "sw", { x: 0, y: 0 }, { x: 100, y: 80 }],
		["up", "w", { x: 0, y: 40 }, { x: 100, y: 40 }],
	] as const)(
		"keeps the opposite %s-axis anchor fixed for the %s resize handle",
		(yAxis, handle, start, anchor) => {
			const policy = { yAxis } satisfies VectorGesturePolicy
			const bounds = { minX: 0, minY: 0, maxX: 100, maxY: 80 }
			const started = reduceVectorGesture(
				null,
				{
					type: "pointer-down",
					tool: "transform",
					pointerId: 7,
					pointer: pointer(start.x, start.y),
					targetId: "object:a",
					bounds,
					handle: handle as VectorTransformHandle,
				},
				policy,
			)
			const target = { x: start.x + 20, y: start.y + 10 }
			const moved = reduceVectorGesture(
				started.state,
				{
					type: "pointer-move",
					pointerId: 7,
					pointer: pointer(target.x, target.y),
				},
				policy,
			)
			if (moved.preview?.kind !== "transform")
				throw new Error("Expected a transform preview.")
			expect(moved.preview.anchor).toEqual(anchor)
			const transformedStart = {
				x:
					moved.preview.anchor.x +
					(start.x - moved.preview.anchor.x) * moved.preview.scale.x,
				y:
					moved.preview.anchor.y +
					(start.y - moved.preview.anchor.y) * moved.preview.scale.y,
			}
			expect(transformedStart.x).toBeCloseTo(
				handle === "n" || handle === "s" ? start.x : target.x,
			)
			expect(transformedStart.y).toBeCloseTo(
				handle === "e" || handle === "w" ? start.y : target.y,
			)
		},
	)

	it("makes Alt resize intent explicitly center-anchored", () => {
		const started = down({
			tool: "transform",
			targetId: "object:a",
			bounds: { minX: 0, minY: 0, maxX: 100, maxY: 80 },
			handle: "e",
		})
		const committed = transition(
			started.state,
			{
				type: "pointer-up",
				pointerId: 7,
				pointer: pointer(130, 40, { altKey: true }),
			},
			fontPolicy,
		)
		expect(committed.intent).toMatchObject({
			kind: "transform",
			handle: "e",
			anchor: { x: 50, y: 40 },
		})
	})

	it.each([
		["e", { minX: 10, minY: 0, maxX: 10, maxY: 80 }],
		["w", { minX: 10, minY: 0, maxX: 10, maxY: 80 }],
		["n", { minX: 0, minY: 20, maxX: 100, maxY: 20 }],
		["s", { minX: 0, minY: 20, maxX: 100, maxY: 20 }],
	] as const)(
		"keeps a degenerate %s edge resize finite without activating the other axis",
		(handle, bounds) => {
			const started = down({
				tool: "transform",
				targetId: "object:a",
				bounds,
				handle,
			})
			const moved = transition(started.state, {
				type: "pointer-move",
				pointerId: 7,
				pointer: pointer(70, 90, { shiftKey: true, altKey: true }),
			})
			if (moved.preview?.kind !== "transform")
				throw new Error("Expected a transform preview.")
			expect(moved.preview.scale).toEqual({ x: 1, y: 1 })
			expect(
				Object.values(moved.preview.anchor).every((value) =>
					Number.isFinite(value),
				),
			).toBe(true)
		},
	)

	it("cancels atomically and ignores unrelated pointer transitions", () => {
		const started = down({ tool: "pen" })
		const unrelated = transition(started.state, {
			type: "pointer-move",
			pointerId: 99,
			pointer: pointer(100, 100),
		})
		expect(unrelated.state).toBe(started.state)
		const canceled = transition(started.state, {
			type: "pointer-cancel",
			pointerId: 7,
		})
		expect(canceled).toEqual({
			state: null,
			preview: null,
			intent: null,
			canceled: true,
		})
	})
})
