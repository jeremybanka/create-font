import { describe, expect, it, vi } from "vitest"

import { createInitialDocument } from "../src/document.ts"
import { createPdfDownloadManager } from "../src/pdf-download.ts"

describe("PDF download generation safety", () => {
	it("activates only the newest serialization result", async () => {
		const resolvers: ((bytes: Uint8Array) => void)[] = []
		const activate = vi.fn()
		const createObjectURL = vi.fn(() => "blob:newest")
		const revokeObjectURL = vi.fn()
		const manager = createPdfDownloadManager({
			activate,
			createObjectURL,
			revokeObjectURL,
			serialize: () =>
				new Promise((resolve) => {
					resolvers.push(resolve)
				}),
		})
		const document = createInitialDocument()
		const first = manager.request(document, {
			scope: { kind: "active", artboardId: document.artboards[0]!.id },
		})
		const second = manager.request(document, { scope: { kind: "all" } })
		resolvers[0]?.(new Uint8Array([1]))
		expect(await first).toBe(false)
		resolvers[1]?.(new Uint8Array([2]))
		expect(await second).toBe(true)
		expect(createObjectURL).toHaveBeenCalledTimes(1)
		expect(activate).toHaveBeenCalledWith("blob:newest", "Untitled design.pdf")
	})

	it("suppresses a pending result after disposal", async () => {
		let resolve: ((bytes: Uint8Array) => void) | undefined
		const activate = vi.fn()
		const manager = createPdfDownloadManager({
			activate,
			createObjectURL: () => "blob:disposed",
			revokeObjectURL: vi.fn(),
			serialize: () =>
				new Promise((next) => {
					resolve = next
				}),
		})
		const document = createInitialDocument()
		const pending = manager.request(document, { scope: { kind: "all" } })
		manager.dispose()
		resolve?.(new Uint8Array([1]))
		expect(await pending).toBe(false)
		expect(activate).not.toHaveBeenCalled()
	})

	it("suppresses errors from stale serialization generations", async () => {
		const rejectors: ((error: Error) => void)[] = []
		const resolvers: ((bytes: Uint8Array) => void)[] = []
		const manager = createPdfDownloadManager({
			activate: vi.fn(),
			createObjectURL: () => "blob:newest",
			revokeObjectURL: vi.fn(),
			serialize: () =>
				new Promise((resolve, reject) => {
					resolvers.push(resolve)
					rejectors.push(reject)
				}),
		})
		const document = createInitialDocument()
		const stale = manager.request(document, { scope: { kind: "all" } })
		const newest = manager.request(document, { scope: { kind: "all" } })
		rejectors[0]?.(new Error("stale failure"))
		expect(await stale).toBe(false)
		resolvers[1]?.(new Uint8Array([2]))
		expect(await newest).toBe(true)
	})
})
