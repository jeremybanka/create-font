// @vitest-environment happy-dom

import { describe, expect, it } from "vitest"

import { scrollActiveDescendantIntoView } from "../src/active-descendant-scroll.ts"

function bounds(top: number, bottom: number): DOMRect {
	return {
		bottom,
		height: bottom - top,
		left: 0,
		right: 200,
		top,
		width: 200,
		x: 0,
		y: top,
		toJSON: () => ({}),
	}
}

describe("active descendant scrolling", () => {
	it("scrolls minimally below and above a list viewport", () => {
		const container = document.createElement("div")
		const active = document.createElement("button")
		container.append(active)
		container.scrollTop = 40
		container.getBoundingClientRect = () => bounds(100, 300)
		active.getBoundingClientRect = () => bounds(280, 340)

		scrollActiveDescendantIntoView(container, active)
		expect(container.scrollTop).toBe(80)

		active.getBoundingClientRect = () => bounds(70, 130)
		scrollActiveDescendantIntoView(container, active)
		expect(container.scrollTop).toBe(50)
	})

	it("does not fight scrolling for an already visible or unrelated item", () => {
		const container = document.createElement("div")
		const active = document.createElement("button")
		const unrelated = document.createElement("button")
		container.append(active)
		container.scrollTop = 120
		container.getBoundingClientRect = () => bounds(100, 300)
		active.getBoundingClientRect = () => bounds(160, 220)

		scrollActiveDescendantIntoView(container, active)
		scrollActiveDescendantIntoView(container, unrelated)
		expect(container.scrollTop).toBe(120)
	})
})
