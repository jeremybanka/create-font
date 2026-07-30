// @vitest-environment happy-dom

import { execFile } from "node:child_process"
import { cp, mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { promisify } from "node:util"

import type {
	EditorBrowserOptions,
	MountedEditor,
} from "@create-font/editor/browser"
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
import { mountEditor } from "../../editor/src/browser.ts"

const execFileAsync = promisify(execFile)
const hosts: HTMLElement[] = []
const roots: string[] = []
const subscriptions: Array<() => void> = []
const mountedEditors: MountedEditor[] = []

afterEach(async () => {
	for (const mounted of mountedEditors) mounted.unmount()
	mountedEditors.length = 0
	for (const host of hosts) host.remove()
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

async function eventually(
	assertion: () => void | Promise<void>,
	timeout = 8_000,
): Promise<void> {
	const started = performance.now()
	let failure: unknown
	while (performance.now() - started < timeout) {
		try {
			await assertion()
			return
		} catch (error) {
			failure = error
			await new Promise((resolveDelay) => setTimeout(resolveDelay, 25))
		}
	}
	throw failure
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
		let mounted: MountedEditor | undefined
		const options = (): EditorBrowserOptions => ({
			onSourceChange: save,
			source: editorSource,
			validation: { issueCount: 0, ok: true },
		})
		const enqueue = (operation: () => Promise<void>): Promise<void> => {
			const result = tail.then(operation, operation)
			tail = result.catch((error: unknown) => {
				asynchronousFailure = error
			})
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
			await eventually(async () => {
				if (asynchronousFailure !== undefined) throw asynchronousFailure
				expect(await readFile(namesPath, `utf8`)).toContain(editedFamily)
				expect(familyInput.value).toBe(editedFamily)
				expect(projectName.textContent).toBe(editedFamily)
			})
			expect(await readFile(namesPath, `utf8`)).not.toBe(originalText)

			await execFileAsync(`git`, [`restore`, `names.json`], { cwd: root })
			await eventually(() => {
				if (asynchronousFailure !== undefined) throw asynchronousFailure
				expect(familyInput.value).toBe(originalFamily)
				expect(projectName.textContent).toBe(originalFamily)
			})
		}
		expect(await readFile(namesPath, `utf8`)).toBe(originalText)
	})
})
