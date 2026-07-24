import { performance } from "node:perf_hooks"
import { readFile, stat } from "node:fs/promises"

type ParserApi = {
	formatFea(source: string, configuration: string): string
	parseFea(source: string): string
}

const fixtureUrl = new URL(
	"../crates/create-font-fea/tests/fixtures/comprehensive.fea",
	import.meta.url,
)
const moduleUrl = new URL(
	"../packages/fea-parser/dist/node/create_font_fea_parser.js",
	import.meta.url,
)
const wasmUrl = new URL(
	"../packages/fea-parser/dist/node/create_font_fea_parser_bg.wasm",
	import.meta.url,
)

const loadStarted = performance.now()
const api = (await import(moduleUrl.href)) as ParserApi
const coldLoadMs = performance.now() - loadStarted
const smallSource = await readFile(fixtureUrl, "utf8")
const largeSource = smallSource.repeat(25)

function measure(iterations: number, operation: () => void): number {
	operation()
	const started = performance.now()
	for (let index = 0; index < iterations; index += 1) operation()
	return (performance.now() - started) / iterations
}

const result = {
	node: process.version,
	wasmBytes: (await stat(wasmUrl)).size,
	smallSourceBytes: Buffer.byteLength(smallSource),
	largeSourceBytes: Buffer.byteLength(largeSource),
	coldLoadMs,
	parseSmallMeanMs: measure(100, () => {
		api.parseFea(smallSource)
	}),
	formatSmallMeanMs: measure(100, () => {
		api.formatFea(smallSource, "{}")
	}),
	parseLargeMeanMs: measure(10, () => {
		api.parseFea(largeSource)
	}),
	formatLargeMeanMs: measure(10, () => {
		api.formatFea(largeSource, "{}")
	}),
}

console.log(JSON.stringify(result, null, "\t"))
