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
				uiColor: "purple" as const,
				hidden: true,
				children: [
					{ kind: "object" as const, id: back.id },
					{ kind: "group" as const, id: "group:outer" },
				],
			},
			{
				id: "layer:front",
				name: "Front",
				uiColor: "teal" as const,
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
		createLayer: vi.fn(),
		deleteLayer: vi.fn(),
		duplicateLayer: vi.fn(),
		renameLayer: vi.fn(),
		reorderLayer: vi.fn(),
		moveHierarchyNode: vi.fn(),
		setLayerLocked: vi.fn(),
		setLayerUiColor: vi.fn(),
		setLayerVisibility: vi.fn(),
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

function expandAll(host: HTMLElement): void {
	for (;;) {
		const disclosures = [
			...host.querySelectorAll<HTMLButtonElement>(
				'[role="treeitem"][aria-expanded="false"] > button[data-disclosure]',
			),
		]
		if (disclosures.length === 0) return
		act(() => disclosures.forEach((disclosure) => disclosure.click()))
	}
}

describe("Design Layers tree", () => {
	it("renders exact topmost-first hierarchy with effective state and one group selection", () => {
		const value = context(fixture(), { selectedGroupId: "group:outer" })
		const host = mount(value)
		expandAll(host)
		const rows = [...host.querySelectorAll<HTMLElement>('[role="treeitem"]')]

		expect(rows.map((row) => row.querySelector("b")?.textContent)).toEqual([
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
			"1",
			"2",
			"3",
			"4",
			"2",
		])
		expect(host.querySelector('[data-layer-kind="document"]')).toBeNull()
		expect(
			host
				.querySelector('[data-layer-kind="layer"][aria-current="true"]')
				?.getAttribute("aria-label"),
		).toContain("Target layer")
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
		expect(rows[0]?.getAttribute("aria-label")).toContain("UI color teal")
		expect(
			rows[0]?.querySelector<HTMLElement>("[data-layer-color]")?.style
				.background,
		).toBe("#0e9888")
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

		expect(disclosure.querySelector("svg")).not.toBeNull()
		expect(host.querySelectorAll('[role="treeitem"]')).toHaveLength(2)
		expect(host.textContent).not.toContain("Cyan ellipse")
		act(() => disclosure.click())
		expect(host.querySelectorAll('[role="treeitem"]')).toHaveLength(3)
		expect(host.textContent).toContain("Cyan ellipse")
		expect(value.selectLayer).not.toHaveBeenCalled()
		expect(value.document).toEqual(fixture())
		act(() => {
			root.focus()
			root.dispatchEvent(
				new KeyboardEvent("keydown", { bubbles: true, key: "ArrowDown" }),
			)
		})
		expect(document.activeElement?.getAttribute("data-layer-kind")).toBe(
			"object",
		)
		expect(document.activeElement?.textContent).toContain("Cyan ellipse")
		const focusedTreeKey = document.activeElement?.getAttribute("data-tree-key")

		render(
			h(DesignTileContent, {
				context: context({ ...value.document, title: "Updated title" }),
				kind: "layers",
			}),
			host,
		)
		expect(document.activeElement?.getAttribute("data-tree-key")).toBe(
			focusedTreeKey,
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
		expandAll(host)

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

	it("exposes separate layer state toggles and active-layer authoring controls", () => {
		const value = context()
		const host = mount(value)
		const button = (label: string): HTMLButtonElement => {
			const match = [
				...host.querySelectorAll<HTMLButtonElement>("button"),
			].find((candidate) => candidate.textContent?.trim() === label)
			if (match === undefined)
				throw new Error(`${label} control did not render.`)
			return match
		}

		act(() =>
			host
				.querySelector<HTMLButtonElement>('button[aria-label="Show Back"]')
				?.click(),
		)
		expect(value.setLayerVisibility).toHaveBeenCalledWith("layer:back", true)
		act(() =>
			host
				.querySelector<HTMLButtonElement>('button[aria-label="Lock Back"]')
				?.click(),
		)
		expect(value.setLayerLocked).toHaveBeenCalledWith("layer:back", true)
		const color = host.querySelector<HTMLSelectElement>(
			'select[aria-label="UI color for Back"]',
		)
		if (color === null)
			throw new Error("Layer UI color control did not render.")
		act(() => {
			color.value = "lime"
			color.dispatchEvent(new Event("change", { bubbles: true }))
		})
		expect(value.setLayerUiColor).toHaveBeenCalledWith("layer:back", "lime")

		act(() => button("New layer").click())
		expect(value.createLayer).toHaveBeenCalledOnce()
		act(() => button("Duplicate").click())
		expect(value.duplicateLayer).toHaveBeenCalledWith("layer:back")
		act(() => button("Move up").click())
		expect(value.reorderLayer).toHaveBeenCalledWith("layer:back", "up")
		expect(button("Move down").disabled).toBe(true)
		act(() => button("Delete").click())
		expect(value.deleteLayer).toHaveBeenCalledWith("layer:back")

		const input = host.querySelector<HTMLInputElement>("layer-management input")
		if (input === null) throw new Error("Layer name control did not render.")
		act(() => {
			input.value = "Renamed layer"
			input.dispatchEvent(new Event("input", { bubbles: true }))
		})
		act(() =>
			input.dispatchEvent(new FocusEvent("focusout", { bubbles: true })),
		)
		expect(value.renameLayer).toHaveBeenCalledWith(
			"layer:back",
			"Renamed layer",
		)
	})

	it("offers keyboard-accessible hierarchy reparenting and sibling order controls", () => {
		const document = {
			...fixture(),
			layers: fixture().layers.map((layer) => ({
				...layer,
				hidden: false,
				locked: false,
			})),
		}
		const value = context(document, {
			selectedObjectIds: ["object:coral"],
		})
		const host = mount(value)
		expandAll(host)
		const management = host.querySelectorAll("layer-management")[1]!
		const select = management.querySelector<HTMLSelectElement>("select")!
		act(() => {
			select.value = "group:group:inner"
			select.dispatchEvent(new Event("change", { bubbles: true }))
		})
		const action = (name: string) =>
			[...management.querySelectorAll<HTMLButtonElement>("button")].find(
				(button) => button.textContent?.trim() === name,
			)!
		expect(action("Move to top").disabled).toBe(false)
		act(() => action("Move to top").click())
		expect(value.moveHierarchyNode).toHaveBeenCalledWith(
			{ kind: "object", id: "object:coral" },
			{ kind: "group", id: "group:inner" },
			1,
		)

		act(() => action("Move up").click())
		expect(value.moveHierarchyNode).toHaveBeenLastCalledWith(
			{ kind: "object", id: "object:coral" },
			{ kind: "layer", id: "layer:back" },
			1,
		)
	})
})
