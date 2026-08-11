// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest"

import { createEditorWorkspace } from "../src/editor-workspace.ts"

afterEach(() => {
	vi.restoreAllMocks()
})

describe("editor workspace lifecycle", () => {
	it("removes browser navigation listeners when disposed", () => {
		const documentAdd = vi.spyOn(document, "addEventListener")
		const documentRemove = vi.spyOn(document, "removeEventListener")
		const windowAdd = vi.spyOn(window, "addEventListener")
		const windowRemove = vi.spyOn(window, "removeEventListener")
		const workspace = createEditorWorkspace()

		workspace.startBrowserNavigation()
		const clickListener = documentAdd.mock.calls.find(
			([type]) => type === "click",
		)?.[1]
		const popstateListener = windowAdd.mock.calls.find(
			([type]) => type === "popstate",
		)?.[1]
		expect(clickListener).toBeTypeOf("function")
		expect(popstateListener).toBeTypeOf("function")

		workspace.dispose()

		expect(documentRemove).toHaveBeenCalledWith("click", clickListener)
		expect(windowRemove).toHaveBeenCalledWith("popstate", popstateListener)
	})

	it("restarting navigation replaces the previous listener ownership", () => {
		const documentAdd = vi.spyOn(document, "addEventListener")
		const documentRemove = vi.spyOn(document, "removeEventListener")
		const workspace = createEditorWorkspace()

		workspace.startBrowserNavigation()
		const firstClickListener = documentAdd.mock.calls.find(
			([type]) => type === "click",
		)?.[1]
		workspace.startBrowserNavigation()

		expect(documentRemove).toHaveBeenCalledWith("click", firstClickListener)
		workspace.dispose()
	})

	it("preserves URL-backed workspace context across editor navigation", () => {
		history.replaceState(null, ``, `/?font=beta`)
		const workspace = createEditorWorkspace()
		workspace.startBrowserNavigation()
		const anchor = document.createElement(`a`)
		anchor.href = `/info`
		document.body.append(anchor)

		anchor.click()
		expect(window.location.pathname).toBe(`/info`)
		expect(window.location.search).toBe(`?font=beta`)

		workspace.actions.navigate(`/glyphs`)
		expect(window.location.pathname).toBe(`/glyphs`)
		expect(window.location.search).toBe(`?font=beta`)

		workspace.dispose()
		anchor.remove()
		history.replaceState(null, ``, `/`)
	})
})
