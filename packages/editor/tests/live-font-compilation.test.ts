import type { FontCompilation } from "@create-font/states"
import { Silo } from "atom.io"
import { describe, expect, it, vi } from "vitest"

import {
	createBrowserFontFaceManager,
	type BrowserFontFaceEnvironment,
} from "../src/browser-font-face.ts"
import { createEditorWorkspace } from "../src/editor-workspace.ts"
import { aGlyphId, oGlyphId, razorMasterId } from "../src/demo-font.ts"
import {
	createLiveFontCompiler,
	LIVE_FONT_EDIT_DEBOUNCE_MS,
} from "../src/live-font-compilation.ts"

function successfulCompilation(): FontCompilation {
	return {
		ok: true,
		stage: "compiled",
		source: {} as Extract<FontCompilation, { ok: true }>["source"],
		font: {} as Extract<FontCompilation, { ok: true }>["font"],
		projectionWarnings: [],
		ingestionWarnings: [],
	}
}

async function settle(): Promise<void> {
	await Promise.resolve()
	await Promise.resolve()
}

describe("live font compilation", () => {
	it("runs only while at least one preview consumer retains it", () => {
		const silo = new Silo({
			name: "live-font-retain-test",
			lifespan: "ephemeral",
			isProduction: false,
		})
		const revision = silo.atom({ key: "revision", default: 0 })
		const scheduled: (() => void)[] = []
		const compiler = createLiveFontCompiler(
			{ silo, documentRevision: revision, compilation: successfulCompilation },
			{
				schedule: (work) => scheduled.push(work),
				serialize: () => new Uint8Array([1]),
			},
		)

		silo.setState(revision, 1)
		expect(scheduled).toHaveLength(0)
		const releaseFirst = compiler.retain()
		const releaseSecond = compiler.retain()
		expect(scheduled).toHaveLength(1)
		releaseFirst()
		silo.setState(revision, 2)
		expect(scheduled).toHaveLength(2)
		releaseSecond()
		silo.setState(revision, 3)
		expect(scheduled).toHaveLength(2)
	})

	it("defers compilation beyond the input turn and coalesces an edit burst", async () => {
		vi.useFakeTimers()
		try {
			const silo = new Silo({
				name: "live-font-debounce-test",
				lifespan: "ephemeral",
				isProduction: false,
			})
			const revision = silo.atom({ key: "revision", default: 0 })
			const compilation = vi.fn(successfulCompilation)
			const compiler = createLiveFontCompiler(
				{ silo, documentRevision: revision, compilation },
				{ serialize: () => new Uint8Array([1]) },
			)

			compiler.start()
			for (let value = 1; value <= 5; value += 1) silo.setState(revision, value)

			expect(compilation).not.toHaveBeenCalled()
			await vi.advanceTimersByTimeAsync(LIVE_FONT_EDIT_DEBOUNCE_MS)
			await settle()
			expect(compilation).toHaveBeenCalledTimes(1)
			expect(silo.getState(compiler.state)).toMatchObject({
				status: "ready",
				revision: 5,
			})
			compiler.stop()
		} finally {
			vi.useRealTimers()
		}
	})

	it("suppresses stale serialized bytes and retains the last good artifact", async () => {
		const silo = new Silo({
			name: "live-font-test",
			lifespan: "ephemeral",
			isProduction: false,
		})
		const revision = silo.atom({ key: "revision", default: 0 })
		const scheduled: (() => void)[] = []
		const pending: {
			resolve: (bytes: Uint8Array) => void
			reject: (error: Error) => void
		}[] = []
		const compiler = createLiveFontCompiler(
			{
				silo,
				documentRevision: revision,
				compilation: successfulCompilation,
			},
			{
				now: (() => {
					let time = 0
					return () => ++time
				})(),
				schedule: (work) => scheduled.push(work),
				serialize: () =>
					new Promise((resolve, reject) => {
						pending.push({ resolve, reject })
					}),
			},
		)

		compiler.start()
		scheduled.shift()?.()
		silo.setState(revision, 1)
		scheduled.shift()?.()
		pending[1]?.resolve(new Uint8Array([2]))
		await settle()
		expect(silo.getState(compiler.state)).toMatchObject({
			status: "ready",
			generation: 2,
			artifact: { bytes: new Uint8Array([2]), revision: 1 },
		})

		pending[0]?.resolve(new Uint8Array([1]))
		await settle()
		expect(silo.getState(compiler.state)).toMatchObject({
			status: "ready",
			generation: 2,
			artifact: { bytes: new Uint8Array([2]) },
		})

		silo.setState(revision, 2)
		scheduled.shift()?.()
		pending[2]?.reject(new Error("invalid outline"))
		await settle()
		expect(silo.getState(compiler.state)).toMatchObject({
			status: "failed",
			diagnostics: [{ code: "live-font.serialization-failed" }],
			lastGood: { bytes: new Uint8Array([2]) },
		})
		compiler.stop()
	})

	it("publishes recoverable compatibility diagnostics and clears them after repair", async () => {
		const silo = new Silo({
			name: "live-font-degraded-test",
			lifespan: "ephemeral",
			isProduction: false,
		})
		const revision = silo.atom({ key: "revision", default: 0 })
		const scheduled: (() => void)[] = []
		let degraded = true
		const compiler = createLiveFontCompiler(
			{
				silo,
				documentRevision: revision,
				compilation: () => ({
					...successfulCompilation(),
					projectionWarnings: degraded
						? [
								{
									code: "compatibility.node_count",
									path: "$.glyphs[glyph:O]",
									message: "O is frozen to its default master.",
									severity: "warning",
									entityId: "glyph:O",
								},
							]
						: [],
				}),
			},
			{
				schedule: (work) => scheduled.push(work),
				serialize: () => new Uint8Array([1]),
			},
		)

		compiler.start()
		scheduled.shift()?.()
		await settle()
		expect(silo.getState(compiler.state)).toMatchObject({
			status: "ready",
			diagnostics: [
				{
					code: "compatibility.node_count",
					message: "O is frozen to its default master.",
					stage: "projection",
				},
			],
		})

		degraded = false
		silo.setState(revision, 1)
		scheduled.shift()?.()
		await settle()
		expect(silo.getState(compiler.state)).toMatchObject({
			status: "ready",
			revision: 1,
			diagnostics: [],
		})
		compiler.stop()
	})

	it("reuses unrelated atom.io glyph projection artifacts after one glyph edit", () => {
		const workspace = createEditorWorkspace()
		const beforeCompilation = workspace.font.read.compilation()
		const beforeA = workspace.font.silo.getState(
			workspace.font.selectors.glyphSource,
			aGlyphId,
		)
		const beforeO = workspace.font.silo.getState(
			workspace.font.selectors.glyphSource,
			oGlyphId,
		)
		const source = workspace.font.read.editorSource()
		const point = source?.glyphs
			.find((glyph) => glyph.id === oGlyphId)
			?.layers.find((layer) => layer.masterId === razorMasterId)?.contours[0]
			?.points[0]
		if (point === undefined) throw new Error("Fixture point is missing.")

		workspace.font.actions.movePoints({
			masterId: razorMasterId,
			glyphId: oGlyphId,
			points: [{ pointId: point.id, x: point.x + 1, y: point.y }],
		})

		const afterA = workspace.font.silo.getState(
			workspace.font.selectors.glyphSource,
			aGlyphId,
		)
		const afterO = workspace.font.silo.getState(
			workspace.font.selectors.glyphSource,
			oGlyphId,
		)
		expect(afterA).toBe(beforeA)
		expect(afterO).not.toBe(beforeO)
		const afterCompilation = workspace.font.read.compilation()
		expect(afterCompilation).not.toBe(beforeCompilation)
		if (beforeCompilation.ok && afterCompilation.ok) {
			const compiledBefore = beforeCompilation.font.glyphs.find(
				(glyph) => glyph.name === "O",
			)
			const compiledAfter = afterCompilation.font.glyphs.find(
				(glyph) => glyph.name === "O",
			)
			expect(compiledAfter?.contours).not.toEqual(compiledBefore?.contours)
		}
	})
})

