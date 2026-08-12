// @vitest-environment happy-dom

import { act } from "../../../../scripts/react-test-render.ts"
import { afterEach, describe, expect, it, vi } from "vitest"

import { makeDemoFont } from "../src/demo-font.ts"
import type { MountedEditor } from "../src/browser-api.ts"

vi.mock("../src/AppShell.tsx", () => ({ AppShell: () => null }))
vi.mock("../src/browser-font-face.ts", () => ({
	startBrowserLiveFont: () => () => {},
}))

afterEach(() => {
	vi.restoreAllMocks()
})

describe("mounted editor lifecycle", () => {
	it("moves from an inert opening shell through retry to the hydrated editor", async () => {
		const retry = vi.fn()
		const host = document.createElement("div")
		document.body.append(host)
		const { mountEditor } = await import("../src/browser.ts")
		let mounted: MountedEditor | undefined
		act(() => {
			mounted = mountEditor(host, { startup: { type: `loading` } })
		})

		const shell = host.querySelector<HTMLElement>(`app-shell`)
		expect(shell?.getAttribute(`aria-busy`)).toBe(`true`)
		expect(shell?.dataset.startupState).toBe(`loading`)
		expect(host.textContent).toContain(`Preparing editable outlines`)
		expect(host.querySelector(`hydrated-editor-application`)).toBeNull()
		expect(
			[...host.querySelectorAll<HTMLButtonElement>(`header button`)].every(
				(button) => button.disabled,
			),
		).toBe(true)

		act(() =>
			mounted?.update({
				startup: {
					type: `error`,
					message: `Snapshot request failed.`,
					onRetry: retry,
				},
			}),
		)
		expect(shell?.getAttribute(`aria-busy`)).toBe(`false`)
		expect(shell?.dataset.startupState).toBe(`error`)
		expect(host.textContent).toContain(`Snapshot request failed.`)
		act(() =>
			host
				.querySelector<HTMLButtonElement>(`source-startup-card button`)
				?.click(),
		)
		expect(retry).toHaveBeenCalledOnce()

		act(() => mounted?.update({ source: makeDemoFont() }))
		expect(host.querySelector(`source-startup-card`)).toBeNull()
		expect(host.querySelector(`hydrated-editor-application`)).not.toBeNull()
		act(() => mounted?.unmount())
		host.remove()
	})

	it("releases workspace navigation listeners on unmount", async () => {
		const documentAdd = vi.spyOn(document, "addEventListener")
		const documentRemove = vi.spyOn(document, "removeEventListener")
		const windowAdd = vi.spyOn(window, "addEventListener")
		const windowRemove = vi.spyOn(window, "removeEventListener")
		const host = document.createElement("div")
		document.body.append(host)
		const { mountEditor } = await import("../src/browser.ts")
		let mounted: MountedEditor | undefined
		act(() => {
			mounted = mountEditor(host, { source: makeDemoFont() })
		})
		const clickListener = documentAdd.mock.calls.find(
			([type]) => type === "click",
		)?.[1]
		const popstateListener = windowAdd.mock.calls.find(
			([type]) => type === "popstate",
		)?.[1]

		expect(clickListener).toBeTypeOf("function")
		expect(popstateListener).toBeTypeOf("function")
		act(() => mounted?.unmount())

		expect(documentRemove).toHaveBeenCalledWith("click", clickListener)
		expect(windowRemove).toHaveBeenCalledWith("popstate", popstateListener)
		host.remove()
	})
})
