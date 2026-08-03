// @vitest-environment happy-dom

import { execFile } from "node:child_process"
import { cp, mkdtemp, readFile, rm } from "node:fs/promises"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { promisify } from "node:util"

import type {
	EditorBrowserOptions,
	MountedEditor,
} from "@create-font/editor/browser"
import { h, render } from "preact"
import { act } from "preact/test-utils"
import { afterEach, describe, expect, it, vi } from "vitest"

import {
	applySourceSyncDelta,
	assembleSourceSyncState,
	sourceSyncStateFromSnapshot,
	sourceUnitWrites,
	type SourceSyncState,
} from "../public/source-sync.ts"
import { createFileSystemSourceService } from "../src/source-service.ts"
import { mountEditor } from "../../../packages/create-font/editor/src/browser.ts"
import { createEditorWorkspace } from "../../../packages/create-font/editor/src/editor-workspace.ts"
import { GlyphCanvas } from "../../../packages/create-font/editor/src/GlyphCanvas.tsx"
import { EditorStateContext } from "../../../packages/create-font/editor/src/state-hooks.ts"

const execFileAsync = promisify(execFile)
const requireFromRenderer = createRequire(
	`${process.cwd()}/../../packages/preact-konva/package.json`,
)
const { default: Konva } = await import(
	requireFromRenderer.resolve(`konva/lib/Core`)
)
const hosts: HTMLElement[] = []
const roots: string[] = []
const subscriptions: Array<() => void> = []
const mountedEditors: MountedEditor[] = []

afterEach(async () => {
	for (const mounted of mountedEditors) mounted.unmount()
	mountedEditors.length = 0
	for (const host of hosts) {
		render(null, host)
		host.remove()
	}
	hosts.length = 0
	for (const stop of subscriptions) stop()
	subscriptions.length = 0
	await Promise.all(
		roots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
	)
	window.history.replaceState(null, ``, `/`)
	vi.restoreAllMocks()
	vi.unstubAllGlobals()
})

function stubBrowserLayout(): void {
	vi.stubGlobal(`FontFace`, undefined)
	vi.spyOn(HTMLCanvasElement.prototype, `getContext`).mockImplementation(
		function (this: HTMLCanvasElement) {
			const context = {
				canvas: this,
				createImageData: (width: number, height: number) => ({
					data: new Uint8ClampedArray(width * height * 4),
					height,
					width,
				}),
				getImageData: () => ({ data: new Uint8ClampedArray(4) }),
				measureText: () => ({ width: 0 }),
			}
			return new Proxy(context, {
				get: (target, key) =>
					key in target ? target[key as keyof typeof target] : () => undefined,
			}) as unknown as CanvasRenderingContext2D
		},
	)
	vi.stubGlobal(
		`ResizeObserver`,
		class {
			observe() {}
			disconnect() {}
			unobserve() {}
		},
	)
	vi.spyOn(window, `matchMedia`).mockImplementation(
		() =>
			({
				addEventListener() {},
				matches: false,
				removeEventListener() {},
			}) as unknown as MediaQueryList,
	)
}

function inputForLabel(host: HTMLElement, text: string): HTMLInputElement {
	const label = [...host.querySelectorAll(`label`)].find(
		(candidate) => candidate.querySelector(`span`)?.textContent === text,
	)
	const input = label?.querySelector<HTMLInputElement>(`input`)
	if (input === null || input === undefined) {
		throw new Error(`${text} input is missing.`)
	}
	return input
}

type PendingCondition = {
	assertion: () => void | Promise<void>
	lastFailure: unknown
	running: boolean
	rerun: boolean
	timer: ReturnType<typeof setTimeout>
	resolve: () => void
	reject: (error: unknown) => void
}

