import { describe, expect, it } from "vitest"

import {
	reduceVectorGesture,
	type VectorGestureDown,
	type VectorGestureDownInput,
	type VectorGestureEvent,
	type VectorGesturePolicy,
	type VectorGestureState,
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
