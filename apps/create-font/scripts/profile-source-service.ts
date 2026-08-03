import { resolve } from "node:path"

import {
	createFileSystemSourceService,
	type SourceProjectLoadDiagnostic,
} from "../src/source-service.ts"

const projectRoot = resolve(process.argv[2] ?? `fonts/workbench-sans`)
const diagnostics: SourceProjectLoadDiagnostic[] = []

const service = await createFileSystemSourceService(projectRoot, {
	onProjectLoad: (diagnostic) => diagnostics.push(diagnostic),
})

const manifestStartedAt = performance.now()
const manifest = await service.readManifest()
const manifestWallDuration = performance.now() - manifestStartedAt

const unitReadsStartedAt = performance.now()
await Promise.all(manifest.units.map(({ path }) => service.readUnit(path)))
const unitReadsWallDuration = performance.now() - unitReadsStartedAt

const snapshotSamples = []
for (let index = 0; index < 10; index += 1) {
	const snapshotStartedAt = performance.now()
	const snapshot = await service.readSnapshot()
	snapshotSamples.push({
		duration: performance.now() - snapshotStartedAt,
		snapshot,
	})
}
const snapshot = snapshotSamples.at(-1)?.snapshot
if (snapshot === undefined) throw new Error(`No snapshot was profiled.`)

const serializationStartedAt = performance.now()
const bulkPayload = JSON.stringify(snapshot)
const bulkSerializationDuration = performance.now() - serializationStartedAt

const quantile = (values: readonly number[], probability: number): number => {
	const sorted = values.toSorted((left, right) => left - right)
	if (sorted.length === 0) return 0
	const position = (sorted.length - 1) * probability
	const lowerIndex = Math.floor(position)
	const lower = sorted[lowerIndex] ?? 0
	const upper = sorted[lowerIndex + 1] ?? lower
	return lower + (upper - lower) * (position - lowerIndex)
}

const summarize = (events: readonly SourceProjectLoadDiagnostic[]) => ({
	assemble: {
		p50: quantile(
			events.map((event) => event.assembleDuration),
			0.5,
		),
		p95: quantile(
			events.map((event) => event.assembleDuration),
			0.95,
		),
	},
	collectPaths: {
		p50: quantile(
			events.map((event) => event.collectPathsDuration),
			0.5,
		),
		p95: quantile(
			events.map((event) => event.collectPathsDuration),
			0.95,
		),
	},
	count: events.length,
	readParse: {
		p50: quantile(
			events.map((event) => event.readParseDuration),
			0.5,
		),
		p95: quantile(
			events.map((event) => event.readParseDuration),
			0.95,
		),
	},
	total: {
		p50: quantile(
			events.map((event) => event.totalDuration),
			0.5,
		),
		p95: quantile(
			events.map((event) => event.totalDuration),
			0.95,
		),
	},
})

const grouped = Map.groupBy(diagnostics, (diagnostic) => diagnostic.trigger)
const report = {
	bulkTheory: {
		encodedPayloadBytes: new TextEncoder().encode(bulkPayload).byteLength,
		estimatedSingleLoadAndSerialization:
			(diagnostics.find((event) => event.trigger === `read-snapshot`)
				?.totalDuration ?? 0) + bulkSerializationDuration,
		serializationDuration: bulkSerializationDuration,
	},
	manifestWallDuration,
	projectRoot,
	projectLoads: Object.fromEntries(
		[...grouped].map(([trigger, events]) => [trigger, summarize(events)]),
	),
	sourceUnitCount: manifest.units.length,
	snapshotWall: {
		p50: quantile(
			snapshotSamples.map(({ duration }) => duration),
			0.5,
		),
		p95: quantile(
			snapshotSamples.map(({ duration }) => duration),
			0.95,
		),
	},
	totalProjectLoadCount: diagnostics.length,
	unitReadsWallDuration,
}

console.log(JSON.stringify(report, null, `\t`))
