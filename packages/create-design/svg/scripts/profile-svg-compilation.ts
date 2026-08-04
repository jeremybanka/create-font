import {
	createInitialDocument,
	type DesignDocument,
	type DesignObject,
} from "@create-design/source"
import { createSvgProjectionGraph, serializeSvg } from "../src/index.ts"

const ITERATIONS = 40
const OBJECT_COUNT = 500

function percentile(values: readonly number[], ratio: number): number {
	const sorted = values.toSorted((left, right) => left - right)
	return (
		sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))] ?? 0
	)
}

function fixture(): DesignDocument {
	const initial = createInitialDocument()
	const template = initial.objects[0]!
	const objects: DesignObject[] = Array.from(
		{ length: OBJECT_COUNT },
		(_, index) => ({
			...template,
			id: `object:benchmark:${index}`,
			name: `Benchmark object ${index}`,
			transform: {
				...template.transform,
				e: (index % 20) * 23,
				f: Math.floor(index / 20) * 23,
			},
		}),
	)
	return { ...initial, title: "SVG preview benchmark", objects }
}

const graph = createSvgProjectionGraph()
let document = fixture()
const samples: { projection: number; serialization: number; total: number }[] =
	[]
const compile = () => {
	const started = performance.now()
	const projection = graph.project(document)
	const projected = performance.now()
	serializeSvg(projection)
	const serialized = performance.now()
	return {
		projection: projected - started,
		serialization: serialized - projected,
		total: serialized - started,
	}
}
const cold = compile()
for (let iteration = 0; iteration < ITERATIONS; iteration++) {
	const first = document.objects[0]!
	document = {
		...document,
		objects: [
			{
				...first,
				transform: {
					...first.transform,
					e: first.transform.e + (iteration % 2 === 0 ? 1 : -1),
				},
			},
			...document.objects.slice(1),
		],
	}
	samples.push(compile())
}
const totals = samples.map(({ total }) => total)
console.log(
	JSON.stringify(
		{
			fixture: `${OBJECT_COUNT} vector objects; one transform edited per iteration`,
			runtime: process.version,
			iterations: ITERATIONS,
			cold,
			warm: {
				median: percentile(totals, 0.5),
				p95: percentile(totals, 0.95),
				min: Math.min(...totals),
				max: Math.max(...totals),
				samples,
			},
			note: "Queueing and browser activation are exposed by the live preview UI; this benchmark intentionally asserts no machine-dependent threshold.",
		},
		null,
		2,
	),
)
