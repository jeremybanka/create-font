// @vitest-environment happy-dom

import { act, h, render } from "../../../../scripts/react-test-render.ts"
import type { UiLayoutRecordV1 } from "@create-art/ui-layout"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { UiLayoutControl } from "../src/UiLayoutControl.tsx"

const slots = Array.from({ length: 12 }, () => null)
const layout = {
	version: 1,
	id: "layout-a",
	name: "Shared",
	product: "create-font",
	state: {
		tiling: {
			version: 3,
			columns: [1, 2, 3, 4].map((id) => ({
				id: id as 1 | 2 | 3 | 4,
				alignment: "top" as const,
				collapsed: false,
				tiles: [],
			})),
		},
		hotbars: { primary: slots, alternate: slots },
		preferences: { diffView: false },
	},
} satisfies UiLayoutRecordV1

beforeEach(() => {
	const values = new Map<string, string>()
	vi.stubGlobal("localStorage", {
		getItem: (key: string) => values.get(key) ?? null,
		setItem: (key: string, value: string) => values.set(key, value),
		removeItem: (key: string) => values.delete(key),
		clear: () => values.clear(),
		get length() {
			return values.size
		},
		key: (index: number) => [...values.keys()][index] ?? null,
	})
})

afterEach(() => {
	render(null, document.body)
	document.body.replaceChildren()
	localStorage.clear()
	vi.unstubAllGlobals()
})

async function settle(): Promise<void> {
	await act(async () => {
		await Promise.resolve()
		await Promise.resolve()
	})
}

describe("UI layout header control", () => {
	it("disambiguates origins, restores a layout, persists edits, and saves", async () => {
		const sources = [
			{ origin: "home", revision: "home-1", layouts: [layout], issues: [] },
			{
				origin: "project",
				revision: "project-1",
				layouts: [{ ...layout, id: "layout-b" }],
				issues: [],
			},
		] as const
		const requests: RequestInit[] = []
		vi.stubGlobal(
			"fetch",
			vi.fn(async (_url: string, init?: RequestInit) => {
				requests.push(init ?? {})
				const returnedSources =
					init?.method === "POST"
						? sources.map((source) =>
								source.origin === "project"
									? {
											...source,
											layouts: [JSON.parse(String(init.body)).layout],
											revision: "project-2",
										}
									: source,
							)
						: sources
				return new Response(JSON.stringify({ sources: returnedSources }), {
					status: 200,
					headers: { "content-type": "application/json" },
				})
			}),
		)
		const applied = vi.fn()
		act(() => {
			render(
				h(UiLayoutControl, {
					product: "create-font",
					current: { ...layout, id: "local", name: "My layout" },
					onApply: applied,
				}),
				document.body,
			)
		})
		await settle()
		const select = document.querySelector<HTMLSelectElement>(
			'select[aria-label="Saved UI layout"]',
		)
		expect([...select!.options].map(({ text }) => text)).toEqual([
			"Current local layout",
			"Shared — Home",
			"Shared — Project",
		])
		act(() => {
			select!.value = "project:layout-b"
			select!.dispatchEvent(new Event("change", { bubbles: true }))
		})
		expect(applied).toHaveBeenCalledWith(
			expect.objectContaining({ id: "layout-b" }),
		)
		expect(localStorage.getItem("create-font:ui-layout:selection:v1")).toBe(
			"project:layout-b",
		)
		expect(document.querySelector('[role="status"]')).toBeNull()

		const name = document.querySelector<HTMLInputElement>(
			'input[aria-label="Layout name"]',
		)!
		act(() => {
			Object.getOwnPropertyDescriptor(
				HTMLInputElement.prototype,
				"value",
			)?.set?.call(name, "Renamed")
			name.dispatchEvent(new InputEvent("input", { bubbles: true }))
		})
		act(() =>
			document
				.querySelector<HTMLButtonElement>("ui-layout-control button")!
				.click(),
		)
		await settle()
		expect(requests.at(-1)?.method).toBe("POST")
		const body = JSON.parse(String(requests.at(-1)?.body))
		expect(body).toMatchObject({
			origin: "project",
			expectedRevision: "project-1",
			layout: { id: "layout-b", name: "Renamed" },
		})
		expect(localStorage.getItem("create-font:ui-layout:working:v1")).toContain(
			'"name":"Renamed"',
		)
	})

	it("keeps malformed filesystem data visible without replacing local state", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(
				async () =>
					new Response(
						JSON.stringify({
							sources: [
								{
									origin: "home",
									revision: "bad",
									layouts: [],
									issues: [
										{
											file: "/tmp/ui.json",
											path: "$[0].version",
											message: "Expected 1",
										},
									],
								},
							],
						}),
					),
			),
		)
		const applied = vi.fn()
		act(() =>
			render(
				h(UiLayoutControl, {
					product: "create-font",
					current: layout,
					onApply: applied,
				}),
				document.body,
			),
		)
		await settle()
		expect(applied).not.toHaveBeenCalled()
		expect(document.querySelector('[role="alert"]')?.textContent).toContain(
			"$[0].version",
		)
	})

	it("restores a browser working copy and keeps split-state migration durable offline", async () => {
		localStorage.setItem(
			"create-font:ui-layout:working:v1",
			JSON.stringify({
				...layout,
				state: {
					...layout.state,
					preferences: { diffView: true },
				},
			}),
		)
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => Promise.reject(new Error("offline"))),
		)
		const applied = vi.fn()
		act(() =>
			render(
				h(UiLayoutControl, {
					product: "create-font",
					current: layout,
					onApply: applied,
				}),
				document.body,
			),
		)
		await settle()
		expect(applied).toHaveBeenCalledWith(
			expect.objectContaining({
				state: expect.objectContaining({ preferences: { diffView: true } }),
			}),
		)
		expect(
			localStorage.getItem("create-font:ui-layout:working:v1"),
		).not.toBeNull()
		expect(document.querySelector('[role="alert"]')?.textContent).toBe(
			"offline",
		)
	})
})
