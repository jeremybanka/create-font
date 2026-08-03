import { createRequire } from "node:module"

import { Window } from "happy-dom"

const window = new Window({
	height: 768,
	url: "http://localhost/",
	width: 1_024,
})

Object.assign(globalThis, {
	document: window.document,
	Element: window.Element,
	Event: window.Event,
	HTMLCanvasElement: window.HTMLCanvasElement,
	HTMLElement: window.HTMLElement,
	HTMLDivElement: window.HTMLDivElement,
	Node: window.Node,
	requestAnimationFrame: window.requestAnimationFrame.bind(window),
	cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
	window,
})
Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
	configurable: true,
	value: true,
	writable: true,
})

window.HTMLCanvasElement.prototype.getContext = function () {
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
}

const runtimeImportStarted = performance.now()
const require = createRequire(import.meta.url)
const requireFromRenderer = createRequire(require.resolve("../package.json"))
const [
	{ createElement: h, act },
	{ createRoot },
	renderer,
	{ default: Konva },
] = await Promise.all([
	import("react"),
	import("react-dom/client"),
	import("../src/canvas-renderer.ts"),
	import(requireFromRenderer.resolve("konva/lib/Core")),
])
const runtimeImportMs = performance.now() - runtimeImportStarted

Konva.autoDrawEnabled = false

const { Group, Layer, Rect, Stage } = renderer
const SCENE_SIZE = 1_000
const UPDATE_RUNS = 60
const MOUNT_RUNS = 12
const REORDER_RUNS = 20

function scene(revision: number, reversed = false) {
	const indexes = Array.from({ length: SCENE_SIZE }, (_, index) => index)
	if (reversed) indexes.reverse()
	return h(
		Stage,
		{ height: 768, width: 1_024 },
		h(
			Layer,
			null,
			h(
				Group,
				{ id: "dense-scene" },
				indexes.map((index) =>
					h(Rect, {
						fill: index % 2 === 0 ? "#161616" : "#f4f4f4",
						height: 8,
						id: `rect:${index}`,
						key: `rect:${index}`,
						width: 8,
						x: (index % 40) * 12 + (index === revision % SCENE_SIZE ? 1 : 0),
						y: Math.floor(index / 40) * 12,
					}),
				),
			),
		),
	)
}

function host(): HTMLElement {
	const element = document.createElement("section")
	document.body.append(element)
	return element
}

const roots = new WeakMap<HTMLElement, ReturnType<typeof createRoot>>()

function commit(element: ReturnType<typeof scene>, target: HTMLElement): void {
	const mounted = roots.get(target) ?? createRoot(target)
	if (!roots.has(target)) roots.set(target, mounted)
	act(() => mounted.render(element))
}

function unmount(target: HTMLElement): void {
	const mounted = roots.get(target)
	if (mounted !== undefined) {
		act(() => mounted.unmount())
		roots.delete(target)
	}
	target.remove()
}

function summary(samples: readonly number[]) {
	const ordered = [...samples].sort((a, b) => a - b)
	const percentile = (value: number) =>
		ordered[Math.min(ordered.length - 1, Math.floor(ordered.length * value))] ??
		0
	const total = ordered.reduce((sum, sample) => sum + sample, 0)
	return {
		meanMs: total / ordered.length,
		medianMs: percentile(0.5),
		p95Ms: percentile(0.95),
	}
}

for (let index = 0; index < 4; index += 1) {
	const target = host()
	commit(scene(index), target)
	commit(scene(index + 1), target)
	unmount(target)
}

globalThis.gc?.()
const heapBefore = process.memoryUsage().heapUsed

const mountSamples: number[] = []
for (let index = 0; index < MOUNT_RUNS; index += 1) {
	const target = host()
	const next = scene(index)
	const started = performance.now()
	commit(next, target)
	mountSamples.push(performance.now() - started)
	unmount(target)
}

const updateHost = host()
commit(scene(0), updateHost)
const updateSamples: number[] = []
for (let revision = 1; revision <= UPDATE_RUNS; revision += 1) {
	const next = scene(revision)
	const started = performance.now()
	commit(next, updateHost)
	updateSamples.push(performance.now() - started)
}

const reorderSamples: number[] = []
for (let revision = 0; revision < REORDER_RUNS; revision += 1) {
	const next = scene(revision, revision % 2 === 0)
	const started = performance.now()
	commit(next, updateHost)
	reorderSamples.push(performance.now() - started)
}

const stage = Konva.stages.at(-1)
if (stage?.find("Rect").length !== SCENE_SIZE) {
	throw new Error(`Dense scene did not retain ${SCENE_SIZE} rectangles.`)
}

const unmountStarted = performance.now()
unmount(updateHost)
const unmountMs = performance.now() - unmountStarted
if (Konva.stages.length !== 0) {
	throw new Error(`Runtime leaked ${Konva.stages.length} Konva stages.`)
}

globalThis.gc?.()
const heapAfter = process.memoryUsage().heapUsed

console.log(
	JSON.stringify(
		{
			heapDeltaBytes: heapAfter - heapBefore,
			mount: summary(mountSamples),
			reorder: summary(reorderSamples),
			runtimeImportMs,
			sceneSize: SCENE_SIZE,
			unmountMs,
			update: summary(updateSamples),
		},
		null,
		2,
	),
)
