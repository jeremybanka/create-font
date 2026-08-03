import { serializePdf } from "mondrian.pdf"

import {
	createInitialDocument,
	type DesignDocument,
	type DesignObject,
} from "@create-design/source"
import { createPdfProjectionGraph } from "../src/pdf.ts"

const ITERATIONS = 40
const OBJECT_COUNT = 500

function percentile(values: readonly number[], ratio: number): number {
	const sorted = values.toSorted((left, right) => left - right)
	return (
		sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))] ?? 0
	)
}

function largeDocument(): DesignDocument {
	const initial = createInitialDocument()
	const artboard = initial.artboards[0]!
	const template = initial.objects[0]!
	const objects: DesignObject[] = Array.from(
		{ length: OBJECT_COUNT },
		(_, index) => {
			const column = index % 20
			const row = Math.floor(index / 20)
			return {
				...template,
				id: `benchmark:${index}`,
				name: `Benchmark object ${index}`,
				transform: {
					...template.transform,
					e: (column * 23) % artboard.width,
					f: (row * 23) % artboard.height,
				},
			}
		},
	)
	return { ...initial, title: "Incremental PDF benchmark", objects }
}

function editFirstPoint(
	document: DesignDocument,
	iteration: number,
): DesignDocument {
	const object = document.objects[0]!
	return {
		...document,
		objects: [
			{
				...object,
				transform: {
					...object.transform,
					e: object.transform.e + (iteration % 2 === 0 ? 1 : -1),
				},
			},
			...document.objects.slice(1),
		],
	}
}

const graph = createPdfProjectionGraph()
let document = largeDocument()
const coldStarted = performance.now()
const coldProjectionStarted = performance.now()
const coldProjection = graph.project(document)
const coldProjected = performance.now()
serializePdf(coldProjection.document)
const coldSerialized = performance.now()
const samples: {
	projection: number
	total: number
	validationAndSerialization: number
}[] = []

for (let iteration = 0; iteration < ITERATIONS; iteration++) {
	document = editFirstPoint(document, iteration)
	const started = performance.now()
	const projection = graph.project(document)
	const projected = performance.now()
	serializePdf(projection.document)
	const serialized = performance.now()
	samples.push({
		projection: projected - started,
		total: serialized - started,
		validationAndSerialization: serialized - projected,
	})
}

const total = samples.map((sample) => sample.total)
console.log(
	JSON.stringify(
		{
			fixture: `${OBJECT_COUNT} vector objects; one point edited per iteration`,
			runtime: process.version,
			iterations: ITERATIONS,
			cold: {
				projection: coldProjected - coldProjectionStarted,
				total: coldSerialized - coldStarted,
				validationAndSerialization: coldSerialized - coldProjected,
			},
			warm: {
				median: percentile(total, 0.5),
				p95: percentile(total, 0.95),
				min: Math.min(...total),
				max: Math.max(...total),
				samples,
			},
			note: "Queueing and browser PDF-viewer activation are exposed by the live preview UI and are not available in this Node benchmark.",
		},
		null,
		2,
	),
)
