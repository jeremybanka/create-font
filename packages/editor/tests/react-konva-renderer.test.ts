import Konva from "konva"
import React from "react"
import { KonvaRenderer } from "react-konva"
import { describe, expect, it } from "vitest"

interface LegacyKonvaRenderer {
	createContainer(
		container: Konva.Group,
		rootTag: number,
		hydrate: boolean,
		hydrationCallbacks: null,
	): unknown
	updateContainer(element: React.ReactNode, root: unknown, parent: null): void
}

const renderer = KonvaRenderer as unknown as LegacyKonvaRenderer

describe("react-konva renderer boundary", () => {
	it("mounts, updates, and unmounts real React elements in a Konva container", () => {
		const container = new Konva.Group()
		const root = renderer.createContainer(container, 0, false, null)

		renderer.updateContainer(
			React.createElement(
				"Group",
				{ id: "outline" },
				React.createElement("Rect", {
					id: "shape",
					width: 20,
					height: 30,
				}),
			),
			root,
			null,
		)
		expect(container.findOne("#shape")?.width()).toBe(20)

		renderer.updateContainer(
			React.createElement(
				"Group",
				{ id: "outline" },
				React.createElement("Rect", {
					id: "shape",
					width: 48,
					height: 30,
				}),
			),
			root,
			null,
		)
		expect(container.findOne("#shape")?.width()).toBe(48)

		renderer.updateContainer(null, root, null)
		expect(container.getChildren()).toHaveLength(0)
	})
})
