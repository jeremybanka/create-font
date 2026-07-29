import { describe, expect, it } from "vitest"

import {
	createBrowserPdfPreviewManager,
	type BrowserPdfPreviewEnvironment,
} from "../src/browser-pdf-preview.ts"
import type { LivePdfArtifact } from "../src/live-pdf-compilation.ts"

const artifact = (generation: number): LivePdfArtifact => ({
	bytes: new Uint8Array([generation]),
	generation,
	requestedAt: 0,
	revision: generation,
	timings: {
		projection: 1,
		queueing: 2,
		total: 6,
		validationAndSerialization: 3,
	},
})

describe("browser PDF preview lifecycle", () => {
	it("keeps the active proof while loading and releases every superseded URL", () => {
		const revoked: string[] = []
		let nextUrl = 0
		const environment: BrowserPdfPreviewEnvironment = {
			createObjectURL: () => `blob:${++nextUrl}`,
			now: () => 10,
			revokeObjectURL: (url) => revoked.push(url),
		}
		const manager = createBrowserPdfPreviewManager(environment)
		const first = manager.activate(artifact(1))!
		manager.didLoad(first)
		const second = manager.activate(artifact(2))!
		expect(manager.getState()).toMatchObject({
			active: first,
			pending: second,
			status: "loading",
		})
		const third = manager.activate(artifact(3))!
		expect(revoked).toEqual(["blob:2"])
		manager.didLoad(second)
		expect(manager.getState()).toMatchObject({
			pending: third,
			status: "loading",
		})
		manager.didLoad(third)
		expect(revoked).toEqual(["blob:2", "blob:1"])
		expect(manager.getState()).toMatchObject({
			active: { url: "blob:3", timings: { activation: 4, total: 10 } },
			status: "ready",
		})
		manager.dispose()
		expect(revoked).toEqual(["blob:2", "blob:1", "blob:3"])
	})

	it("preserves the last good proof when activation fails", () => {
		const revoked: string[] = []
		let nextUrl = 0
		const manager = createBrowserPdfPreviewManager({
			createObjectURL: () => `blob:${++nextUrl}`,
			revokeObjectURL: (url) => revoked.push(url),
		})
		const first = manager.activate(artifact(1))!
		manager.didLoad(first)
		const second = manager.activate(artifact(2))!
		manager.didFail(second, new Error("viewer rejected bytes"))
		expect(manager.getState()).toMatchObject({
			active: first,
			diagnostic: {
				message: "viewer rejected bytes",
				stage: "activation",
			},
			status: "failed",
		})
		expect(revoked).toEqual(["blob:2"])
		manager.dispose()
		expect(revoked).toEqual(["blob:2", "blob:1"])
	})
})
