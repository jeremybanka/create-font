// @vitest-environment happy-dom

import { act, h, render } from "../../../../scripts/react-test-render.ts"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

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
