import { createEditorWorkspace } from "../src/editor-workspace.ts"
import { oGlyphId, razorMasterId } from "../src/demo-font.ts"
import type { LiveFontCompilationState } from "../src/live-font-compilation.ts"

const ITERATIONS = 40

function percentile(values: readonly number[], ratio: number): number {
	const sorted = values.toSorted((left, right) => left - right)
	return (
		sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))] ?? 0
	)
}

const coldStarted = performance.now()
const workspace = createEditorWorkspace()

function waitForRevision(revision: number) {
	return new Promise<Extract<LiveFontCompilationState, { status: "ready" }>>(
		(resolve) => {
			const inspect = (): boolean => {
				const state = workspace.font.silo.getState(
					workspace.liveFont.compilation,
				)
				if (state.status !== "ready" || state.revision < revision) return false
				resolve(state)
				return true
			}
			if (inspect()) return
			const unsubscribe = workspace.font.silo.subscribe(
				workspace.liveFont.compilation,
				() => {
					if (inspect()) unsubscribe()
				},
			)
		},
	)
}

workspace.liveFont.start()
const cold = await waitForRevision(
	workspace.font.silo.getState(workspace.font.atoms.documentRevision),
)
const coldWall = performance.now() - coldStarted
const samples: number[] = []

for (let iteration = 0; iteration < ITERATIONS; iteration++) {
	const source = workspace.font.read.editorSource()
	const point = source?.glyphs
		.find((glyph) => glyph.id === oGlyphId)
		?.layers.find((layer) => layer.masterId === razorMasterId)?.contours[0]
		?.points[0]
	if (point === undefined)
		throw new Error("The benchmark fixture point is missing.")
	workspace.font.actions.movePoints({
		masterId: razorMasterId,
		glyphId: oGlyphId,
		points: [
			{
				pointId: point.id,
				x: point.x + (iteration % 2 === 0 ? 1 : -1),
				y: point.y,
			},
		],
	})
	const revision = workspace.font.silo.getState(
		workspace.font.atoms.documentRevision,
	)
	const ready = await waitForRevision(revision)
	samples.push(ready.artifact.timings.total)
}

workspace.liveFont.stop()
console.log(
	JSON.stringify(
		{
			fixture:
				"packages/create-font/editor/src/demo-font.ts (glyph O, Razor master)",
			runtime: process.version,
			iterations: ITERATIONS,
			cold: { ...cold.artifact.timings, workspaceToBytes: coldWall },
			warm: {
				median: percentile(samples, 0.5),
				p95: percentile(samples, 0.95),
				min: Math.min(...samples),
				max: Math.max(...samples),
				samples,
			},
			note: "FontFace activation and first paint are browser-only and exposed on PreviewTile data attributes.",
		},
		null,
		2,
	),
)
