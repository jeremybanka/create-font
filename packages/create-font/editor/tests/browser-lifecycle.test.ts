// @vitest-environment happy-dom

import { act } from "preact/test-utils"
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