function conditionWaiter() {
	const pending = new Set<PendingCondition>()
	let terminalFailure: unknown

	const settle = (condition: PendingCondition): void => {
		clearTimeout(condition.timer)
		pending.delete(condition)
	}
	const evaluate = async (condition: PendingCondition): Promise<void> => {
		if (!pending.has(condition)) return
		if (condition.running) {
			condition.rerun = true
			return
		}
		condition.running = true
		do {
			condition.rerun = false
			try {
				await condition.assertion()
				settle(condition)
				condition.resolve()
				return
			} catch (error) {
				condition.lastFailure = error
			}
		} while (condition.rerun)
		condition.running = false
	}

	return {
		fail(error: unknown): void {
			terminalFailure = error
			for (const condition of pending) {
				settle(condition)
				condition.reject(error)
			}
		},
		notify(): void {
			for (const condition of pending) void evaluate(condition)
		},
		wait(
			label: string,
			assertion: () => void | Promise<void>,
			timeout = 8_000,
		): Promise<void> {
			if (terminalFailure !== undefined) return Promise.reject(terminalFailure)
			return new Promise((resolveCondition, rejectCondition) => {
				const condition = {
					assertion,
					lastFailure: undefined,
					reject: rejectCondition,
					rerun: false,
					resolve: resolveCondition,
					running: false,
					timer: setTimeout(() => {
						pending.delete(condition)
						rejectCondition(
							new Error(`Timed out after ${timeout}ms waiting for ${label}.`, {
								cause: condition.lastFailure,
							}),
						)
					}, timeout),
				} satisfies PendingCondition
				pending.add(condition)
				void evaluate(condition)
			})
		},
	}
}

