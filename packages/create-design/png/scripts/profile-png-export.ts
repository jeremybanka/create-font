import { createInitialDocument } from "@create-design/source"
import { exportPng } from "../src/index.ts"

const runs = 5
const initial = createInitialDocument()
const document = {
	...initial,
	artboards: Array.from({ length: 4 }, (_, index) => ({
		...initial.artboards[0]!,
		id: `artboard:${index + 1}`,
		name: `Page ${index + 1}`,
		x: index * 80,
		width: 64,
		height: 64,
	})),
}

async function measured(scope: "active" | "all") {
	const start = performance.now()
	const result = await exportPng(document, {
		scope:
			scope === "all"
				? { kind: "all" }
				: { kind: "active", artboardId: "artboard:1" },
		samples: 2,
	})
	return {
		bytes: result.artifacts.reduce(
			(sum, artifact) => sum + artifact.bytes.length,
			0,
		),
		milliseconds: performance.now() - start,
	}
}

const heapBefore = process.memoryUsage().heapUsed
const cold = await measured("active")
const warm = []
for (let index = 0; index < runs; index += 1)
	warm.push(await measured("active"))
const batch = await measured("all")
const heapAfter = process.memoryUsage().heapUsed
process.stdout.write(
	`${JSON.stringify(
		{
			backend: "reference-typescript",
			batch,
			cold,
			node: process.version,
			retainedHeapBytes: heapAfter - heapBefore,
			warm: {
				medianMilliseconds: warm
					.map(({ milliseconds }) => milliseconds)
					.sort((a, b) => a - b)[Math.floor(runs / 2)],
				runs,
			},
		},
		null,
		2,
	)}\n`,
)
