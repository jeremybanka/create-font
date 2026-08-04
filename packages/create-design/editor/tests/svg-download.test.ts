import { describe, expect, it, vi } from "vitest"

import { createInitialDocument } from "../src/document.ts"
import { createSvgDownloadManager } from "../src/svg-download.ts"

describe("SVG download generation safety", () => {
	it("activates only the newest serialization and names the artifact", async () => {
		const resolvers: ((bytes: Uint8Array) => void)[] = []
		const activate = vi.fn()
		const manager = createSvgDownloadManager({
			activate,
			createObjectURL: () => "blob:newest",
			revokeObjectURL: vi.fn(),
			serialize: () => new Promise((resolve) => resolvers.push(resolve)),
		})
		const document = createInitialDocument()
		const target = { artboardId: document.artboards[0]!.id }
		const stale = manager.request(document, target)
		const newest = manager.request(document, target)
		resolvers[0]?.(new Uint8Array([1]))
		expect(await stale).toBe(false)
		resolvers[1]?.(new Uint8Array([2]))
		expect(await newest).toBe(true)
		expect(activate).toHaveBeenCalledWith("blob:newest", "Untitled design.svg")
	})

	it("suppresses pending output after disposal", async () => {
		let resolve: ((bytes: Uint8Array) => void) | undefined
		const activate = vi.fn()
		const manager = createSvgDownloadManager({
			activate,
			createObjectURL: () => "blob:disposed",
			revokeObjectURL: vi.fn(),
			serialize: () =>
				new Promise((next) => {
					resolve = next
				}),
		})
		const document = createInitialDocument()
		const pending = manager.request(document, {
			artboardId: document.artboards[0]!.id,
		})
		manager.dispose()
		resolve?.(new Uint8Array([1]))
		expect(await pending).toBe(false)
		expect(activate).not.toHaveBeenCalled()
	})
})
