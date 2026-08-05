// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest"
import { act, h, render } from "../../../../scripts/react-test-render.ts"

import { DesignTileContent } from "../src/DesignTileContent.tsx"
import { createInitialDocument } from "../src/document.ts"
import type { DesignTileContext } from "../src/design-tile-registry.ts"

const hosts: HTMLElement[] = []

afterEach(() => {
	for (const host of hosts) {
		render(null, host)
		host.remove()
	}
	hosts.length = 0
})

const fixture = (): DesignTileContext["document"] => {
	const initial = createInitialDocument()
	const back = initial.objects[0]!
	const front = initial.objects[1]!
	const nested = { ...back, id: "object:nested", name: "Nested object" }
	return {
		...initial,
		title: "Tree document",
		objects: [front, nested, back],
		layers: [
			{
				id: "layer:back",
				name: "Back",
				hidden: true,
				children: [
					{ kind: "object" as const, id: back.id },
					{ kind: "group" as const, id: "group:outer" },
				],
			},
			{
				id: "layer:front",
				name: "Front",
				locked: true,
				children: [{ kind: "object" as const, id: front.id }],
			},
		],
		groups: [
			{
				id: "group:outer",
				name: "Outer group with a deliberately long narrow-tile name",
				children: [{ kind: "group" as const, id: "group:inner" }],
			},
			{
				id: "group:inner",
				name: "Inner group",
				children: [{ kind: "object" as const, id: nested.id }],
			},
		],
	}
}

function context(
	document = fixture(),
	overrides: Partial<DesignTileContext> = {},
): DesignTileContext {
	return {
		document,
		activeLayerId: "layer:back",
		activeGroupScope: [],
		selectedGroupId: null,
		selectedObjectIds: [],
		selectedBlend: null,
		selectLayer: vi.fn(),
		selectHierarchyGroup: vi.fn(),
		selectHierarchyObject: vi.fn(),
		setHierarchyScope: vi.fn(),
		selectBlend: vi.fn(),
		...overrides,
	} as unknown as DesignTileContext
}

function mount(value: DesignTileContext) {
	const host = document.createElement("div")
	document.body.append(host)
	hosts.push(host)
	render(h(DesignTileContent, { context: value, kind: "layers" }), host)
	return host
}

describe("Design Layers tree", () => {
	it("renders exact topmost-first hierarchy with effective state and one group selection", () => {
		const value = context(fixture(), { selectedGroupId: "group:outer" })
		const host = mount(value)
		const rows = [...host.querySelectorAll<HTMLElement>('[role="treeitem"]')]

		expect(rows.map((row) => row.querySelector("b")?.textContent)).toEqual([
			"Tree document",
			"Front",
			"Cyan ellipse",
			"Back",
			"Outer group with a deliberately long narrow-tile name",
			"Inner group",
			"Nested object",
			"Coral rectangle",
		])
		expect(rows.map((row) => row.getAttribute("aria-level"))).toEqual([
			"1",
			"2",
			"3",
			"2",
			"3",
			"4",
			"5",
			"3",
		])
		expect(
			host.querySelector('[data-layer-kind="group"][aria-selected="true"] b')
				?.textContent,
		).toContain("Outer group")
		expect(
			host.querySelectorAll('[data-layer-kind="object"][aria-selected="true"]'),
		).toHaveLength(0)
		expect(
			host
				.querySelector('[data-layer-kind="object"]')
				?.getAttribute("aria-label"),
		).toContain("Locked by Front layer")
		expect(
			rows
				.find((row) => row.textContent?.includes("Nested object"))
				?.getAttribute("aria-label"),
		).toContain("Hidden by Back layer")
	})

	it("keeps disclosure local and supports roving tree keyboard focus", () => {
		const value = context()
		const host = mount(value)
		const tree = host.querySelector('[role="tree"]')
		const root = host.querySelector<HTMLElement>('[role="treeitem"]')
		const disclosure = root?.querySelector<HTMLButtonElement>(
			"button[data-disclosure]",
		)
		if (
			tree === null ||
			root === null ||
			disclosure === null ||
			disclosure === undefined
		)
			throw new Error("Tree fixture did not render.")

		act(() => disclosure.click())
		expect(host.querySelectorAll('[role="treeitem"]')).toHaveLength(1)
		expect(value.selectLayer).not.toHaveBeenCalled()
		expect(value.document).toEqual(fixture())
		act(() => disclosure.click())
		act(() => {
			root.focus()
			root.dispatchEvent(
				new KeyboardEvent("keydown", { bubbles: true, key: "ArrowDown" }),
			)
		})
		expect(document.activeElement?.getAttribute("data-layer-kind")).toBe(
			"layer",
		)
		expect(document.activeElement?.textContent).toContain("Front")

		render(
			h(DesignTileContent, {
				context: context({ ...value.document, title: "Updated title" }),
				kind: "layers",
			}),
			host,
		)
		expect(document.activeElement?.getAttribute("data-tree-key")).toBe(
			"layer:layer:front",
		)
	})

	it("shows scope breadcrumbs, marks unrelated rows, and exposes keyboard routes", () => {
		const setHierarchyScope = vi.fn()
		const host = mount(
			context(fixture(), {
				activeGroupScope: ["group:outer", "group:inner"],
				setHierarchyScope,
			}),
		)

		expect(
			host.querySelector('layer-breadcrumb [aria-current="location"]')
				?.textContent,
		).toBe("Inner group")
		expect(
			host.querySelectorAll('[data-out-of-scope="true"]').length,
		).toBeGreaterThan(0)
		const documentButton = host.querySelector<HTMLButtonElement>(
			"layer-breadcrumb button",
		)
		act(() => documentButton?.click())
		expect(setHierarchyScope).toHaveBeenCalledWith([])
		const active = host.querySelector<HTMLElement>('[data-active-scope="true"]')
		expect(active?.textContent).toContain("Inner group")
	})
})