describe("browser font face lifecycle", () => {
	it("keeps the previous face until replacement loads and cleans every resource", async () => {
		const loaded: (() => void)[] = []
		const added: object[] = []
		const deleted: object[] = []
		const revoked: string[] = []
		const families: string[] = []
		let url = 0
		const environment: BrowserFontFaceEnvironment = {
			createFontFace: (family) => {
				families.push(family)
				return {
					load() {
						return new Promise((resolve) => loaded.push(() => resolve(this)))
					},
				}
			},
			createObjectURL: () => `blob:${++url}`,
			fonts: {
				add: (face) => added.push(face),
				delete: (face) => (deleted.push(face), true),
			},
			now: vi.fn(() => 1),
			revokeObjectURL: (value) => revoked.push(value),
		}
		const manager = createBrowserFontFaceManager("Live Test", environment)
		const first = manager.activate({
			bytes: new Uint8Array([1]),
			generation: 1,
			revision: 1,
			timings: {
				queueing: 0,
				projectionAndIngestion: 1,
				serialization: 1,
				total: 2,
			},
		})
		loaded.shift()?.()
		await first
		expect(added).toHaveLength(1)

		const second = manager.activate({
			bytes: new Uint8Array([2]),
			generation: 2,
			revision: 2,
			timings: {
				queueing: 0,
				projectionAndIngestion: 1,
				serialization: 1,
				total: 2,
			},
		})
		expect(deleted).toHaveLength(0)
		loaded.shift()?.()
		await second
		expect(families).toEqual(["Live Test 1", "Live Test 2"])
		expect(added).toHaveLength(2)
		expect(deleted).toHaveLength(1)
		expect(revoked).toEqual(["blob:1"])

		manager.dispose()
		expect(deleted).toHaveLength(2)
		expect(revoked).toEqual(["blob:1", "blob:2"])
	})

	it("revokes a superseded face that finishes loading late", async () => {
		const loaded: (() => void)[] = []
		const revoked: string[] = []
		let url = 0
		const manager = createBrowserFontFaceManager("Live Test", {
			createFontFace: () => ({
				load() {
					return new Promise((resolve) => loaded.push(() => resolve(this)))
				},
			}),
			createObjectURL: () => `blob:${++url}`,
			fonts: { add: () => {}, delete: () => true },
			revokeObjectURL: (value) => revoked.push(value),
		})
		const artifact = {
			bytes: new Uint8Array([1]),
			revision: 1,
			timings: {
				queueing: 0,
				projectionAndIngestion: 1,
				serialization: 1,
				total: 2,
			},
		}
		const first = manager.activate({ ...artifact, generation: 1 })
		const second = manager.activate({ ...artifact, generation: 2 })
		loaded[1]?.()
		await second
		loaded[0]?.()
		expect(await first).toBeNull()
		expect(revoked).toContain("blob:1")
		manager.dispose()
	})
})