describe(`create-font filesystem observability`, () => {
	it(`replaces an in-editor UI change after git restores the source file`, async () => {
		stubBrowserLayout()
		const root = await mkdtemp(join(tmpdir(), `create-font-observability-`))
		roots.push(root)
		await cp(
			resolve(import.meta.dirname, `../../../fonts/workbench-sans`),
			root,
			{ recursive: true },
		)
		await execFileAsync(`git`, [`init`, `--quiet`], { cwd: root })
		await execFileAsync(`git`, [`add`, `names.json`], { cwd: root })
		await execFileAsync(
			`git`,
			[
				`-c`,
				`user.name=create-font test`,
				`-c`,
				`user.email=create-font@example.invalid`,
				`commit`,
				`--quiet`,
				`-m`,
				`Record source baseline`,
			],
			{ cwd: root },
		)

		const source = await createFileSystemSourceService(root)
		let state: SourceSyncState = sourceSyncStateFromSnapshot(
			await source.readSnapshot(),
		)
		let editorSource = assembleSourceSyncState(state).source
		const originalFamily = editorSource.names.typographicFamily
		const namesPath = join(root, `names.json`)
		const originalText = await readFile(namesPath, `utf8`)
		const localOperations = new Set<string>()
		let asynchronousFailure: unknown
		let tail: Promise<void> = Promise.resolve()
		const conditions = conditionWaiter()
		let mounted: MountedEditor | undefined
		const options = (): EditorBrowserOptions => ({
			onSourceChange: save,
			source: editorSource,
			validation: { issueCount: 0, ok: true },
		})
		const enqueue = (operation: () => Promise<void>): Promise<void> => {
			const result = tail.then(operation, operation)
			tail = result.then(
				() => conditions.notify(),
				(error: unknown) => {
					asynchronousFailure = error
					conditions.fail(error)
				},
			)
			return result
		}
		const save = (nextSource: typeof editorSource): Promise<void> =>
			enqueue(async () => {
				const writes = sourceUnitWrites(state, nextSource)
				if (writes.length === 0) return
				const idempotencyKey = crypto.randomUUID()
				localOperations.add(idempotencyKey)
				const result = await source.writeUnits({
					idempotencyKey,
					writes,
				})
				const applied = applySourceSyncDelta(state, {
					type: `source.changed`,
					operationId: idempotencyKey,
					previousRevision: result.previousRevision,
					removedPaths: result.removedPaths,
					revision: result.revision,
					units: result.units,
				})
				state =
					applied.status === `gap`
						? sourceSyncStateFromSnapshot(await source.readSnapshot())
						: applied.state
				editorSource = nextSource
			})
		const stop = source.subscribe?.((event) => {
			if (
				event.operationId !== undefined &&
				localOperations.delete(event.operationId)
			) {
				return
			}
			void enqueue(async () => {
				const applied = applySourceSyncDelta(state, event)
				state =
					applied.status === `gap`
						? sourceSyncStateFromSnapshot(await source.readSnapshot())
						: applied.state
				editorSource = assembleSourceSyncState(state).source
				await act(async () => mounted?.update(options()))
			})
		})
		if (stop === undefined)
			throw new Error(`Source subscription is unavailable.`)
		subscriptions.push(stop)

		window.history.replaceState(null, ``, `/info`)
		const host = document.createElement(`section`)
		document.body.append(host)
		hosts.push(host)
		await act(async () => {
			mounted = mountEditor(host, options())
		})
		if (mounted === undefined) throw new Error(`Editor did not mount.`)
		mountedEditors.push(mounted)
		const familyInput = inputForLabel(host, `Typographic family`)
		const projectName = host.querySelector<HTMLElement>(`project-name span`)
		if (projectName === null) throw new Error(`Project name is missing.`)
		expect(familyInput.value).toBe(originalFamily)

		for (let cycle = 1; cycle <= 3; cycle += 1) {
			const editedFamily = `Observed Sans ${cycle} ${crypto.randomUUID()}`
			act(() => {
				familyInput.value = editedFamily
				familyInput.dispatchEvent(new Event(`input`, { bubbles: true }))
			})
			await conditions.wait(`cycle ${cycle} editor save`, async () => {
				if (asynchronousFailure !== undefined) throw asynchronousFailure
				expect(await readFile(namesPath, `utf8`)).toContain(editedFamily)
				expect(familyInput.value).toBe(editedFamily)
				expect(projectName.textContent).toBe(editedFamily)
			})
			expect(await readFile(namesPath, `utf8`)).not.toBe(originalText)

			await execFileAsync(`git`, [`restore`, `names.json`], { cwd: root })
			await conditions.wait(`cycle ${cycle} git restore`, () => {
				if (asynchronousFailure !== undefined) throw asynchronousFailure
				expect(familyInput.value).toBe(originalFamily)
				expect(projectName.textContent).toBe(originalFamily)
			})
		}
		await tail
		expect(await readFile(namesPath, `utf8`)).toBe(originalText)
	})

	it(`restores an actively edited glyph after git stashes its source file`, async () => {
		stubBrowserLayout()
		const root = await mkdtemp(
			join(tmpdir(), `create-font-glyph-observability-`),
		)
		roots.push(root)
		await cp(
			resolve(import.meta.dirname, `../../../fonts/workbench-sans`),
			root,
			{ recursive: true },
		)
		await execFileAsync(`git`, [`init`, `--quiet`], { cwd: root })
		await execFileAsync(`git`, [`add`, `.`], { cwd: root })
		await execFileAsync(
			`git`,
			[
				`-c`,
				`user.name=create-font test`,
				`-c`,
				`user.email=create-font@example.invalid`,
				`commit`,
				`--quiet`,
				`-m`,
				`Record source baseline`,
			],
			{ cwd: root },
		)

		const source = await createFileSystemSourceService(root)
		let state: SourceSyncState = sourceSyncStateFromSnapshot(
			await source.readSnapshot(),
		)
		let editorSource = assembleSourceSyncState(state).source
		const workspace = createEditorWorkspace(editorSource)
		const oGlyphId = editorSource.cmap.find(
			(entry) => entry.codePoint === `O`.codePointAt(0),
		)?.glyphId
		if (oGlyphId === undefined)
			throw new Error(`Workbench Sans has no O glyph.`)
		workspace.font.silo.setState(workspace.ui.previewText, `O`)
		workspace.actions.enterGlyphEdit(0, oGlyphId)
		const originalLayer = workspace.font.silo.getState(workspace.ui.activeLayer)
		const deletedContour = originalLayer?.contours[0]
		if (
			originalLayer === null ||
			originalLayer === undefined ||
			deletedContour === undefined
		) {
			throw new Error(`The active O layer has no contour.`)
		}

		const localOperations = new Set<string>()
		let asynchronousFailure: unknown
		let tail: Promise<void> = Promise.resolve()
		const conditions = conditionWaiter()
		const enqueue = (operation: () => Promise<void>): Promise<void> => {
			const result = tail.then(operation, operation)
			tail = result.then(
				() => conditions.notify(),
				(error: unknown) => {
					asynchronousFailure = error
					conditions.fail(error)
				},
			)
			return result
		}
		const save = (nextSource: typeof editorSource): Promise<void> =>
			enqueue(async () => {
				const writes = sourceUnitWrites(state, nextSource)
				if (writes.length === 0) return
				const idempotencyKey = crypto.randomUUID()
				localOperations.add(idempotencyKey)
				const result = await source.writeUnits({
					idempotencyKey,
					writes,
				})
				const applied = applySourceSyncDelta(state, {
					type: `source.changed`,
					operationId: idempotencyKey,
					previousRevision: result.previousRevision,
					removedPaths: result.removedPaths,
					revision: result.revision,
					units: result.units,
				})
				state =
					applied.status === `gap`
						? sourceSyncStateFromSnapshot(await source.readSnapshot())
						: applied.state
				editorSource = nextSource
			})
		const stopSaving = workspace.font.silo.subscribe(
			workspace.font.atoms.documentRevision,
			() => {
				const nextSource = workspace.font.read.editorSource()
				if (nextSource !== null) void save(nextSource)
			},
		)
		subscriptions.push(stopSaving)
		const stopWatching = source.subscribe?.((event) => {
			if (
				event.operationId !== undefined &&
				localOperations.delete(event.operationId)
			) {
				return
			}
			void enqueue(async () => {
				const applied = applySourceSyncDelta(state, event)
				state =
					applied.status === `gap`
						? sourceSyncStateFromSnapshot(await source.readSnapshot())
						: applied.state
				editorSource = assembleSourceSyncState(state).source
				await act(async () => workspace.actions.replaceSource(editorSource))
			})
		})
		if (stopWatching === undefined) {
			throw new Error(`Source subscription is unavailable.`)
		}
		subscriptions.push(stopWatching)

		workspace.font.silo.setState(
			workspace.ui.selection,
			deletedContour.nodes.map(({ pointId }) => ({
				kind: `node` as const,
				pointId,
			})),
		)
		const host = document.createElement(`section`)
		host.style.width = `800px`
		host.style.height = `600px`
		document.body.append(host)
		hosts.push(host)
		await act(async () => {
			render(
				h(EditorStateContext.Provider, {
					value: workspace.font.silo,
					children: h(GlyphCanvas, { workspace }),
				}),
				host,
			)
		})
		const canvas = host.querySelector<HTMLElement>(`[role="application"]`)
		const stage = Konva.stages.at(-1)
		if (canvas === null || stage === undefined) {
			throw new Error(`Glyph canvas did not mount.`)
		}
		const originalOutlinePath = stage
			.findOne(`.closed-contour-outline`)
			?.getAttr(`data`)
		if (typeof originalOutlinePath !== `string`) {
			throw new Error(`The O outline path did not render.`)
		}

		act(() => {
			canvas.dispatchEvent(
				new KeyboardEvent(`keydown`, { bubbles: true, key: `Delete` }),
			)
		})
		await conditions.wait(`glyph edit persistence`, async () => {
			if (asynchronousFailure !== undefined) throw asynchronousFailure
			expect(
				workspace.font.silo.getState(workspace.ui.activeLayer)?.contours,
			).toHaveLength(originalLayer.contours.length - 1)
			expect(
				stage.findOne(`.closed-contour-outline`)?.getAttr(`data`),
			).not.toBe(originalOutlinePath)
			const status = await execFileAsync(`git`, [`status`, `--short`], {
				cwd: root,
			})
			expect(status.stdout).toMatch(/glyphs\/.*\.json/)
		})

		await execFileAsync(`git`, [`stash`, `push`, `--quiet`], { cwd: root })
		await conditions.wait(`git stash restoration`, () => {
			if (asynchronousFailure !== undefined) throw asynchronousFailure
			expect(workspace.font.silo.getState(workspace.ui.activeGlyphId)).toBe(
				oGlyphId,
			)
			expect(
				workspace.font.silo.getState(workspace.ui.activeLayer)?.contours,
			).toHaveLength(originalLayer.contours.length)
			expect(workspace.font.read.editorGlyphSource(oGlyphId)).not.toBeNull()
			expect(stage.findOne(`.closed-contour-outline`)?.getAttr(`data`)).toBe(
				originalOutlinePath,
			)
		})
		await tail
	})
})
