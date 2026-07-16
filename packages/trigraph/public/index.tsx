import { EditorApplicationRoot } from "@trigraph/editor"
import {
	createTrigraphRpcClient,
	type TrigraphRpcClient,
} from "@trigraph/server/client"
import type {
	JsonValue,
	SourceUnitSnapshot,
	SourceUnitWrite,
} from "@trigraph/server"
import {
	assembleEditorFontSource,
	splitEditorFontSource,
	type AxisIndexFile,
	type CmapIndexFile,
	type FontSourceDirectoryFiles,
	type GlyphIndexFile,
	type InstanceIndexFile,
	type MasterIndexFile,
	type SplitFontSourceOptions,
} from "@trigraph/source/browser"
import type { EditorFontSource } from "@trigraph/states"
import { render } from "preact"

const mount = document.querySelector<HTMLElement>("#app")
if (mount === null) throw new Error("Missing #app mount element.")
const applicationMount = mount

function assertData<Value>(
	result: Readonly<{ data: Value | null; error: { status: number } | null }>,
	operation: string,
): Value {
	if (result.error !== null || result.data === null) {
		throw new Error(
			`${operation} failed with HTTP ${result.error?.status ?? 500}.`,
		)
	}
	return result.data
}

async function loadSourceUnits(
	client: TrigraphRpcClient,
): Promise<readonly SourceUnitSnapshot[]> {
	const manifest = assertData(await client.api.source.get(), `Source inventory`)
	if (`code` in manifest) throw new Error(`Font source is not available.`)
	return Promise.all(
		manifest.units.map(async ({ path }) => {
			const snapshot = assertData(
				await client.api.source.unit.get({ query: { path } }),
				`Read ${path}`,
			)
			if (`code` in snapshot)
				throw new Error(`Source unit ${path} is unavailable.`)
			return snapshot
		}),
	)
}

function pathOptions(files: FontSourceDirectoryFiles): SplitFontSourceOptions {
	const pathsById = <Entry extends { readonly id: string }>(
		entries: readonly (Entry & { readonly path: string })[],
	) => new Map(entries.map((entry) => [entry.id, entry.path]))
	const axisPaths = pathsById(files["axes/index.json"] as AxisIndexFile)
	const masterPaths = pathsById(
		(files["masters/index.json"] as MasterIndexFile).entries,
	)
	const instancePaths = pathsById(
		files["instances/index.json"] as InstanceIndexFile,
	)
	const glyphPaths = pathsById(files["glyphs/index.json"] as GlyphIndexFile)
	const cmapPaths = new Map(
		(files["cmap/index.json"] as CmapIndexFile).map((entry) => [
			entry.codePoint,
			entry.path,
		]),
	)
	return {
		axisPath: (axis) => axisPaths.get(axis.id) ?? ``,
		masterPath: (master) => masterPaths.get(master.id) ?? ``,
		instancePath: (instance) => instancePaths.get(instance.id) ?? ``,
		glyphPath: (glyph) => glyphPaths.get(glyph.id) ?? ``,
		cmapPath: (entry) => cmapPaths.get(entry.codePoint) ?? ``,
	}
}

function createPersistence(
	client: TrigraphRpcClient,
	snapshots: readonly SourceUnitSnapshot[],
) {
	const sourceUnits = new Map(
		snapshots.map((snapshot) => [snapshot.path, snapshot]),
	)
	const options = pathOptions(
		Object.fromEntries(
			snapshots.map((snapshot) => [snapshot.path, snapshot.value]),
		),
	)
	let queue = Promise.resolve()

	return (source: EditorFontSource): Promise<void> => {
		queue = queue.then(async () => {
			const split = splitEditorFontSource(source, options)
			if (!split.ok) throw new Error(split.errors[0].message)
			const writes: SourceUnitWrite[] = []
			for (const [path, value] of Object.entries(split.value)) {
				const current = sourceUnits.get(path)
				if (
					current !== undefined &&
					JSON.stringify(current.value) === JSON.stringify(value)
				) {
					continue
				}
				writes.push({
					expectedRevision: current?.revision ?? null,
					path,
					value: value as JsonValue,
				})
			}
			if (writes.length === 0) return
			const result = assertData(
				await client.api.source.units.put({
					idempotencyKey: crypto.randomUUID(),
					writes: writes as [SourceUnitWrite, ...SourceUnitWrite[]],
				}),
				`Write font source`,
			)
			if (`code` in result) throw new Error(`The font source write failed.`)
			for (const snapshot of result.units) {
				sourceUnits.set(snapshot.path, snapshot)
			}
		})
		return queue.catch((error: unknown) => {
			console.error(`Unable to save font source.`, error)
			throw error
		})
	}
}

async function start() {
	const client = createTrigraphRpcClient(location.origin)
	const snapshots = await loadSourceUnits(client)
	const files = Object.fromEntries(
		snapshots.map((snapshot) => [snapshot.path, snapshot.value]),
	)
	const assembled = assembleEditorFontSource(files)
	if (!assembled.ok) throw new Error(assembled.errors[0].message)
	document.title = `Trigraph — ${assembled.value.names.family}`
	applicationMount.replaceChildren()
	render(
		<EditorApplicationRoot
			source={assembled.value}
			onSourceChange={createPersistence(client, snapshots)}
		/>,
		applicationMount,
	)
}

applicationMount.textContent = `Loading font source…`
await start().catch((error: unknown) => {
	applicationMount.textContent =
		error instanceof Error ? error.message : String(error)
	throw error
})
