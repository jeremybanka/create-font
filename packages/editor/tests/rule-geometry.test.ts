import { describe, expect, it } from "vitest"

import { measureRule } from "../src/rule-geometry.ts"

const nodes = (points: readonly (readonly [number, number])[]) =>
	points.map(([x, y]) => ({ x, y }))

const rule = {
	id: "rule:test" as const,
	a: { x: -50, y: 50 },
	b: { x: 200, y: 50 },
}

describe("rule geometry", () => {
	it("measures a clockwise form and reverses event order with A/B", () => {
		const contours = [
			{
				closed: true,
				nodes: nodes([
					[0, 0],
					[0, 100],
					[100, 100],
					[100, 0],
				]),
			},
		]
		const measured = measureRule(rule, contours)
		expect(measured.events.map(({ kind, x }) => [kind, x])).toEqual([
			["entry", 0],
			["exit", 100],
		])
		expect(measured.measures.map(({ label }) => label)).toEqual(["100.0"])
		expect(
			measureRule({ ...rule, a: rule.b, b: rule.a }, contours).events.map(
				({ kind, x }) => [kind, x],
			),
		).toEqual([
			["entry", 100],
			["exit", 0],
		])
	})

	it("treats same-winding overlap as a union and counterforms as subtraction", () => {
		const form = (left: number, right: number) => ({
			closed: true,
			nodes: nodes([
				[left, 0],
				[left, 100],
				[right, 100],
				[right, 0],
			]),
		})
		const counter = {
			closed: true,
			nodes: nodes([
				[30, 30],
				[70, 30],
				[70, 70],
				[30, 70],
			]),
		}
		const measured = measureRule(rule, [form(0, 100), form(50, 150), counter])
		expect(measured.events.map(({ kind, x }) => [kind, x])).toEqual([
			["entry", 0],
			["exit", 30],
			["entry", 70],
			["exit", 150],
		])
		expect(measured.measures.map(({ label }) => label)).toEqual([
			"30.0",
			"40.0",
			"80.0",
		])
	})

	it("ignores open contours and tangent touches", () => {
		const tangent = {
			closed: true,
			nodes: [
				{ x: 0, y: 0 },
				{ x: 100, y: 0, outgoing: { x: 0, y: 100 } },
				{ x: 0, y: 0, incoming: { x: 0, y: 100 } },
			],
		}
		expect(
			measureRule({ ...rule, a: { x: -50, y: 75 }, b: { x: 200, y: 75 } }, [
				{ ...tangent, closed: false },
			]).events,
		).toEqual([])
		expect(
			measureRule({ ...rule, a: { x: -50, y: 0 }, b: { x: 200, y: 0 } }, [
				tangent,
			]).measures.every(({ length }) => length > 0),
		).toBe(true)
	})
})
