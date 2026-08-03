// @vitest-environment happy-dom

import { createRequire } from "node:module"
import { act, h, render } from "../../../../scripts/react-test-render.ts"
import { afterEach, describe, expect, it, vi } from "vitest"
import { DEFAULT_DESIGN_STROKE_STYLE } from "@create-design/source"

import {
	DesignApplication,
	type DesignApplicationProps,
} from "../src/DesignApplication.tsx"
import { createInitialDocument, DESIGN_STORAGE_KEY } from "../src/document.ts"
import { groupDesignSelection } from "../src/design-hierarchy.ts"
import { objectBounds } from "@create-design/model"
import type {
	PathfinderWorkerClient,
	PathfinderWorkerOutcome,
} from "../src/pathfinder-worker-client.ts"
import type {
	PathfinderWorkerProgress,
	PathfinderWorkerRequest,
} from "../src/pathfinder-worker-protocol.ts"
import {
	DESIGN_RECOVERY_STORAGE_KEY,
	type DesignRecoveryDraft,
} from "../src/persistence.ts"
import { expandDesignShape } from "../src/shape-expansion.ts"
import type {
	DesignExternalSourceUpdate,
	DesignSourceSession,
} from "../src/source-session.ts"
import type { DesignDocument } from "../src/types.ts"

const requireFromRenderer = createRequire(
	`${process.cwd()}/../../create-art/editor/package.json`,
)
const { default: Konva } = await import(
	requireFromRenderer.resolve("konva/lib/Core")
)

const hosts: HTMLElement[] = []

type DeferredPathfinderRun = {
	readonly cancel: ReturnType<typeof vi.fn>
	readonly input: Omit<PathfinderWorkerRequest, "id">
	readonly onProgress: (progress: PathfinderWorkerProgress) => void
	readonly resolve: (outcome: PathfinderWorkerOutcome) => void
}

class DeferredPathfinderWorkerClient implements PathfinderWorkerClient {
	readonly runs: DeferredPathfinderRun[] = []

	run(
		input: Omit<PathfinderWorkerRequest, "id">,
		onProgress: (progress: PathfinderWorkerProgress) => void,
	) {
		let settled = false
		let resolveOutcome!: (outcome: PathfinderWorkerOutcome) => void
		const result = new Promise<PathfinderWorkerOutcome>((resolve) => {
			resolveOutcome = resolve
		})
		const resolve = (outcome: PathfinderWorkerOutcome): void => {
			if (settled) return
			settled = true
			resolveOutcome(outcome)
		}
		const cancel = vi.fn(() => resolve({ status: "cancelled" }))
		this.runs.push({ cancel, input, onProgress, resolve })
		return { cancel, result }
	}
}

afterEach(() => {
	for (const host of hosts) {
		render(null, host)
		host.remove()
	}
	hosts.length = 0
	vi.restoreAllMocks()
	vi.unstubAllGlobals()
})

function mountDesign(
	props: DesignApplicationProps = {},
	storage = new Map<string, string>(),
	resize?: {
		readonly deferred: true
		readonly capture: (callback: ResizeObserverCallback) => void
	},
) {
	vi.stubGlobal("localStorage", {
		getItem: (key: string) => storage.get(key) ?? null,
		setItem: (key: string, value: string) => storage.set(key, value),
		removeItem: (key: string) => storage.delete(key),
	})
	vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
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
		"ResizeObserver",
		class {
			readonly callback: ResizeObserverCallback
			constructor(callback: ResizeObserverCallback) {
				this.callback = callback
			}
			observe(element: Element) {
				if (resize !== undefined && element.localName === "artboard-wrap") {
					resize.capture(this.callback)
					return
				}
				this.callback(
					[
						{
							contentRect: {
								width: 960,
								height: 720,
							},
						} as ResizeObserverEntry,
					],
					this as unknown as ResizeObserver,
				)
			}
			disconnect() {}
			unobserve() {}
		},
	)
	const host = document.createElement("section")
	document.body.append(host)
	hosts.push(host)
	act(() => render(h(DesignApplication, props), host))
	const stage = Konva.stages.at(-1)
	if (resize !== undefined) return stage
	if (stage === undefined) throw new Error("Design stage did not mount.")
	return stage
}

