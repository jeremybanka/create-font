// @vitest-environment happy-dom

import Konva from "konva/lib/Core"
import { Group as KonvaGroup } from "konva/lib/Group"
import { Rect as KonvaRect } from "konva/lib/shapes/Rect"
import type { Stage as KonvaStage } from "konva/lib/Stage"
import { createRef } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { act, h, render } from "../../../../scripts/react-test-render.ts"
import { Group, Layer, Rect, Stage, Text } from "../src/canvas-renderer.ts"

const hosts: HTMLElement[] = []

beforeEach(() => {
	Konva.autoDrawEnabled = false
	vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
		function (this: HTMLCanvasElement) {
			const context = {
				canvas: this,
				createImageData: (width: number, height: number) => ({
					data: new Uint8ClampedArray(width * height * 4),
					height,
					width,
				}),
				getImageData: () => ({ data: new Uint8ClampedArray(4) }),
				measureText: () => ({ width: 0 }),
			}
			return new Proxy(context, {
				get: (target, key) =>
					key in target ? target[key as keyof typeof target] : () => undefined,
			}) as unknown as CanvasRenderingContext2D
		},
	)
})

afterEach(() => {
	for (const host of hosts) {
		render(null, host)
		host.remove()
	}
	hosts.length = 0
	vi.restoreAllMocks()
	expect(Konva.stages).toHaveLength(0)
})

function host(): HTMLElement {
	const element = document.createElement("section")
	document.body.append(element)
	hosts.push(element)
	return element
}

describe("shared React-Konva renderer", () => {
	it("exports the supported minimal scene components", () => {
		expect([Stage, Layer, Group, Rect, Text]).toHaveLength(5)
		expect(Konva.DD).toBeDefined()
	})

	it("synchronizes controlled props, handlers, refs, and keyed z-order", () => {
		const target = host()
		const stageRef = createRef<KonvaStage>()
		const rectRef = createRef<KonvaRect>()
		const first = vi.fn()
		const second = vi.fn()
		const external = vi.fn()
		const scene = (reverse: boolean, revised: boolean) =>
			h(
				Stage,
				{ height: 120, ref: stageRef, role: "img", width: 160 },
				h(
					Layer,
					null,
					h(
						Group,
						{ id: "root" },
						(reverse ? ["second", "first"] : ["first", "second"]).map((id) =>
							id === "first"
								? h(Rect, {
										...(revised ? {} : { fill: "red" }),
										height: 20,
										id,
										key: id,
										onClick: revised ? second : first,
										ref: rectRef,
										width: 20,
										x: revised ? 42 : 12,
									})
								: h(Rect, {
										fill: "blue",
										height: 20,
										id,
										key: id,
										width: 20,
									}),
						),
					),
				),
			)

		render(scene(false, false), target)
		const stage = stageRef.current
		const rect = rectRef.current
		expect(stage).toBeInstanceOf(Konva.Stage)
		expect(rect).toBeInstanceOf(KonvaRect)
		expect(target.querySelector("div")?.style.width).toBe("100%")
		expect(target.querySelector("div")?.getAttribute("role")).toBe("img")
		expect(rect?.x()).toBe(12)
		expect(rect?.fill()).toBe("red")
		rect?.on("click.external", external)
		act(() => rect?.fire("click", { evt: new MouseEvent("click") }))
		expect(first).toHaveBeenCalledOnce()
		expect(external).toHaveBeenCalledOnce()

		render(scene(true, true), target)
		expect(rectRef.current).toBe(rect)
		expect(rect?.x()).toBe(42)
		expect(rect?.getAttrs().fill).toBeUndefined()
		const root = stage?.findOne("#root")
		expect(root).toBeInstanceOf(KonvaGroup)
		expect((root as KonvaGroup).getChildren().map((node) => node.id())).toEqual(
			["second", "first"],
		)
		act(() => rect?.fire("click", { evt: new MouseEvent("click") }))
		expect(first).toHaveBeenCalledOnce()
		expect(second).toHaveBeenCalledOnce()
		expect(external).toHaveBeenCalledTimes(2)
	})

	it("destroys and remounts stages without retaining Konva nodes", () => {
		const target = host()
		const firstRef = createRef<KonvaStage>()
		render(
			h(Stage, { height: 80, ref: firstRef, width: 100 }, h(Layer)),
			target,
		)
		const first = firstRef.current
		expect(Konva.stages).toHaveLength(1)
		render(null, target)
		expect(firstRef.current).toBeNull()
		expect(Konva.stages).toHaveLength(0)

		const secondRef = createRef<KonvaStage>()
		render(
			h(Stage, { height: 80, ref: secondRef, width: 100 }, h(Layer)),
			target,
		)
		expect(secondRef.current).not.toBe(first)
		expect(Konva.stages).toHaveLength(1)
	})
})
