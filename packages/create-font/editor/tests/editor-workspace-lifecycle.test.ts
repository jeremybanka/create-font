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
})
