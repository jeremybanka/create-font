// @vitest-environment happy-dom

import { act, h, render } from "../../../../scripts/react-test-render.ts"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
	createRegistryDefaultLayout,
	createTileRegistry,
	type TileRegistration,
} from "../src/tile-registry.ts"
import { TilingWorkspace } from "../src/TilingWorkspace.tsx"

interface Context {
	readonly betaAvailable: boolean
}

const registrations = [
	{
		kind: "alpha",
		name: "Alpha",
		description: "Alpha panel.",
		defaultPlacement: { column: 1 },
		render: () => h("span", { "data-panel": "alpha" }, "Alpha"),
	},
	{
		kind: "beta",
		name: "Beta",
		description: "Beta panel.",
		available: (context) => context.betaAvailable,
		render: () => h("span", { "data-panel": "beta" }, "Beta"),
	},
] as const satisfies readonly TileRegistration<"alpha" | "beta", Context>[]
const registry = createTileRegistry<"alpha" | "beta", Context>(registrations)
const defaultLayout = createRegistryDefaultLayout(registry)
const storageKey = "test:tiling-registry"
const hosts: HTMLElement[] = []
const storage = new Map<string, string>()

beforeEach(() => {
	storage.clear()
	Object.defineProperty(globalThis, "localStorage", {
		configurable: true,
		value: {
			clear: () => storage.clear(),
			getItem: (key: string) => storage.get(key) ?? null,
			setItem: (key: string, value: string) => storage.set(key, value),
		},
	})
})

afterEach(() => {
	for (const host of hosts) {
		render(null, host)
		host.remove()
	}
	hosts.length = 0
})

function host(): HTMLElement {
	const element = document.createElement("div")
	document.body.append(element)
	hosts.push(element)
	return element
}