describe("create-design shared vector scene", () => {
	it("passes the authored fill rule to the canvas path", () => {
		const document = createInitialDocument()
		const first = document.objects[0]!
		const initialDocument: DesignDocument = {
			...document,
			objects: document.objects.map((object) =>
				object.id === first.id
					? {
							...object,
							geometry: {
								kind: "path",
								fillRule: "nonzero",
								contours: [
									{
										id: "contour:fill-rule",
										closed: true,
										points: [
											{ id: "point:fill-rule:0", x: 0, y: 0 },
											{ id: "point:fill-rule:1", x: 20, y: 0 },
											{ id: "point:fill-rule:2", x: 20, y: 20 },
										],
									},
								],
							},
						}
					: object,
			),
		}
		const stage = mountDesign({ initialDocument })
		expect(stage.findOne(".design-object").fillRule()).toBe("nonzero")
	})

	it("waits for a positive viewport before rendering the existing scene", () => {
		const stageCount = Konva.stages.length
		const stage = mountDesign({}, new Map(), {
			deferred: true,
			capture: (callback) => {
				expect(Konva.stages).toHaveLength(stageCount)
				callback(
					[
						{
							contentRect: { width: 960, height: 720 },
						} as ResizeObserverEntry,
					],
					{} as ResizeObserver,
				)
			},
		})
		if (stage === undefined) throw new Error("Design stage did not mount.")
		expect(stage.width()).toBe(960)
		expect(stage.height()).toBe(720)
		expect(stage.find(".design-paper")).toHaveLength(1)
		expect(stage.find(".design-object").length).toBeGreaterThan(0)
	})

	it("composes source identity, commands, contextual Help, and one live status path", async () => {
		const session = sourceSession({ displayName: "campaign-poster" })
		mountDesign({
			initialDocument: session.initialDocument,
			sourceSession: session,
		})
		const identity = document.querySelector("project-identity")
		expect(identity?.textContent).toContain("campaign-poster")
		expect(identity?.textContent).not.toContain("proof of concept")
		expect(document.querySelector("canvas-meta")).toBeNull()
		expect(document.querySelector("canvas-hint")).toBeNull()

		const selectionStatus = document.getElementById("design-selection-status")
		expect(selectionStatus?.hasAttribute("data-screen-reader")).toBe(true)
		expect(selectionStatus?.hasAttribute("aria-live")).toBe(false)
		expect(
			document.querySelector("artboard-wrap")?.getAttribute("aria-describedby"),
		).toBe("design-selection-status")
		expect(document.querySelectorAll('footer [role="status"]')).toHaveLength(1)
		const firstLayer = document.querySelector<HTMLButtonElement>(
			"design-layers-tile > button",
		)
		if (firstLayer === null) throw new Error("A design layer was not found.")
		act(() => firstLayer.click())
		expect(
			document.querySelector('footer [role="status"]')?.textContent,
		).toContain("1 object selected")

		const command = document.querySelector<HTMLButtonElement>(
			'button[aria-label="Open Command Palette"]',
		)
		if (command === null) throw new Error("Command center was not found.")
		expect(command.getAttribute("aria-keyshortcuts")).toBe(
			"Meta+Shift+P Control+Shift+P",
		)
		act(() => command.click())
		const search = document.querySelector<HTMLInputElement>(
			'input[aria-label="Search commands"]',
		)
		if (search === null) throw new Error("Command search was not found.")
		await act(async () => {
			search.dispatchEvent(
				new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }),
			)
			await new Promise<void>((resolve) =>
				requestAnimationFrame(() => resolve()),
			)
		})
		expect(document.activeElement).toBe(command)

		const help = document.querySelector<HTMLButtonElement>(
			'button[aria-controls="design-contextual-help"]',
		)
		if (help === null) throw new Error("Canvas Help was not found.")
		expect(help.textContent).toContain("Select help")
		act(() => help.click())
		expect(document.querySelector("canvas-help")?.textContent).toContain(
			"Drag objects to move",
		)
		const close = document.querySelector<HTMLButtonElement>(
			'button[aria-label="Close Help"]',
		)
		if (close === null) throw new Error("Close Help was not found.")
		await act(async () => {
			close.click()
			await new Promise<void>((resolve) =>
				requestAnimationFrame(() => resolve()),
			)
		})
		expect(document.querySelector("canvas-help")).toBeNull()
		expect(document.activeElement).toBe(help)
	})

	it("runs large partition Pathfinder commands off-thread with progress, cancellation, and stale-result protection", async () => {
		const base = createInitialDocument()
		const template = base.objects[0]!
		const initialDocument: DesignDocument = {
			...base,
			objects: Array.from({ length: 24 }, (_, index) => ({
				...template,
				id: `object:large:${index}`,
				name: `Large piece ${index + 1}`,
				transform: {
					...template.transform,
					e: (index % 6) * 12,
					f: Math.floor(index / 6) * 12,
				},
			})),
		}
		const worker = new DeferredPathfinderWorkerClient()
		mountDesign({ initialDocument, pathfinderWorkerClient: worker })

		const selectAll = async (): Promise<void> => {
			await act(async () => {
				window.dispatchEvent(
					new KeyboardEvent("keydown", {
						bubbles: true,
						ctrlKey: true,
						key: "a",
					}),
				)
				await Promise.resolve()
			})
		}
		const openDivide = async (): Promise<void> => {
			const opener = document.querySelector<HTMLButtonElement>(
				'button[aria-label="Open Command Palette"]',
			)
			if (opener === null) throw new Error("Command center was not found.")
			act(() => opener.click())
			const search = document.querySelector<HTMLInputElement>(
				'input[aria-label="Search commands"]',
			)
			if (search === null) throw new Error("Command search was not found.")
			await act(async () => {
				search.value = "Pathfinder: Divide"
				search.dispatchEvent(new InputEvent("input", { bubbles: true }))
				await Promise.resolve()
			})
		}
		const executeDivide = async (): Promise<void> => {
			await openDivide()
			const option = document.getElementById("command-pathfinder-divide")
			if (!(option instanceof HTMLButtonElement))
				throw new Error("Divide command was not found.")
			await act(async () => {
				option.click()
				await Promise.resolve()
			})
		}

		await selectAll()
		await executeDivide()
		expect(worker.runs).toHaveLength(1)
		expect(worker.runs[0]?.input.context.scopeGroupId).toBeNull()
		await act(async () => {
			worker.runs[0]?.onProgress({
				completedRegions: 8,
				phase: "partitioning",
				pieceCount: 31,
				totalRegions: 24,
			})
			await Promise.resolve()
		})
		const progress = document.querySelector<HTMLElement>(
			"footer [data-pathfinder-progress]",
		)
		expect(progress?.textContent).toContain("Divide: partitioning")
		expect(progress?.querySelector("progress")?.value).toBe(8)

		await openDivide()
		expect(
			document
				.getElementById("command-pathfinder-divide")
				?.getAttribute("aria-disabled"),
		).toBe("true")
		const search = document.querySelector<HTMLInputElement>(
			'input[aria-label="Search commands"]',
		)
		if (search === null) throw new Error("Command search was not found.")
		act(() => {
			search.dispatchEvent(
				new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }),
			)
		})
		const cancel = document.querySelector<HTMLButtonElement>(
			'button[aria-label="Cancel Divide"]',
		)
		if (cancel === null) throw new Error("Pathfinder cancel was not found.")
		await act(async () => {
			cancel.click()
			await Promise.resolve()
		})
		expect(worker.runs[0]?.cancel).toHaveBeenCalledOnce()
		expect(
			document.querySelector("[data-footer-counts]")?.textContent,
		).toContain("24 objects")
		expect(
			document.querySelector("[data-footer-status]")?.textContent,
		).toContain("document was not changed")

		await executeDivide()
		expect(worker.runs).toHaveLength(2)
		const title = document.querySelector<HTMLInputElement>(
			'design-canvas-tile input[aria-label="Document title"]',
		)
		if (title === null) throw new Error("Document title field was not found.")
		await act(async () => {
			title.value = "Edited while Pathfinder runs"
			title.dispatchEvent(new InputEvent("input", { bubbles: true }))
			await Promise.resolve()
		})
		const staleDocument = {
			...worker.runs[1]!.input.context.document,
			objects: [],
			title: "Stale worker result",
		}
		await act(async () => {
			worker.runs[1]?.resolve({
				result: {
					directSelection: [],
					document: staleDocument,
					message: "Divided stale paths.",
					objectSelection: [],
					ok: true,
				},
				status: "completed",
			})
			await Promise.resolve()
		})
		expect(title.value).toBe("Edited while Pathfinder runs")
		expect(
			document.querySelector("[data-footer-counts]")?.textContent,
		).toContain("24 objects")
		expect(
			document.querySelector("[data-footer-status]")?.textContent,
		).toContain("result was discarded")
	})

	it("enters nested groups on the mounted double-click sequence without moving them", async () => {
		const base = createInitialDocument()
		const first = base.objects[0]!
		const third = {
			...first,
			id: "object:third",
			name: "Third object",
			transform: { ...first.transform, e: first.transform.e + 360 },
		}
		const expanded = {
			...base,
			objects: [...base.objects, third],
			scene: [...base.objects, third].map(({ id }) => ({
				kind: "object" as const,
				id,
			})),
		}
		const inner = groupDesignSelection(
			expanded,
			base.objects.map(({ id }) => id),
			() => "inner",
		)
		if (inner === null) throw new Error("Inner fixture group was not created.")
		const outer = groupDesignSelection(
			inner.document,
			[...inner.selection, third.id],
			() => "outer",
		)
		if (outer === null) throw new Error("Outer fixture group was not created.")
		const source = outer.document
		const storage = new Map<string, string>()
		const worker = new DeferredPathfinderWorkerClient()
		const stage = mountDesign(
			{ initialDocument: source, pathfinderWorkerClient: worker },
			storage,
		)
		const persistedSource = storage.get(DESIGN_STORAGE_KEY)
		if (persistedSource === undefined)
			throw new Error("Initial grouped document was not persisted.")
		const canvas = stage.container().querySelector("canvas")
		if (canvas === null) throw new Error("Design canvas was not found.")
		vi.spyOn(
			HTMLCanvasElement.prototype,
			"setPointerCapture",
		).mockImplementation(() => undefined)
		vi.spyOn(
			HTMLCanvasElement.prototype,
			"releasePointerCapture",
		).mockImplementation(() => undefined)
		vi.spyOn(HTMLCanvasElement.prototype, "hasPointerCapture").mockReturnValue(
			false,
		)
		let pointer = { x: 260, y: 220 }
		vi.spyOn(stage, "getPointerPosition").mockImplementation(() => pointer)
		const objectNode = (id: string) => {
			const node = stage
				.find(".design-object")
				.find((candidate: { name(): string }) => candidate.name().includes(id))
			if (node === undefined) throw new Error(`${id} was not rendered.`)
			return node
		}
		const firePointer = (
			id: string,
			type: "pointerdown" | "pointermove" | "pointerup",
			next: { x: number; y: number },
		) => {
			pointer = next
			objectNode(id).fire(
				type,
				{
					evt: new PointerEvent(type, {
						bubbles: true,
						button: 0,
						buttons: type === "pointerup" ? 0 : 1,
						clientX: next.x,
						clientY: next.y,
						isPrimary: true,
						pointerId: 17,
						pointerType: "mouse",
					}),
				},
				true,
			)
		}
		const click = async (id: string, at = pointer) => {
			await act(async () => {
				firePointer(id, "pointerdown", at)
				firePointer(id, "pointerup", at)
				objectNode(id).fire(
					"click",
					{ evt: new MouseEvent("click", { bubbles: true, detail: 1 }) },
					true,
				)
				await Promise.resolve()
			})
		}
		const finishDoubleClick = async (id: string, at = pointer) => {
			await act(async () => {
				firePointer(id, "pointerdown", { x: at.x + 1, y: at.y + 1 })
				firePointer(id, "pointermove", { x: at.x + 3, y: at.y + 2 })
				firePointer(id, "pointerup", { x: at.x + 3, y: at.y + 2 })
				objectNode(id).fire(
					"click",
					{ evt: new MouseEvent("click", { bubbles: true, detail: 2 }) },
					true,
				)
				objectNode(id).fire(
					"dblclick",
					{ evt: new MouseEvent("dblclick", { bubbles: true, detail: 2 }) },
					true,
				)
				await Promise.resolve()
			})
		}
		const doubleClick = async (id: string, at = pointer) => {
			await click(id, at)
			await finishDoubleClick(id, at)
		}
		const groupLabel = () =>
			stage.findOne(".design-group-selection-label")?.text() ?? null

		await doubleClick(first.id)
		expect(groupLabel()).toBe("Group 1 · 2 objects")
		expect(document.querySelector("footer > span")?.textContent).toContain(
			"Editing inside Group 2",
		)
		expect(storage.get(DESIGN_STORAGE_KEY)).toBe(persistedSource)

		await click(third.id, { x: 620, y: 220 })
		expect(groupLabel()).toBe(null)
		await click(first.id, { x: 260, y: 220 })
		expect(groupLabel()).toBe("Group 1 · 2 objects")

		await finishDoubleClick(first.id, { x: 260, y: 220 })
		expect(groupLabel()).toBe(null)
		expect(document.querySelector("footer > span")?.textContent).toContain(
			"Editing inside Group 1",
		)
		expect(storage.get(DESIGN_STORAGE_KEY)).toBe(persistedSource)
		await act(async () => {
			window.dispatchEvent(
				new KeyboardEvent("keydown", {
					bubbles: true,
					ctrlKey: true,
					key: "a",
				}),
			)
			await Promise.resolve()
		})

		const commandCenter = document.querySelector<HTMLButtonElement>(
			'button[aria-label="Open Command Palette"]',
		)
		if (commandCenter === null) throw new Error("Command center was not found.")
		act(() => commandCenter.click())
		const commandSearch = document.querySelector<HTMLInputElement>(
			'input[aria-label="Search commands"]',
		)
		if (commandSearch === null) throw new Error("Command search was not found.")
		await act(async () => {
			commandSearch.value = "Pathfinder: Divide"
			commandSearch.dispatchEvent(new InputEvent("input", { bubbles: true }))
			await Promise.resolve()
		})
		const divide = document.getElementById("command-pathfinder-divide")
		if (!(divide instanceof HTMLButtonElement))
			throw new Error("Divide command was not found.")
		await act(async () => {
			divide.click()
			await Promise.resolve()
		})
		expect(worker.runs[0]?.input.context.scopeGroupId).toBe("group:inner")
		await act(async () => {
			window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))
			await Promise.resolve()
		})
		expect(groupLabel()).toBe("Group 1 · 2 objects")
		await act(async () => {
			worker.runs[0]?.resolve({
				result: {
					directSelection: [],
					document: { ...source, objects: [] },
					message: "Divided stale scope.",
					objectSelection: [],
					ok: true,
				},
				status: "completed",
			})
			await Promise.resolve()
		})
		expect(
			document.querySelector("[data-footer-status]")?.textContent,
		).toContain("editing scope changed")
		expect(storage.get(DESIGN_STORAGE_KEY)).toBe(persistedSource)
		await doubleClick(first.id)
		expect(groupLabel()).toBe(null)
		await act(async () => {
			window.dispatchEvent(
				new KeyboardEvent("keydown", { key: "z", ctrlKey: true }),
			)
			await Promise.resolve()
		})
		expect(storage.get(DESIGN_STORAGE_KEY)).toBe(persistedSource)

		await act(async () => {
			window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))
			await Promise.resolve()
		})
		expect(groupLabel()).toBe("Group 1 · 2 objects")
		await act(async () => {
			window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))
			await Promise.resolve()
		})
		expect(groupLabel()).toBe("Group 2 · 3 objects")

		const before = source.objects.map(({ transform }) => ({
			x: transform.e,
			y: transform.f,
		}))
		await act(async () => {
			firePointer(first.id, "pointerdown", { x: 260, y: 220 })
			firePointer(first.id, "pointermove", { x: 300, y: 245 })
			firePointer(first.id, "pointerup", { x: 300, y: 245 })
			await Promise.resolve()
		})
		const moved = JSON.parse(
			storage.get(DESIGN_STORAGE_KEY) ?? "{}",
		) as DesignDocument
		const deltas = moved.objects.map(({ transform }, index) => ({
			x: transform.e - before[index]!.x,
			y: transform.f - before[index]!.y,
		}))
		expect(deltas[0]?.x).not.toBe(0)
		expect(deltas.every((delta) => delta.x === deltas[0]!.x)).toBe(true)
		expect(deltas.every((delta) => delta.y === deltas[0]!.y)).toBe(true)
		await act(async () => {
			window.dispatchEvent(
				new KeyboardEvent("keydown", { key: "z", ctrlKey: true }),
			)
			await Promise.resolve()
		})
		expect(JSON.parse(storage.get(DESIGN_STORAGE_KEY) ?? "{}")).toEqual(source)
	})

	function sourceSession(
		overrides: Partial<DesignSourceSession> = {},
	): DesignSourceSession {
		const initialDocument = createInitialDocument()
		return {
			initialDocument,
			initialRevision: "source:one",
			reload: vi.fn(async () => ({
				ok: true as const,
				document: initialDocument,
				revision: "source:one",
			})),
			save: vi.fn(async () => ({ revision: "source:two" })),
			subscribeDocument: vi.fn(() => () => undefined),
			subscribeStatus: vi.fn(() => () => undefined),
			...overrides,
		}
	}

	it("leaves invalid persisted input untouched until the user edits", () => {
		const invalid = JSON.stringify({
			...createInitialDocument(),
			version: 999,
		})
		const storage = new Map([[DESIGN_STORAGE_KEY, invalid]])
		mountDesign({}, storage)
		expect(storage.get(DESIGN_STORAGE_KEY)).toBe(invalid)
	})

	it("offers a recovery draft without labeling it saved, then saves an explicit recovery", async () => {
		const storage = new Map<string, string>()
		const recovered = { ...createInitialDocument(), title: "Recovered design" }
		const draft: DesignRecoveryDraft = {
			version: 1,
			baseRevision: "source:one",
			document: recovered,
			updatedAt: 42,
		}
		storage.set(DESIGN_RECOVERY_STORAGE_KEY, JSON.stringify(draft))
		const session = sourceSession()
		mountDesign(
			{ initialDocument: session.initialDocument, sourceSession: session },
			storage,
		)
		expect(
			document.querySelector('footer [role="status"]')?.textContent,
		).toContain("has not been saved")
		expect(
			document.querySelector("footer [data-footer-status]")?.textContent,
		).toContain("Ready")
		const recover = [...document.querySelectorAll("button")].find(
			(button) => button.textContent?.trim() === "Recover draft",
		)
		if (recover === undefined)
			throw new Error("Recover draft action was not found.")
		await act(async () => {
			recover.click()
			await Promise.resolve()
			await Promise.resolve()
			await new Promise((resolve) => setTimeout(resolve, 0))
		})
		expect(session.save).toHaveBeenCalledWith(recovered)
		expect(
			document.querySelector<HTMLInputElement>(
				'design-canvas-tile input[aria-label="Document title"]',
			)?.value,
		).toBe("Recovered design")
		await vi.waitFor(() => {
			expect(storage.has(DESIGN_RECOVERY_STORAGE_KEY)).toBe(false)
			expect(
				document.querySelector('footer [role="status"]')?.textContent,
			).toContain("source:two")
		})
	})

	it("clears an identical stale recovery draft without prompting or warning", () => {
		const storage = new Map<string, string>()
		const session = sourceSession()
		const draft: DesignRecoveryDraft = {
			version: 1,
			baseRevision: "source:one",
			document: session.initialDocument,
			updatedAt: 42,
		}
		storage.set(DESIGN_RECOVERY_STORAGE_KEY, JSON.stringify(draft))
		mountDesign(
			{ initialDocument: session.initialDocument, sourceSession: session },
			storage,
		)
		expect(document.querySelector("persistence-alert")).toBeNull()
		expect(
			document.querySelector('footer [role="status"]')?.textContent,
		).toContain("source:one")
		expect(
			document.querySelector("footer [data-footer-status]")?.textContent,
		).toContain("Ready")
		expect(storage.has(DESIGN_RECOVERY_STORAGE_KEY)).toBe(false)
		expect(session.save).not.toHaveBeenCalled()
		const event = new Event("beforeunload", { cancelable: true })
		window.dispatchEvent(event)
		expect(event.defaultPrevented).toBe(false)
	})

	it("discards only the recovery draft and reloads newer durable source", async () => {
		const storage = new Map<string, string>()
		const draft: DesignRecoveryDraft = {
			version: 1,
			baseRevision: "source:old",
			document: { ...createInitialDocument(), title: "Old draft" },
			updatedAt: 42,
		}
		storage.set(DESIGN_RECOVERY_STORAGE_KEY, JSON.stringify(draft))
		const session = sourceSession()
		mountDesign(
			{ initialDocument: session.initialDocument, sourceSession: session },
			storage,
		)
		const discard = [...document.querySelectorAll("button")].find(
			(button) => button.textContent?.trim() === "Discard draft",
		)
		if (discard === undefined)
			throw new Error("Discard draft action was not found.")
		await act(async () => {
			discard.click()
			await Promise.resolve()
		})
		expect(storage.has(DESIGN_RECOVERY_STORAGE_KEY)).toBe(false)
		expect(session.save).not.toHaveBeenCalled()
		expect(session.reload).toHaveBeenCalledOnce()
		expect(
			document.querySelector<HTMLInputElement>(
				'design-canvas-tile input[aria-label="Document title"]',
			)?.value,
		).toBe("Untitled design")
	})

	it("keeps the last valid canvas and locates invalid external source errors", () => {
		let listener: ((update: DesignExternalSourceUpdate) => void) | undefined
		const session = sourceSession({
			subscribeDocument: (next) => {
				listener = next
				return () => undefined
			},
		})
		const stage = mountDesign({
			initialDocument: session.initialDocument,
			sourceSession: session,
		})
		act(() =>
			listener?.({
				ok: false,
				revision: "source:invalid",
				diagnostics: [
					{
						severity: "error",
						code: "source.schema",
						unitPath: "document.json",
						path: "$.title",
						message: "Expected string.",
					},
				],
			}),
		)
		expect(document.querySelector("persistence-alert")?.textContent).toContain(
			"document.json $.title",
		)
		expect(stage.find(".vector-contour-path").length).toBeGreaterThan(1)
		for (const label of ["Reload external source", "Save local copy"])
			expect(
				[...document.querySelectorAll("button")].some(
					(button) => button.textContent?.trim() === label,
				),
			).toBe(true)
	})

	it("warns before navigation and persists a recovery draft while a save is pending", () => {
		const storage = new Map<string, string>()
		const session = sourceSession({
			save: vi.fn(
				() => new Promise<Readonly<{ revision: string }>>(() => undefined),
			),
		})
		mountDesign(
			{ initialDocument: session.initialDocument, sourceSession: session },
			storage,
		)
		const title = document.querySelector<HTMLInputElement>(
			'design-canvas-tile input[aria-label="Document title"]',
		)
		if (title === null) throw new Error("Document title was not found.")
		act(() => {
			title.value = "Pending title"
			title.dispatchEvent(new InputEvent("input", { bubbles: true }))
		})
		const event = new Event("beforeunload", { cancelable: true })
		window.dispatchEvent(event)
		expect(event.defaultPrevented).toBe(true)
		expect(
			JSON.parse(storage.get(DESIGN_RECOVERY_STORAGE_KEY) ?? "{}").document
				.title,
		).toBe("Pending title")
	})

	it("retains failed work and retries only after a keyboard-reachable action", async () => {
		const save = vi
			.fn()
			.mockRejectedValueOnce(new Error("Source write failed."))
			.mockResolvedValueOnce({ revision: "source:two" })
		const session = sourceSession({ save })
		mountDesign({
			initialDocument: session.initialDocument,
			sourceSession: session,
		})
		const title = document.querySelector<HTMLInputElement>(
			'design-canvas-tile input[aria-label="Document title"]',
		)
		if (title === null) throw new Error("Document title was not found.")
		act(() => {
			title.value = "Retained title"
			title.dispatchEvent(new InputEvent("input", { bubbles: true }))
		})
		await vi.waitFor(() =>
			expect(
				document.querySelector("persistence-alert")?.textContent,
			).toContain("Source write failed."),
		)
		const retry = [...document.querySelectorAll("button")].find(
			(button) => button.textContent?.trim() === "Retry save",
		)
		if (retry === undefined) throw new Error("Retry save action was not found.")
		expect(retry.tabIndex).toBeGreaterThanOrEqual(0)
		act(() => retry.click())
		await vi.waitFor(() =>
			expect(
				document.querySelector('footer [role="status"]')?.textContent,
			).toContain("source:two"),
		)
		expect(save).toHaveBeenCalledTimes(2)
		expect(save).toHaveBeenLastCalledWith(
			expect.objectContaining({ title: "Retained title" }),
		)
	})

	it("hosts every design control in registry tiles without fixed navigation or asides", () => {
		mountDesign()
		expect(document.querySelector("nav")).toBeNull()
		expect(document.querySelector("aside")).toBeNull()
		expect(document.querySelector("design-pages-tile")).not.toBeNull()
		expect(document.querySelector("design-layers-tile")).not.toBeNull()
		expect(document.querySelector("design-tools-tile")).not.toBeNull()
		expect(document.querySelector("design-object-tile")).not.toBeNull()
		expect(document.querySelector("design-appearance-tile")).not.toBeNull()
	})

	it("navigates and edits the ordered artboard collection accessibly", async () => {
		const storage = new Map<string, string>()
		mountDesign({}, storage)
		const pages = document.querySelector("design-pages-tile")
		if (pages === null) throw new Error("Pages tile was not found.")
		const button = (label: string): HTMLButtonElement => {
			const match = [...pages.querySelectorAll("button")].find(
				(candidate) => candidate.textContent?.trim() === label,
			)
			if (match === undefined) throw new Error(`${label} was not found.`)
			return match
		}

		await act(async () => {
			button("New").click()
			await Promise.resolve()
		})
		let options = [
			...pages.querySelectorAll<HTMLButtonElement>('[role="option"]'),
		]
		expect(options).toHaveLength(2)
		expect(options[1]?.getAttribute("aria-current")).toBe("page")

		const name = pages.querySelector<HTMLInputElement>(
			'label[data-field] input:not([type="number"])',
		)
		if (name === null) throw new Error("Artboard name was not found.")
		await act(async () => {
			name.value = "Outside artwork"
			name.dispatchEvent(new InputEvent("input", { bubbles: true }))
			await Promise.resolve()
		})
		await act(async () => {
			name.dispatchEvent(
				new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }),
			)
			await Promise.resolve()
		})
		expect(options[1]?.textContent).toContain("Outside artwork")

		await act(async () => {
			options[1]?.dispatchEvent(
				new KeyboardEvent("keydown", { bubbles: true, key: "ArrowUp" }),
			)
			await Promise.resolve()
		})
		options = [...pages.querySelectorAll<HTMLButtonElement>('[role="option"]')]
		expect(options[0]?.getAttribute("aria-current")).toBe("page")
		expect(button("Fit active").disabled).toBe(false)
		expect(button("Fit all").disabled).toBe(false)

		await act(async () => {
			button("Delete").click()
			await Promise.resolve()
		})
		const saved = JSON.parse(
			storage.get(DESIGN_STORAGE_KEY) ?? "{}",
		) as DesignDocument
		expect(saved.artboards).toHaveLength(1)
		expect(saved.objects).toHaveLength(2)
	})

	it("creates an artboard with a distinct canvas gesture and undoes it atomically", async () => {
		const storage = new Map<string, string>()
		const stage = mountDesign({}, storage)
		vi.spyOn(
			HTMLCanvasElement.prototype,
			"setPointerCapture",
		).mockImplementation(() => undefined)
		vi.spyOn(
			HTMLCanvasElement.prototype,
			"releasePointerCapture",
		).mockImplementation(() => undefined)
		const artboardTool = document.querySelector<HTMLButtonElement>(
			'button[aria-label="Artboard"]',
		)
		const canvas = stage.container().querySelector("canvas")
		if (artboardTool === null || canvas === null)
			throw new Error("Artboard tool or canvas was not found.")
		act(() => artboardTool.click())
		const fire = (type: string, x: number, y: number): void => {
			canvas.dispatchEvent(
				new PointerEvent(type, {
					bubbles: true,
					button: 0,
					buttons: type === "pointerup" ? 0 : 1,
					clientX: x,
					clientY: y,
					isPrimary: true,
					pointerId: 42,
					pointerType: "mouse",
				}),
			)
		}
		await act(async () => {
			fire("pointerdown", 80, 100)
			fire("pointermove", 180, 200)
			fire("pointerup", 180, 200)
			await Promise.resolve()
		})
		let saved = JSON.parse(
			storage.get(DESIGN_STORAGE_KEY) ?? "{}",
		) as DesignDocument
		expect(saved.artboards).toHaveLength(2)
		expect(saved.objects).toHaveLength(2)
		expect(stage.find(".design-paper")).toHaveLength(2)

		await act(async () => {
			window.dispatchEvent(
				new KeyboardEvent("keydown", { key: "z", ctrlKey: true }),
			)
			await Promise.resolve()
		})
		saved = JSON.parse(
			storage.get(DESIGN_STORAGE_KEY) ?? "{}",
		) as DesignDocument
		expect(saved.artboards).toHaveLength(1)
		expect(saved.objects).toHaveLength(2)
	})

	it("authors mixed multi-object paints atomically with accessible appearance controls", async () => {
		const storage = new Map<string, string>()
		mountDesign({}, storage)
		const layers = [
			...document.querySelectorAll<HTMLButtonElement>(
				"design-layers-tile > button",
			),
		]
		if (layers.length < 2) throw new Error("Expected two design layers.")
		await act(async () => {
			layers[0]!.click()
			layers[1]!.dispatchEvent(
				new MouseEvent("click", { bubbles: true, shiftKey: true }),
			)
			await Promise.resolve()
		})

		expect(
			layers.every((layer) => layer.getAttribute("aria-pressed") === "true"),
		).toBe(true)
		expect(
			document.querySelector<HTMLButtonElement>(
				'button[aria-label="Fill paint: Mixed"]',
			),
		).not.toBeNull()
		const strokeTarget = document.querySelector<HTMLButtonElement>(
			'button[aria-label="Stroke paint: None"]',
		)
		if (strokeTarget === null) throw new Error("Stroke target was not found.")
		await act(async () => {
			strokeTarget.click()
			await Promise.resolve()
		})
		const ink = document.querySelector<HTMLButtonElement>(
			'button[aria-label="Use Rich black as stroke paint"]',
		)
		if (ink === null) throw new Error("Stroke swatch was not found.")
		await act(async () => {
			ink.click()
			await Promise.resolve()
		})
		let saved = JSON.parse(
			storage.get(DESIGN_STORAGE_KEY) ?? "{}",
		) as DesignDocument
		expect(saved.objects.map((object) => object.appearance.stroke)).toEqual([
			{
				...DEFAULT_DESIGN_STROKE_STYLE,
				swatchId: "swatch:ink",
				width: 1,
			},
			{
				...DEFAULT_DESIGN_STROKE_STYLE,
				swatchId: "swatch:ink",
				width: 1,
			},
		])

		await act(async () => {
			window.dispatchEvent(
				new KeyboardEvent("keydown", {
					key: "z",
					ctrlKey: true,
					bubbles: true,
				}),
			)
			await Promise.resolve()
		})
		saved = JSON.parse(
			storage.get(DESIGN_STORAGE_KEY) ?? "{}",
		) as DesignDocument
		expect(
			saved.objects.every((object) => object.appearance.stroke === undefined),
		).toBe(true)

		const strokeInk = document.querySelector<HTMLButtonElement>(
			'button[aria-label="Use Rich black as stroke paint"]',
		)
		const noFill = document.querySelector<HTMLButtonElement>(
			'button[aria-label="Set fill paint to none"]',
		)
		const swap = document.querySelector<HTMLButtonElement>(
			'button[aria-label="Swap fill and stroke paints"]',
		)
		if (strokeInk === null || noFill === null || swap === null)
			throw new Error("Appearance paint actions were not found.")
		await act(async () => {
			strokeInk.click()
			await Promise.resolve()
		})
		await act(async () => {
			noFill.click()
			await Promise.resolve()
		})
		await act(async () => {
			swap.click()
			await Promise.resolve()
		})
		saved = JSON.parse(
			storage.get(DESIGN_STORAGE_KEY) ?? "{}",
		) as DesignDocument
		expect(saved.objects.map((object) => object.appearance)).toEqual([
			{ fill: { swatchId: "swatch:ink" } },
			{ fill: { swatchId: "swatch:ink" } },
		])
	})

	it("authors the complete stroke vocabulary and renders it on canvas", async () => {
		const storage = new Map<string, string>()
		const stage = mountDesign({}, storage)
		const layer = document.querySelector<HTMLButtonElement>(
			"design-layers-tile > button:last-child",
		)
		if (layer === null) throw new Error("Design layer was not found.")
		act(() => layer.click())
		const strokeTarget = document.querySelector<HTMLButtonElement>(
			'button[aria-label="Stroke paint: None"]',
		)
		if (strokeTarget === null) throw new Error("Stroke target was not found.")
		await act(async () => {
			strokeTarget.click()
			await Promise.resolve()
		})
		const ink = document.querySelector<HTMLButtonElement>(
			'button[aria-label="Use Rich black as stroke paint"]',
		)
		if (ink === null) throw new Error("Stroke swatch was not found.")
		await act(async () => {
			ink.click()
			await Promise.resolve()
		})

		const input = (label: string): HTMLInputElement => {
			const result = document.querySelector<HTMLInputElement>(
				`input[aria-label="Stroke ${label}"]`,
			)
			if (result === null) throw new Error(`Stroke ${label} was not found.`)
			return result
		}
		const setNumber = async (label: string, value: string): Promise<void> => {
			await act(async () => {
				const field = input(label)
				field.value = value
				field.dispatchEvent(new InputEvent("input", { bubbles: true }))
				await Promise.resolve()
			})
		}
		const setSelect = async (label: string, value: string): Promise<void> => {
			await act(async () => {
				const field = document.querySelector<HTMLSelectElement>(
					`select[aria-label="Stroke ${label}"]`,
				)
				if (field === null) throw new Error(`Stroke ${label} was not found.`)
				field.value = value
				field.dispatchEvent(new Event("change", { bubbles: true }))
				await Promise.resolve()
			})
		}
		await setNumber("width", "6")
		await setSelect("cap", "round")
		await setSelect("join", "bevel")
		await setNumber("miter limit", "8")
		await act(async () => {
			const dash = input("dash pattern")
			dash.value = "7, 3, 2"
			dash.dispatchEvent(new InputEvent("input", { bubbles: true }))
			await Promise.resolve()
		})
		await act(async () => {
			input("dash pattern").dispatchEvent(
				new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }),
			)
			await Promise.resolve()
		})
		await setNumber("dash offset", "-2")

		const saved = JSON.parse(
			storage.get(DESIGN_STORAGE_KEY) ?? "{}",
		) as DesignDocument
		expect(
			saved.objects.find((object) => object.appearance.stroke !== undefined)
				?.appearance.stroke,
		).toEqual({
			swatchId: "swatch:ink",
			width: 6,
			cap: "round",
			join: "bevel",
			miterLimit: 8,
			dashArray: [7, 3, 2],
			dashOffset: -2,
		})
		const rendered = stage
			.find(".design-object")
			.find(
				(node: { getAttr(name: string): unknown }) =>
					node.getAttr("strokeWidth") === 6,
			)
		expect(rendered?.getAttrs()).toMatchObject({
			strokeWidth: 6,
			lineCap: "round",
			lineJoin: "bevel",
			miterLimit: 8,
			dash: [7, 3, 2],
			dashOffset: -2,
		})
	})

	it("exposes why selection appearance controls are disabled", () => {
		const initial = createInitialDocument()
		const first = initial.objects[0]
		if (first === undefined) throw new Error("Expected a design object.")
		mountDesign({
			initialDocument: {
				...initial,
				objects: [{ ...first, locked: true }, ...initial.objects.slice(1)],
			},
		})
		const layer = [
			...document.querySelectorAll<HTMLButtonElement>(
				"design-layers-tile > button",
			),
		].find((button) => button.textContent?.includes(first.name))
		if (layer === undefined) throw new Error("Locked layer was not found.")
		act(() => layer.click())
		const fill = document.querySelector<HTMLButtonElement>(
			'button[aria-label^="Fill paint:"]',
		)
		expect(fill?.disabled).toBe(true)
		expect(fill?.getAttribute("aria-describedby")).toBe(
			"appearance-eligibility",
		)
		expect(
			document.getElementById("appearance-eligibility")?.textContent,
		).toContain(`Unlock ${first.name}`)
	})

	it("updates shared swatch consumers without rewriting object geometry", async () => {
		const storage = new Map<string, string>()
		const stage = mountDesign({}, storage)
		const before = createInitialDocument().objects.map(
			(object) => object.geometry,
		)
		const red = [...document.querySelectorAll("channel-input label")]
			.find((label) => label.querySelector("span")?.textContent === "R")
			?.querySelector("input")
		if (!(red instanceof HTMLInputElement))
			throw new Error("Selected swatch red channel was not found.")
		await act(async () => {
			red.value = "120"
			red.dispatchEvent(new InputEvent("input", { bubbles: true }))
			await Promise.resolve()
		})
		const saved = JSON.parse(
			storage.get(DESIGN_STORAGE_KEY) ?? "{}",
		) as DesignDocument
		expect(saved.objects.map((object) => object.geometry)).toEqual(before)
		expect(saved.objects[0]?.appearance.fill?.swatchId).toBe("swatch:coral")
		expect(stage.findOne(".design-object").fill()).toContain("120")
	})

	it("uses the current optional appearance for new Pen, rectangle, and ellipse objects", async () => {
		const storage = new Map<string, string>()
		const stage = mountDesign({}, storage)
		const canvas = stage.container().querySelector("canvas")
		const strokeTarget = document.querySelector<HTMLButtonElement>(
			'button[aria-label="Stroke paint: None"]',
		)
		if (canvas === null || strokeTarget === null)
			throw new Error("Appearance or canvas controls were not found.")
		await act(async () => {
			strokeTarget.click()
			await Promise.resolve()
		})
		const ink = document.querySelector<HTMLButtonElement>(
			'button[aria-label="Use Rich black as stroke paint"]',
		)
		const noFill = document.querySelector<HTMLButtonElement>(
			'button[aria-label="Set fill paint to none"]',
		)
		if (ink === null || noFill === null)
			throw new Error("Optional paint actions were not found.")
		await act(async () => {
			ink.click()
			noFill.click()
			await Promise.resolve()
		})

		const fire = (
			type: string,
			x: number,
			y: number,
			pointerId: number,
		): void => {
			canvas.dispatchEvent(
				new PointerEvent(type, {
					bubbles: true,
					button: 0,
					buttons: type === "pointerup" ? 0 : 1,
					clientX: x,
					clientY: y,
					isPrimary: true,
					pointerId,
					pointerType: "mouse",
				}),
			)
		}
		const drawShape = async (
			label: "Rectangle" | "Ellipse",
			start: readonly [number, number],
			end: readonly [number, number],
			pointerId: number,
		): Promise<void> => {
			const tool = document.querySelector<HTMLButtonElement>(
				`button[aria-label="${label}"]`,
			)
			if (tool === null) throw new Error(`${label} tool was not found.`)
			act(() => tool.click())
			await act(async () => {
				fire("pointerdown", start[0], start[1], pointerId)
				fire("pointermove", end[0], end[1], pointerId)
				fire("pointerup", end[0], end[1], pointerId)
				await Promise.resolve()
			})
		}
		await drawShape("Rectangle", [300, 240], [380, 300], 21)
		await drawShape("Ellipse", [420, 260], [500, 340], 22)

		const pen = document.querySelector<HTMLButtonElement>(
			'button[aria-label="Pen"]',
		)
		if (pen === null) throw new Error("Pen tool was not found.")
		act(() => pen.click())
		await act(async () => {
			fire("pointerdown", 340, 420, 23)
			fire("pointerup", 340, 420, 23)
			fire("pointerdown", 440, 440, 24)
			fire("pointerup", 440, 440, 24)
			window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }))
			await Promise.resolve()
		})

		const saved = JSON.parse(
			storage.get(DESIGN_STORAGE_KEY) ?? "{}",
		) as DesignDocument
		expect(
			saved.objects.slice(-3).map((object) => object.geometry.kind),
		).toEqual(["rectangle", "ellipse", "path"])
		expect(saved.objects.slice(-3).map((object) => object.appearance)).toEqual([
			{
				stroke: {
					...DEFAULT_DESIGN_STROKE_STYLE,
					swatchId: "swatch:ink",
					width: 1,
				},
			},
			{
				stroke: {
					...DEFAULT_DESIGN_STROKE_STYLE,
					swatchId: "swatch:ink",
					width: 1,
				},
			},
			{
				stroke: {
					...DEFAULT_DESIGN_STROKE_STYLE,
					swatchId: "swatch:ink",
					width: 1,
				},
			},
		])
	})

	it("renders authored geometry through the shared contour component", () => {
		const stage = mountDesign()
		expect(stage.find(".vector-contour-path").length).toBeGreaterThan(1)
		expect(stage.findOne(".design-object")).toBeDefined()
		const layer = document.querySelector<HTMLButtonElement>(
			"design-layers-tile > button:last-child",
		)
		const transform = document.querySelector<HTMLButtonElement>(
			'button[aria-label="Transform"]',
		)
		if (layer === null || transform === null)
			throw new Error("Design selection controls were not found.")
		act(() => {
			layer.click()
			transform.click()
		})
		const paper = stage.findOne(".design-paper")
		const contour = stage.findOne(".vector-contour-path")
		const selection = stage.findOne(".vector-selection-bounds")
		expect(paper.zIndex()).toBeLessThan(contour.zIndex())
		expect(contour.zIndex()).toBeLessThan(selection.zIndex())
	})

	it("keeps Select All and Escape mode-aware without stealing native text selection", async () => {
		const initial = createInitialDocument()
		mountDesign({
			initialDocument: {
				...initial,
				objects: [
					initial.objects[0]!,
					{ ...initial.objects[1]!, locked: true },
					{ ...initial.objects[0]!, id: "object:hidden", hidden: true },
				],
			},
		})
		await act(async () => {
			window.dispatchEvent(
				new KeyboardEvent("keydown", {
					key: "a",
					ctrlKey: true,
					bubbles: true,
				}),
			)
			await Promise.resolve()
		})
		const selected = [
			...document.querySelectorAll<HTMLButtonElement>(
				'design-layers-tile > button[aria-pressed="true"]',
			),
		]
		expect(selected).toHaveLength(1)
		expect(selected[0]?.textContent).toContain("Coral rectangle")
		expect(
			document.getElementById("design-selection-status")?.textContent,
		).toContain("1 object selected")
		await act(async () => {
			window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))
			await Promise.resolve()
		})
		expect(
			document.querySelectorAll(
				'design-layers-tile > button[aria-pressed="true"]',
			),
		).toHaveLength(0)
		const title = document.querySelector<HTMLInputElement>(
			'design-canvas-tile input[aria-label="Document title"]',
		)
		if (title === null) throw new Error("Document title field was not found.")
		title.focus()
		title.setSelectionRange(0, title.value.length)
		await act(async () => {
			title.dispatchEvent(
				new KeyboardEvent("keydown", {
					key: "a",
					ctrlKey: true,
					bubbles: true,
				}),
			)
			await Promise.resolve()
		})
		expect(title.selectionStart).toBe(0)
		expect(title.selectionEnd).toBe(title.value.length)
		expect(
			document.querySelectorAll(
				'design-layers-tile > button[aria-pressed="true"]',
			),
		).toHaveLength(0)
	})

	it("synchronizes direct node selection across canvas, inspector, and accessibility state", async () => {
		const initial = createInitialDocument()
		const storage = new Map<string, string>()
		let identity = 0
		const expanded = expandDesignShape(initial.objects[0]!, () =>
			(identity += 1).toString(),
		)
		const stage = mountDesign(
			{ initialDocument: { ...initial, objects: [expanded] } },
			storage,
		)
		const layer = document.querySelector<HTMLButtonElement>(
			"design-layers-tile > button",
		)
		const direct = document.querySelector<HTMLButtonElement>(
			'button[aria-label="Direct Selection"]',
		)
		if (layer === null || direct === null)
			throw new Error("Direct selection controls were not found.")
		act(() => {
			layer.click()
			direct.click()
		})
		const node = stage.findOne(".vector-node")
		if (node === undefined) throw new Error("Direct node was not rendered.")
		const event = new PointerEvent("pointerdown", {
			bubbles: true,
			button: 0,
			buttons: 1,
			pointerId: 72,
			pointerType: "mouse",
		})
		await act(async () => {
			stage.setPointersPositions(event)
			node.fire("pointerdown", { evt: event }, true)
			stage.fire(
				"pointerup",
				{
					evt: new PointerEvent("pointerup", {
						bubbles: true,
						button: 0,
						pointerId: 72,
						pointerType: "mouse",
					}),
				},
				true,
			)
			await Promise.resolve()
		})
		expect(stage.find(".vector-node-selection")).toHaveLength(1)
		expect(document.querySelector("design-object-tile")?.textContent).toContain(
			"Direct selection: 1 node",
		)
		expect(
			document.getElementById("design-selection-status")?.textContent,
		).toBe("1 node")
		if (expanded.geometry.kind !== "path") throw new Error("Expected a path.")
		const originalPoints = expanded.geometry.contours[0]?.points
		await act(async () => {
			window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }))
			await Promise.resolve()
		})
		let saved = JSON.parse(
			storage.get(DESIGN_STORAGE_KEY) ?? "{}",
		) as DesignDocument
		if (saved.objects[0]?.geometry.kind !== "path")
			throw new Error("Expected saved path geometry.")
		expect(saved.objects[0].geometry.contours[0]?.points[0]?.x).toBe(
			(originalPoints?.[0]?.x ?? 0) + 1,
		)
		expect(saved.objects[0].geometry.contours[0]?.points.slice(1)).toEqual(
			originalPoints?.slice(1),
		)
		await act(async () => {
			window.dispatchEvent(
				new KeyboardEvent("keydown", { key: "z", ctrlKey: true }),
			)
			await Promise.resolve()
		})
		saved = JSON.parse(
			storage.get(DESIGN_STORAGE_KEY) ?? "{}",
		) as DesignDocument
		if (saved.objects[0]?.geometry.kind !== "path")
			throw new Error("Expected restored path geometry.")
		expect(saved.objects[0].geometry.contours[0]?.points).toEqual(
			originalPoints,
		)
	})

	it("nudges a multi-object selection as one atomic undo entry", async () => {
		const storage = new Map<string, string>()
		mountDesign({}, storage)
		const layers = [
			...document.querySelectorAll<HTMLButtonElement>(
				"design-layers-tile > button",
			),
		]
		if (layers.length !== 2) throw new Error("Expected two design layers.")
		await act(async () => {
			layers[0]!.click()
			layers[1]!.dispatchEvent(
				new MouseEvent("click", { bubbles: true, shiftKey: true }),
			)
			await Promise.resolve()
		})
		await act(async () => {
			window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }))
			await Promise.resolve()
		})
		let saved = JSON.parse(
			storage.get(DESIGN_STORAGE_KEY) ?? "{}",
		) as DesignDocument
		expect(saved.objects.map((object) => object.transform.e)).toEqual([1, 1])
		await act(async () => {
			window.dispatchEvent(
				new KeyboardEvent("keydown", { key: "z", ctrlKey: true }),
			)
			await Promise.resolve()
		})
		saved = JSON.parse(
			storage.get(DESIGN_STORAGE_KEY) ?? "{}",
		) as DesignDocument
		expect(saved.objects.map((object) => object.transform.e)).toEqual([0, 0])
	})

	it("edits exact live parameters and expands a selected shape in one undo step", async () => {
		const storage = new Map<string, string>()
		mountDesign({}, storage)
		const layer = [
			...document.querySelectorAll<HTMLButtonElement>(
				"design-layers-tile > button",
			),
		].find((button) => button.textContent?.includes("Coral rectangle"))
		if (layer === undefined) throw new Error("Rectangle layer was not found.")
		act(() => layer.click())

		const field = (label: string): HTMLInputElement => {
			const input = [...document.querySelectorAll("label")]
				.find(
					(candidate) => candidate.querySelector("span")?.textContent === label,
				)
				?.querySelector("input")
			if (!(input instanceof HTMLInputElement))
				throw new Error(`${label} field was not found.`)
			return input
		}
		expect(field("Local X").valueAsNumber).toBe(82)
		expect(field("Bounds X").readOnly).toBe(true)
		expect(field("Bounds width").valueAsNumber).toBe(280)

		const width = field("Width")
		await act(async () => {
			width.value = "320"
			width.dispatchEvent(new InputEvent("input", { bubbles: true }))
			await Promise.resolve()
		})
		let saved = JSON.parse(
			storage.get(DESIGN_STORAGE_KEY) ?? "{}",
		) as DesignDocument
		expect(saved.objects[0]?.geometry).toMatchObject({
			kind: "rectangle",
			width: 320,
		})
		expect(field("Bounds width").valueAsNumber).toBe(320)

		const expand = document.querySelector<HTMLButtonElement>(
			"button[data-expand-shape]",
		)
		if (expand === null) throw new Error("Expand Shape action was not found.")
		expect(expand.disabled).toBe(false)
		expect(expand.getAttribute("aria-describedby")).toBe(
			"expand-shape-eligibility",
		)
		await act(async () => {
			expand.click()
			await Promise.resolve()
		})
		saved = JSON.parse(
			storage.get(DESIGN_STORAGE_KEY) ?? "{}",
		) as DesignDocument
		const expanded = saved.objects[0]
		expect(expanded?.geometry.kind).toBe("path")
		if (expanded?.geometry.kind !== "path") return
		expect(expanded.geometry.contours[0]?.id).toMatch(/^contour:/u)
		expect(
			expanded.geometry.contours[0]?.points.every((point) =>
				point.id?.startsWith("point:"),
			),
		).toBe(true)
		expect(expanded.appearance).toEqual(
			createInitialDocument().objects[0]?.appearance,
		)
		expect(document.querySelector("design-object-tile")?.textContent).toContain(
			"Path geometry",
		)
		expect(expand.disabled).toBe(true)
		expect(
			document.getElementById("expand-shape-eligibility")?.textContent,
		).toContain("already ordinary path")

		await act(async () => {
			window.dispatchEvent(
				new KeyboardEvent("keydown", {
					key: "z",
					ctrlKey: true,
					bubbles: true,
				}),
			)
			await Promise.resolve()
		})
		saved = JSON.parse(
			storage.get(DESIGN_STORAGE_KEY) ?? "{}",
		) as DesignDocument
		expect(saved.objects[0]?.geometry).toMatchObject({
			kind: "rectangle",
			width: 320,
		})
		expect(expand.disabled).toBe(false)
	})

	it("expands a selected stroke atomically and restores it with one undo", async () => {
		const initial = createInitialDocument()
		const first = initial.objects[0]
		if (first === undefined) throw new Error("Missing rectangle fixture.")
		const source: DesignDocument = {
			...initial,
			objects: [
				{
					...first,
					appearance: {
						...first.appearance,
						stroke: {
							swatchId: "swatch:ink",
							width: 12,
							cap: "round",
							join: "bevel",
							miterLimit: 4,
							dashArray: [20, 8],
							dashOffset: -3,
						},
					},
				},
				...initial.objects.slice(1),
			],
		}
		const storage = new Map([[DESIGN_STORAGE_KEY, JSON.stringify(source)]])
		mountDesign({}, storage)
		const layer = [
			...document.querySelectorAll<HTMLButtonElement>(
				"design-layers-tile > button",
			),
		].find((button) => button.textContent?.includes("Coral rectangle"))
		if (layer === undefined) throw new Error("Rectangle layer was not found.")
		act(() => layer.click())

		const expand = document.querySelector<HTMLButtonElement>(
			"button[data-expand-stroke]",
		)
		if (expand === null) throw new Error("Expand Stroke action was not found.")
		expect(expand.disabled).toBe(false)
		await act(async () => {
			expand.click()
			await Promise.resolve()
		})
		let saved = JSON.parse(
			storage.get(DESIGN_STORAGE_KEY) ?? "{}",
		) as DesignDocument
		expect(saved.objects).toHaveLength(3)
		expect(saved.objects[0]).toMatchObject({
			name: "Coral rectangle fill",
			appearance: { fill: { swatchId: "swatch:coral" } },
		})
		expect(saved.objects[1]).toMatchObject({
			id: "object:coral",
			geometry: { kind: "path" },
			appearance: { fill: { swatchId: "swatch:ink" } },
		})
		expect(saved.objects[2]).toEqual(source.objects[1])
		expect(expand.disabled).toBe(true)
		expect(
			document.getElementById("expand-stroke-eligibility")?.textContent,
		).toContain("Assign a stroke")

		await act(async () => {
			window.dispatchEvent(
				new KeyboardEvent("keydown", {
					key: "z",
					ctrlKey: true,
					bubbles: true,
				}),
			)
			await Promise.resolve()
		})
		saved = JSON.parse(
			storage.get(DESIGN_STORAGE_KEY) ?? "{}",
		) as DesignDocument
		expect(saved).toEqual(source)
		expect(expand.disabled).toBe(false)
	})

	it("clears stale direct node selection after expanding a path stroke", async () => {
		const initial = createInitialDocument()
		const first = initial.objects[0]
		if (first === undefined) throw new Error("Missing rectangle fixture.")
		let identity = 0
		const path = expandDesignShape(first, () => `source:${identity++}`)
		const source: DesignDocument = {
			...initial,
			objects: [
				{
					...path,
					appearance: {
						stroke: {
							swatchId: "swatch:ink",
							width: 12,
							cap: "round",
							join: "bevel",
							miterLimit: 4,
							dashArray: [],
							dashOffset: 0,
						},
					},
				},
			],
		}
		const storage = new Map([[DESIGN_STORAGE_KEY, JSON.stringify(source)]])
		const stage = mountDesign({}, storage)
		const layer = document.querySelector<HTMLButtonElement>(
			"design-layers-tile > button",
		)
		const direct = document.querySelector<HTMLButtonElement>(
			'button[aria-label="Direct Selection"]',
		)
		if (layer === null || direct === null)
			throw new Error("Direct selection controls were not found.")
		act(() => layer.click())
		const expand = document.querySelector<HTMLButtonElement>(
			"button[data-expand-stroke]",
		)
		if (expand === null) throw new Error("Expand Stroke action was not found.")
		act(() => direct.click())
		const node = stage.findOne(".vector-node")
		if (node === undefined) throw new Error("Direct node was not rendered.")
		const pointerDown = new PointerEvent("pointerdown", {
			bubbles: true,
			button: 0,
			buttons: 1,
			pointerId: 267,
			pointerType: "mouse",
		})
		await act(async () => {
			stage.setPointersPositions(pointerDown)
			node.fire("pointerdown", { evt: pointerDown }, true)
			stage.fire(
				"pointerup",
				{
					evt: new PointerEvent("pointerup", {
						bubbles: true,
						button: 0,
						pointerId: 267,
						pointerType: "mouse",
					}),
				},
				true,
			)
			await Promise.resolve()
		})
		expect(stage.find(".vector-node-selection")).toHaveLength(1)

		await act(async () => {
			expand.click()
			await Promise.resolve()
		})
		expect(stage.find(".vector-node-selection")).toHaveLength(0)
		expect(document.querySelector("design-object-tile")?.textContent).toContain(
			"No direct controls selected.",
		)
	})

	it("leaves document, selection, and history unchanged when stroke expansion fails", async () => {
		const initial = createInitialDocument()
		const first = initial.objects[0]
		if (first === undefined) throw new Error("Missing rectangle fixture.")
		const source: DesignDocument = {
			...initial,
			objects: [
				{
					...first,
					name: "Degenerate stroke",
					geometry: {
						kind: "path",
						contours: [
							{
								id: "contour:degenerate",
								closed: false,
								points: [
									{ id: "point:degenerate:0", x: 10, y: 10 },
									{ id: "point:degenerate:1", x: 10, y: 10 },
								],
							},
						],
					},
					appearance: {
						stroke: {
							swatchId: "swatch:ink",
							width: 10,
							cap: "round",
							join: "round",
							miterLimit: 4,
							dashArray: [],
							dashOffset: 0,
						},
					},
				},
				...initial.objects.slice(1),
			],
		}
		const storage = new Map([[DESIGN_STORAGE_KEY, JSON.stringify(source)]])
		mountDesign({}, storage)
		const layer = [
			...document.querySelectorAll<HTMLButtonElement>(
				"design-layers-tile > button",
			),
		].find((button) => button.textContent?.includes("Degenerate stroke"))
		if (layer === undefined) throw new Error("Degenerate layer was not found.")
		act(() => layer.click())
		const expand = document.querySelector<HTMLButtonElement>(
			"button[data-expand-stroke]",
		)
		if (expand === null) throw new Error("Expand Stroke action was not found.")
		expect(expand.disabled).toBe(false)

		await act(async () => {
			expand.click()
			await Promise.resolve()
		})
		expect(JSON.parse(storage.get(DESIGN_STORAGE_KEY) ?? "{}")).toEqual(source)
		expect(layer.getAttribute("aria-pressed")).toBe("true")
		expect(document.querySelector("footer > span")?.textContent).toContain(
			"no visible length",
		)

		await act(async () => {
			window.dispatchEvent(
				new KeyboardEvent("keydown", {
					key: "z",
					ctrlKey: true,
					bubbles: true,
				}),
			)
			await Promise.resolve()
		})
		expect(JSON.parse(storage.get(DESIGN_STORAGE_KEY) ?? "{}")).toEqual(source)
		expect(layer.getAttribute("aria-pressed")).toBe("true")
	})

	it.each([
		["nw", { x: -40, y: -30 }, { x: "maxX", y: "maxY" }],
		["ne", { x: 40, y: -30 }, { x: "minX", y: "maxY" }],
		["se", { x: 40, y: 30 }, { x: "minX", y: "minY" }],
		["sw", { x: -40, y: 30 }, { x: "maxX", y: "minY" }],
	] as const)(
		"keeps the opposite design corner fixed when dragging %s",
		async (handleName, delta, fixed) => {
			const stage = mountDesign()
			vi.spyOn(
				HTMLCanvasElement.prototype,
				"setPointerCapture",
			).mockImplementation(() => undefined)
			vi.spyOn(
				HTMLCanvasElement.prototype,
				"releasePointerCapture",
			).mockImplementation(() => undefined)
			vi.spyOn(
				HTMLCanvasElement.prototype,
				"hasPointerCapture",
			).mockReturnValue(false)
			const layer = [
				...document.querySelectorAll<HTMLButtonElement>(
					"design-layers-tile > button",
				),
			].find((button) => button.textContent?.includes("Coral rectangle"))
			const transform = document.querySelector<HTMLButtonElement>(
				'button[aria-label="Transform"]',
			)
			if (layer === undefined || transform === null)
				throw new Error("Design transform controls were not found.")
			act(() => {
				layer.click()
				transform.click()
			})
			const handle = stage.findOne(`.transform-handle-${handleName}`)
			const canvas = stage.container().querySelector("canvas")
			if (handle === undefined || canvas === null)
				throw new Error(`${handleName} design transform handle was not found.`)
			let pointer = handle.getAbsolutePosition()
			vi.spyOn(stage, "getPointerPosition").mockImplementation(() => pointer)
			await act(async () => {
				handle.fire("pointerdown", {
					evt: {
						altKey: false,
						button: 0,
						ctrlKey: false,
						currentTarget: canvas,
						metaKey: false,
						pointerId: 7,
						shiftKey: false,
					},
				})
				pointer = {
					x: pointer.x + delta.x,
					y: pointer.y + delta.y,
				}
				for (const type of ["pointermove", "pointerup"]) {
					canvas.dispatchEvent(
						new PointerEvent(type, {
							bubbles: true,
							button: 0,
							buttons: type === "pointerup" ? 0 : 1,
							clientX: pointer.x,
							clientY: pointer.y,
							isPrimary: true,
							pointerId: 7,
							pointerType: "mouse",
						}),
					)
				}
				await Promise.resolve()
			})
			const saved = localStorage.getItem(DESIGN_STORAGE_KEY)
			if (saved === null) throw new Error("Design document was not persisted.")
			const next = JSON.parse(saved) as DesignDocument
			const bounds = objectBounds(
				next.objects.find((object) => object.id === "object:coral")!,
			)
			if (bounds === null) throw new Error("Transformed object has no bounds.")
			const original = { minX: 82, minY: 102, maxX: 362, maxY: 342 }
			expect(bounds[fixed.x]).toBe(original[fixed.x])
			expect(bounds[fixed.y]).toBe(original[fixed.y])
		},
	)

	it("cancels a native pointer gesture before a later pointer-up", async () => {
		const stage = mountDesign()
		vi.spyOn(
			HTMLCanvasElement.prototype,
			"setPointerCapture",
		).mockImplementation(() => undefined)
		vi.spyOn(
			HTMLCanvasElement.prototype,
			"releasePointerCapture",
		).mockImplementation(() => undefined)
		vi.spyOn(HTMLCanvasElement.prototype, "hasPointerCapture").mockReturnValue(
			false,
		)
		const rectangle = document.querySelector<HTMLButtonElement>(
			'button[aria-label="Rectangle"]',
		)
		if (rectangle === null) throw new Error("Rectangle tool was not found.")
		act(() => rectangle.click())
		const canvas = stage.container().querySelector("canvas")
		if (canvas === null) throw new Error("Design canvas was not found.")
		const fire = (type: string, x: number, y: number): void => {
			canvas.dispatchEvent(
				new PointerEvent(type, {
					bubbles: true,
					button: 0,
					buttons: type === "pointerup" ? 0 : 1,
					clientX: x,
					clientY: y,
					isPrimary: true,
					pointerId: 7,
					pointerType: "mouse",
				}),
			)
		}
		await act(async () => {
			fire("pointerdown", 320, 260)
			fire("pointermove", 440, 380)
			fire("pointercancel", 440, 380)
			fire("pointerup", 440, 380)
			await Promise.resolve()
		})
		const saved = localStorage.getItem(DESIGN_STORAGE_KEY)
		if (saved === null) throw new Error("Design document was not persisted.")
		expect(JSON.parse(saved).objects).toHaveLength(2)
	})

	it("commits a shared Pen draft with cubic handles and discards canceled drafts synchronously", async () => {
		const stage = mountDesign()
		vi.spyOn(
			HTMLCanvasElement.prototype,
			"setPointerCapture",
		).mockImplementation(() => undefined)
		vi.spyOn(
			HTMLCanvasElement.prototype,
			"releasePointerCapture",
		).mockImplementation(() => undefined)
		vi.spyOn(HTMLCanvasElement.prototype, "hasPointerCapture").mockReturnValue(
			false,
		)
		const pen = document.querySelector<HTMLButtonElement>(
			'button[aria-label="Pen"]',
		)
		const canvas = stage.container().querySelector("canvas")
		if (pen === null || canvas === null)
			throw new Error("Pen controls were not found.")
		act(() => pen.click())
		const fire = (type: string, x: number, y: number, pointerId = 7): void => {
			canvas.dispatchEvent(
				new PointerEvent(type, {
					bubbles: true,
					button: 0,
					buttons: type === "pointerup" ? 0 : 1,
					clientX: x,
					clientY: y,
					isPrimary: true,
					pointerId,
					pointerType: "mouse",
				}),
			)
		}
		await act(async () => {
			fire("pointerdown", 360, 280)
			fire("pointerup", 360, 280)
			fire("pointerdown", 460, 340)
			fire("pointermove", 485, 360)
			await Promise.resolve()
		})
		const penPreview = stage.findOne(".vector-pen-preview")
		expect(penPreview).toBeDefined()
		expect(penPreview.find(".vector-node-selection")).toHaveLength(0)
		expect(stage.find(".vector-handle").length).toBeGreaterThanOrEqual(2)
		await act(async () => {
			fire("pointerup", 485, 360)
			window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }))
			await Promise.resolve()
		})
		let saved = localStorage.getItem(DESIGN_STORAGE_KEY)
		if (saved === null) throw new Error("Design document was not persisted.")
		let parsed = JSON.parse(saved)
		expect(parsed.objects).toHaveLength(3)
		const contour = parsed.objects.at(-1).geometry.contours[0]
		expect(contour.closed).toBe(false)
		expect(contour.points).toHaveLength(2)
		expect("incoming" in contour.points[0]).toBe(false)
		expect("outgoing" in contour.points[0]).toBe(false)
		expect(contour.points[1]).toMatchObject({
			incoming: expect.any(Object),
			outgoing: expect.any(Object),
		})
		expect(
			document.querySelector('design-layers-tile > button[aria-pressed="true"]')
				?.textContent,
		).toContain("Pen path")

		await act(async () => {
			fire("pointerdown", 520, 420, 8)
			fire("pointermove", 550, 450, 8)
			fire("pointercancel", 550, 450, 8)
			fire("pointerup", 550, 450, 8)
			window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }))
			await Promise.resolve()
		})
		saved = localStorage.getItem(DESIGN_STORAGE_KEY)
		if (saved === null) throw new Error("Design document was not persisted.")
		parsed = JSON.parse(saved)
		expect(parsed.objects).toHaveLength(3)
	})
})
