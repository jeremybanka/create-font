import { describe, expect, it } from "vitest"

import {
	createBrowserSvgPreviewManager,
	type BrowserSvgPreviewEnvironment,
} from "../src/browser-svg-preview.ts"
import type { LiveSvgArtifact } from "@create-design/svg"

const artifact = (generation: number): LiveSvgArtifact => ({
	bytes: new Uint8Array([generation]),
	generation,
	preflight: {
		artboard: null,
		decision: "ready",
		diagnostics: [],
		summary: { errors: 0, infos: 0, warnings: 0 },
		target: "svg",
	},
	requestedAt: 0,
	revision: generation,
	timings: { projection: 1, queueing: 2, serialization: 3, total: 6 },
})

describe("browser SVG preview lifecycle", () => {
	it("keeps the active proof and releases superseded resources", () => {
		const revoked: string[] = []
		let nextUrl = 0
		const environment: BrowserSvgPreviewEnvironment = {
			createObjectURL: () => `blob:${++nextUrl}`,
			now: () => 10,
			revokeObjectURL: (url) => revoked.push(url),
		}
		const manager = createBrowserSvgPreviewManager(environment)
		const first = manager.activate(artifact(1))!
		manager.didLoad(first)
		const second = manager.activate(artifact(2))!
		const third = manager.activate(artifact(3))!
		expect(revoked).toEqual(["blob:2"])
		manager.didLoad(second)
		expect(manager.getState()).toMatchObject({
			pending: third,
			status: "loading",
		})
		manager.didLoad(third)
		expect(manager.getState()).toMatchObject({
			active: { url: "blob:3", timings: { activation: 4, total: 10 } },
			status: "ready",
		})
		expect(revoked).toEqual(["blob:2", "blob:1"])
		manager.dispose()
		expect(revoked).toEqual(["blob:2", "blob:1", "blob:3"])
	})

	it("preserves the last good proof after activation failure", () => {
		const revoked: string[] = []
		let nextUrl = 0
		const manager = createBrowserSvgPreviewManager({
			createObjectURL: () => `blob:${++nextUrl}`,
			revokeObjectURL: (url) => revoked.push(url),
		})
		const first = manager.activate(artifact(1))!
		manager.didLoad(first)
		const second = manager.activate(artifact(2))!
		manager.didFail(second, new Error("viewer rejected SVG"))
		expect(manager.getState()).toMatchObject({
			active: first,
			diagnostic: { message: "viewer rejected SVG", stage: "activation" },
			status: "failed",
		})
		expect(revoked).toEqual(["blob:2"])
	})
})