describe("TilingWorkspace registry integration", () => {
	it("replaces the live workspace from an external durable layout", () => {
		const element = host()
		const onLayoutChange = vi.fn()
		const renderWorkspace = (layout: typeof defaultLayout) =>
			h(TilingWorkspace<"alpha" | "beta", Context>, {
				context: { betaAvailable: true },
				registry,
				defaultLayout,
				storageKey: `${storageKey}:controlled`,
				layout,
				onLayoutChange,
			})
		act(() => render(renderWorkspace(defaultLayout), element))
		onLayoutChange.mockClear()
		const replacement = {
			...defaultLayout,
			columns: defaultLayout.columns.map((column) =>
				column.id === 1 ? { ...column, collapsed: true } : column,
			),
		}
		act(() => render(renderWorkspace(replacement), element))
		expect(
			element.querySelector('button[aria-label="Expand column 1"]'),
		).not.toBeNull()
		expect(onLayoutChange).toHaveBeenCalledTimes(1)
		expect(onLayoutChange).toHaveBeenLastCalledWith(replacement)
	})

	it("keeps keyboard-selected tile-pool options minimally in view", () => {
		const longRegistrations = Array.from({ length: 6 }, (_, index) => ({
			kind: `tile-${index}`,
			name: `Tile ${index}`,
			description: `Tile ${index} panel.`,
			defaultPlacement: { column: 1 as const },
			render: () => h("span", null, `Tile ${index}`),
		}))
		const longRegistry = createTileRegistry<string, Context>(longRegistrations)
		const element = host()
		act(() => {
			render(
				h(TilingWorkspace<string, Context>, {
					context: { betaAvailable: true },
					registry: longRegistry,
					defaultLayout: createRegistryDefaultLayout(longRegistry),
					storageKey: `${storageKey}:long`,
				}),
				element,
			)
		})
		const manage = element.querySelector<HTMLButtonElement>(
			'button[aria-label="Manage tiles"]',
		)
		if (manage === null)
			throw new Error("Tile management control was not found.")
		act(() => manage.click())
		const input = element.querySelector<HTMLInputElement>(
			'input[aria-label="Search tile types"]',
		)
		const results = element.querySelector<HTMLElement>("pool-items")
		const second = document.getElementById("tile-pool-tile-1")
		if (input === null || results === null || second === null)
			throw new Error("Tile pool did not render its options.")
		results.getBoundingClientRect = () => ({
			bottom: 300,
			height: 200,
			left: 0,
			right: 300,
			top: 100,
			width: 300,
			x: 0,
			y: 100,
			toJSON: () => ({}),
		})
		second.getBoundingClientRect = () => ({
			bottom: 350,
			height: 70,
			left: 0,
			right: 300,
			top: 280,
			width: 300,
			x: 0,
			y: 280,
			toJSON: () => ({}),
		})
		act(() => {
			input.dispatchEvent(
				new KeyboardEvent("keydown", {
					bubbles: true,
					key: "ArrowDown",
				}),
			)
		})
		expect(input.getAttribute("aria-activedescendant")).toBe("tile-pool-tile-1")
		expect(results.scrollTop).toBe(50)

		results.scrollTop = 180
		act(() => {
			input.value = "Tile 0"
			input.dispatchEvent(new InputEvent("input", { bubbles: true }))
		})
		expect(results.scrollTop).toBe(0)
	})

	it("opens a missing registered tile and restores focus through a command request", async () => {
		const element = host()
		act(() => {
			render(
				h(TilingWorkspace<"alpha" | "beta", Context>, {
					context: { betaAvailable: true },
					registry,
					defaultLayout,
					storageKey,
					commandRequest: { id: 1, kind: "beta" },
				}),
				element,
			)
		})
		await act(async () => {
			await new Promise((resolve) => requestAnimationFrame(resolve))
			await new Promise((resolve) => requestAnimationFrame(resolve))
		})

		const beta = element.querySelector<HTMLElement>(
			'workspace-tile[data-kind="beta"]',
		)
		expect(beta).not.toBeNull()
		expect(document.activeElement).toBe(beta)
	})

	it("expands a collapsed column before focusing its registered tile", async () => {
		const collapsed = {
			...defaultLayout,
			columns: defaultLayout.columns.map((column) =>
				column.id === 1 ? { ...column, collapsed: true } : column,
			),
		}
		localStorage.setItem(`${storageKey}:saved:v1`, JSON.stringify(collapsed))
		const element = host()
		act(() => {
			render(
				h(TilingWorkspace<"alpha" | "beta", Context>, {
					context: { betaAvailable: true },
					registry,
					defaultLayout,
					storageKey,
					commandRequest: { id: 1, kind: "alpha" },
				}),
				element,
			)
		})
		await act(async () => {
			await new Promise((resolve) => requestAnimationFrame(resolve))
			await new Promise((resolve) => requestAnimationFrame(resolve))
		})

		const alpha = element.querySelector<HTMLElement>(
			'workspace-tile[data-kind="alpha"]',
		)
		expect(alpha).not.toBeNull()
		expect(document.activeElement).toBe(alpha)
		expect(
			element.querySelector('button[aria-label="Expand column 1"]'),
		).toBeNull()
	})

	it("preserves unknown and unavailable persisted tiles without corrupting siblings", () => {
		const persisted = {
			version: 3,
			columns: defaultLayout.columns.map((column) =>
				column.id === 1
					? {
							...column,
							tiles: [
								...column.tiles,
								{ id: "future:1", kind: "future", fill: false },
								{ id: "beta:1", kind: "beta", fill: false },
							],
						}
					: column,
			),
		}
		localStorage.setItem(`${storageKey}:saved:v1`, JSON.stringify(persisted))
		const element = host()
		act(() => {
			render(
				h(TilingWorkspace<"alpha" | "beta", Context>, {
					context: { betaAvailable: false },
					registry,
					defaultLayout,
					storageKey,
				}),
				element,
			)
		})

		expect(element.querySelector('[data-panel="alpha"]')).not.toBeNull()
		expect(element.textContent).toContain("“future” is not registered")
		expect(element.textContent).toContain("Beta unavailable")
		const draft = localStorage.getItem(`${storageKey}:draft:v1`) ?? ""
		expect(draft).toContain('"kind":"future"')
		expect(draft).toContain('"kind":"beta"')
	})
})
