import { Group } from "konva/lib/Group"
import { describe, expect, it, vi } from "vitest"
import {
	applyNodeProps,
	clearNodeProps,
	snapshotNodeProps,
} from "../src/node-props.ts"

describe("Konva prop synchronization", () => {
	it("updates attributes and removes attributes no longer represented", () => {
		const node = new Group()
		const initial = snapshotNodeProps({ x: 12, opacity: 0.5 })
		applyNodeProps(node, undefined, initial)
		expect(node.x()).toBe(12)
		expect(node.opacity()).toBe(0.5)

		const updated = snapshotNodeProps({ x: 42 })
		applyNodeProps(node, initial, updated)
		expect(node.x()).toBe(42)
		expect(node.getAttrs().opacity).toBeUndefined()
		expect(node.opacity()).toBe(1)
	})

	it("replaces event handlers without disturbing external listeners", () => {
		const node = new Group()
		const first = vi.fn()
		const second = vi.fn()
		const external = vi.fn()
		node.on("mousedown.external", external)

		const initial = snapshotNodeProps({ onMouseDown: first })
		applyNodeProps(node, undefined, initial)
		node.fire("mousedown")
		expect(first).toHaveBeenCalledOnce()
		expect(external).toHaveBeenCalledOnce()

		const updated = snapshotNodeProps({ onMouseDown: second })
		applyNodeProps(node, initial, updated)
		node.fire("mousedown")
		expect(first).toHaveBeenCalledOnce()
		expect(second).toHaveBeenCalledOnce()
		expect(external).toHaveBeenCalledTimes(2)

		clearNodeProps(node)
		node.fire("mousedown")
		expect(second).toHaveBeenCalledOnce()
		expect(external).toHaveBeenCalledTimes(3)
	})

	it("does not pass component-only props into Konva attributes", () => {
		const click = vi.fn()
		const snapshot = snapshotNodeProps({
			__konvaIndex: 2,
			children: [],
			onClick: click,
			ref: null,
			x: 8,
		})
		expect(snapshot.attributes).toEqual({ x: 8 })
		expect(snapshot.events.onClick).toBe(click)
	})
})
