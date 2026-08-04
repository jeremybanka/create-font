import { createHash } from "node:crypto"
import {
	access,
	mkdir,
	mkdtemp,
	readFile,
	rename,
	symlink,
	writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { describe, expect, test } from "vitest"

import {
	SourceAssetConflictError,
	SourceAssetIntegrityError,
	SourceAssetNotFoundError,
	SourceAssetStageNotFoundError,
	SourceAssetTooLargeError,
	type JsonValue,
	type SourceAssetDescriptor,
	type SourceChangedEvent,
} from "../src/index.ts"
import {
	createFileSystemSourceService,
	type JsonSourceWorkspaceCodec,
} from "../src/node.ts"

type AssetIndex = Readonly<{
	entries: readonly SourceAssetDescriptor[]
}>

const assetCodec: JsonSourceWorkspaceCodec<`json`> = {
	assets: {
		descriptors(files) {
			const index = files[`assets/index.json`] as AssetIndex | undefined
			return index === undefined
				? {
						ok: false,
						errors: [
							{
								code: `asset.index_required`,
								message: `assets/index.json is required.`,
								path: `$`,
							},
						],
					}
				: { ok: true, value: index.entries }
		},
		isPath(path) {
			return path.startsWith(`assets/`) && path !== `assets/index.json`
		},
	},
	assemble(files) {
		return files[`project.json`] === undefined
			? {
					ok: false,
					errors: [
						{
							code: `project.required`,
							message: `project.json is required.`,
							path: `$`,
						},
					],
				}
			: { ok: true, value: files }
	},
	format(_kind, value) {
		return { ok: true, value: `${JSON.stringify(value)}\n` }
	},
	kindForPath(path) {
		return path.endsWith(`.json`) ? `json` : null
	},
	parse(_kind, text, path) {
		try {
			return { ok: true, value: JSON.parse(text) as JsonValue }
		} catch {
			return {
				ok: false,
				errors: [
					{
						code: `json.syntax`,
						message: `Invalid JSON.`,
						path: `$`,
						unitPath: path,
					},
				],
			}
		}
	},
}

function digest(bytes: Uint8Array) {
	return `sha256:${createHash(`sha256`).update(bytes).digest(`hex`)}` as const
}

function descriptor(
	bytes: Uint8Array,
	path = `assets/image.bin`,
): SourceAssetDescriptor {
	return {
		byteLength: bytes.byteLength,
		digest: digest(bytes),
		id: `asset:image`,
		mediaType: `application/octet-stream`,
		path,
	}
}

async function assetWorkspace(
	options: Readonly<{
		assetStagingTtlMs?: number
		maximumAssetBytes?: number
		maximumProjectAssetBytes?: number
	}> = {},
) {
	const root = await mkdtemp(join(tmpdir(), `source-rpc-assets-`))
	await mkdir(join(root, `assets`))
	await writeFile(join(root, `project.json`), `{"name":"test"}\n`)
	await writeFile(join(root, `assets/index.json`), `{"entries":[]}\n`)
	return {
		root,
		service: await createFileSystemSourceService(root, assetCodec, options),
	}
}

async function bytesFrom(stream: ReadableStream<Uint8Array>) {
	const chunks: Uint8Array[] = []
	let length = 0
	for await (const chunk of stream) {
		chunks.push(chunk)
		length += chunk.byteLength
	}
	const result = new Uint8Array(length)
	let offset = 0
	for (const chunk of chunks) {
		result.set(chunk, offset)
		offset += chunk.byteLength
	}
	return result
}

async function expectStageRemoved(root: string, stagingToken: string) {
	await expect(
		access(join(root, `.create-art`, `asset-staging`, stagingToken)),
	).rejects.toMatchObject({ code: `ENOENT` })
}

describe(`filesystem source assets`, () => {
	test(`streams byte-identical content and publishes it with JSON references`, async () => {
		const { root, service } = await assetWorkspace()
		const events: SourceChangedEvent[] = []
		service.subscribe?.((event) => events.push(event))
		const before = await service.readSnapshot()
		const index = before.units.find((unit) => unit.path === `assets/index.json`)
		if (index === undefined) throw new Error(`Missing asset index.`)
		const bytes = new Uint8Array([0, 255, 13, 10, 128, 1, 2, 3])
		const asset = descriptor(bytes)
		const staged = await service.stageAsset({
			bytes: (async function* () {
				yield bytes.subarray(0, 3)
				yield bytes.subarray(3)
			})(),
			descriptor: asset,
			operationId: `create-asset`,
		})

		await expect(service.readAsset(asset.path)).rejects.toBeInstanceOf(
			SourceAssetNotFoundError,
		)
		expect(
			JSON.parse(await readFile(join(root, `assets/index.json`), `utf8`)),
		).toEqual({ entries: [] })

		const result = await service.writeAssets({
			assetWrites: [
				{ expectedDigest: null, stagingToken: staged.stagingToken },
			],
			idempotencyKey: `create-asset`,
			writes: [
				{
					expectedRevision: index.revision,
					path: index.path,
					value: { entries: [asset] },
				},
				{
					expectedRevision: null,
					path: `placements/one.json`,
					value: { assetId: asset.id },
				},
				{
					expectedRevision: null,
					path: `placements/two.json`,
					value: { assetId: asset.id },
				},
			],
		})

		expect(result.assets).toEqual([asset])
		expect((await service.readSnapshot()).assets).toEqual([asset])
		const content = await service.readAsset(asset.path)
		expect(content.descriptor).toEqual(asset)
		expect(await bytesFrom(content.bytes)).toEqual(bytes)
		expect(events).toHaveLength(1)
		expect(events[0]).toMatchObject({
			assets: [asset],
			operationId: `create-asset`,
			removedPaths: [],
		})
		expect(events[0]?.units.map(({ path }) => path).toSorted()).toEqual([
			`assets/index.json`,
			`placements/one.json`,
			`placements/two.json`,
		])
		await expectStageRemoved(root, staged.stagingToken)
	})

	test(`rejects oversized, mismatched, unsafe, and interrupted uploads`, async () => {
		const { root, service } = await assetWorkspace({
			maximumAssetBytes: 4,
			maximumProjectAssetBytes: 6,
		})
		let consumed = false
		await expect(
			service.stageAsset({
				bytes: (async function* () {
					consumed = true
					yield new Uint8Array(5)
				})(),
				descriptor: descriptor(new Uint8Array(5)),
				operationId: `too-large`,
			}),
		).rejects.toBeInstanceOf(SourceAssetTooLargeError)
		expect(consumed).toBe(false)

		const stagedBytes = new Uint8Array([1, 2, 3, 4])
		const withinLimit = await service.stageAsset({
			bytes: (async function* () {
				yield stagedBytes
			})(),
			descriptor: descriptor(stagedBytes, `assets/first.bin`),
			operationId: `within-project-limit`,
		})
		let projectOverflowConsumed = false
		const overflowBytes = new Uint8Array([5, 6, 7])
		await expect(
			service.stageAsset({
				bytes: (async function* () {
					projectOverflowConsumed = true
					yield overflowBytes
				})(),
				descriptor: descriptor(overflowBytes, `assets/second.bin`),
				operationId: `project-too-large`,
			}),
		).rejects.toBeInstanceOf(SourceAssetTooLargeError)
		expect(projectOverflowConsumed).toBe(false)
		await service.discardAssetStage(withinLimit.stagingToken)

		const expected = new Uint8Array([1, 2, 3])
		await expect(
			service.stageAsset({
				bytes: (async function* () {
					yield new Uint8Array([1, 2, 4])
				})(),
				descriptor: descriptor(expected),
				operationId: `mismatch`,
			}),
		).rejects.toBeInstanceOf(SourceAssetIntegrityError)
		await expect(
			service.stageAsset({
				bytes: (async function* () {
					yield new Uint8Array([1])
					throw new Error(`connection interrupted`)
				})(),
				descriptor: descriptor(expected),
				operationId: `interrupted`,
			}),
		).rejects.toThrow(`connection interrupted`)
		await expect(
			service.stageAsset({
				bytes: (async function* () {
					yield expected
				})(),
				descriptor: descriptor(expected, `../outside.bin`),
				operationId: `traversal`,
			}),
		).rejects.toBeInstanceOf(SourceAssetNotFoundError)
		await expect(
			readFile(join(root, `assets/image.bin`)),
		).rejects.toMatchObject({ code: `ENOENT` })
	})

	test(`uses digest conditions and never exposes failed replacements`, async () => {
		const { root, service } = await assetWorkspace()
		const firstBytes = new Uint8Array([1, 2, 3])
		const first = descriptor(firstBytes)
		const initial = await service.readSnapshot()
		const initialIndex = initial.units.find(
			(unit) => unit.path === `assets/index.json`,
		)
		if (initialIndex === undefined) throw new Error(`Missing asset index.`)
		const firstStage = await service.stageAsset({
			bytes: (async function* () {
				yield firstBytes
			})(),
			descriptor: first,
			operationId: `first`,
		})
		const created = await service.writeAssets({
			assetWrites: [
				{ expectedDigest: null, stagingToken: firstStage.stagingToken },
			],
			idempotencyKey: `first`,
			writes: [
				{
					expectedRevision: initialIndex.revision,
					path: initialIndex.path,
					value: { entries: [first] },
				},
			],
		})
		const nextIndex = created.units[0]
		if (nextIndex === undefined) throw new Error(`Missing updated index.`)

		const secondBytes = new Uint8Array([9, 8, 7, 6])
		const second = descriptor(secondBytes)
		const secondStage = await service.stageAsset({
			bytes: (async function* () {
				yield secondBytes
			})(),
			descriptor: second,
			operationId: `replace`,
		})
		await expect(
			service.writeAssets({
				assetWrites: [
					{
						expectedDigest: digest(new Uint8Array([0])),
						stagingToken: secondStage.stagingToken,
					},
				],
				idempotencyKey: `replace`,
				writes: [
					{
						expectedRevision: nextIndex.revision,
						path: nextIndex.path,
						value: { entries: [second] },
					},
				],
			}),
		).rejects.toBeInstanceOf(SourceAssetConflictError)
		await expectStageRemoved(root, secondStage.stagingToken)
		expect(
			await bytesFrom((await service.readAsset(first.path)).bytes),
		).toEqual(firstBytes)
		const retryStage = await service.stageAsset({
			bytes: (async function* () {
				yield secondBytes
			})(),
			descriptor: second,
			operationId: `replace`,
		})
		const openRead = await service.readAsset(first.path)
		const replaced = await service.writeAssets({
			assetWrites: [
				{
					expectedDigest: first.digest,
					stagingToken: retryStage.stagingToken,
				},
			],
			idempotencyKey: `replace`,
			writes: [
				{
					expectedRevision: nextIndex.revision,
					path: nextIndex.path,
					value: { entries: [second] },
				},
			],
		})
		expect(
			await bytesFrom((await service.readAsset(second.path)).bytes),
		).toEqual(secondBytes)
		expect(openRead.descriptor).toEqual(first)
		expect(await bytesFrom(openRead.bytes)).toEqual(firstBytes)
		const replacedIndex = replaced.units[0]
		if (replacedIndex === undefined) throw new Error(`Missing replaced index.`)
		await service.writeAssets({
			assetRemovals: [{ expectedDigest: second.digest, path: second.path }],
			assetWrites: [],
			idempotencyKey: `remove`,
			writes: [
				{
					expectedRevision: replacedIndex.revision,
					path: replacedIndex.path,
					value: { entries: [] },
				},
			],
		})
		await expect(service.readAsset(second.path)).rejects.toBeInstanceOf(
			SourceAssetNotFoundError,
		)
	})

	test(`cleans rejected operation stages without touching unrelated uploads`, async () => {
		const { root, service } = await assetWorkspace()
		const ownedBytes = new Uint8Array([1, 2, 3])
		const unrelatedBytes = new Uint8Array([4, 5, 6])
		const owned = await service.stageAsset({
			bytes: (async function* () {
				yield ownedBytes
			})(),
			descriptor: descriptor(ownedBytes, `assets/owned.bin`),
			operationId: `owned-operation`,
		})
		const unrelated = await service.stageAsset({
			bytes: (async function* () {
				yield unrelatedBytes
			})(),
			descriptor: descriptor(unrelatedBytes, `assets/unrelated.bin`),
			operationId: `unrelated-operation`,
		})

		await expect(
			service.writeAssets({
				assetWrites: [
					{ expectedDigest: null, stagingToken: owned.stagingToken },
				],
				idempotencyKey: `different-operation`,
			}),
		).rejects.toThrow(`transaction identity`)
		await expectStageRemoved(root, owned.stagingToken)
		await expect(
			access(
				join(root, `.create-art`, `asset-staging`, unrelated.stagingToken),
			),
		).resolves.toBeUndefined()
		await service.discardAssetStage(unrelated.stagingToken)
		await expectStageRemoved(root, unrelated.stagingToken)
	})

	test(`expires abandoned stages without touching canonical assets`, async () => {
		const { service } = await assetWorkspace({ assetStagingTtlMs: 1 })
		const bytes = new Uint8Array([1])
		const staged = await service.stageAsset({
			bytes: (async function* () {
				yield bytes
			})(),
			descriptor: descriptor(bytes),
			operationId: `abandoned`,
		})
		await new Promise((resolve) => setTimeout(resolve, 5))
		expect(await service.collectExpiredAssetStages()).toBe(1)
		await expect(
			service.writeAssets({
				assetWrites: [
					{
						expectedDigest: null,
						stagingToken: staged.stagingToken,
					},
				],
				idempotencyKey: `abandoned`,
			}),
		).rejects.toBeInstanceOf(SourceAssetStageNotFoundError)
		await expect(service.readAsset(`assets/image.bin`)).rejects.toBeInstanceOf(
			SourceAssetNotFoundError,
		)
	})

	test(`rejects symbolic links in canonical asset paths`, async () => {
		const { root } = await assetWorkspace()
		const bytes = new Uint8Array([1, 2, 3])
		const asset = descriptor(bytes)
		const outside = join(root, `outside.bin`)
		await writeFile(outside, bytes)
		await symlink(outside, join(root, asset.path))
		await writeFile(
			join(root, `assets/index.json`),
			`${JSON.stringify({ entries: [asset] })}\n`,
		)
		await expect(
			createFileSystemSourceService(root, assetCodec),
		).rejects.toThrow(`symbolic links`)
	})

	test(`rolls interrupted binary publication back on startup`, async () => {
		const { root } = await assetWorkspace()
		const bytes = new Uint8Array([1, 2, 3])
		const asset = descriptor(bytes)
		await writeFile(join(root, asset.path), bytes)
		await writeFile(
			join(root, `assets/index.json`),
			`${JSON.stringify({ entries: [asset] })}\n`,
		)
		await createFileSystemSourceService(root, assetCodec)
		const transaction = join(
			root,
			`.create-art`,
			`transactions`,
			`interrupted-asset`,
		)
		const backup = join(transaction, `backup`, asset.path)
		await mkdir(join(transaction, `backup`, `assets`), {
			recursive: true,
		})
		await rename(join(root, asset.path), backup)
		await writeFile(join(root, asset.path), new Uint8Array([9]))
		await writeFile(
			join(transaction, `transaction.json`),
			`${JSON.stringify({
				entries: [{ existed: true, kind: `asset`, path: asset.path }],
			})}\n`,
		)
		const recovered = await createFileSystemSourceService(root, assetCodec)
		expect(
			await bytesFrom((await recovered.readAsset(asset.path)).bytes),
		).toEqual(bytes)
	})

	test(`emits a narrow event for an external byte replacement`, async () => {
		const { root, service } = await assetWorkspace()
		const firstBytes = new Uint8Array([1, 2, 3])
		const first = descriptor(firstBytes)
		await writeFile(join(root, first.path), firstBytes)
		await writeFile(
			join(root, `assets/index.json`),
			`${JSON.stringify({ entries: [first] })}\n`,
		)
		const loaded = await createFileSystemSourceService(root, assetCodec)
		const event = new Promise<SourceChangedEvent>((resolve) => {
			const unsubscribe = loaded.subscribe?.((change) => {
				unsubscribe?.()
				resolve(change)
			})
		})
		const replacement = new Uint8Array([3, 2, 1])
		await writeFile(join(root, first.path), replacement)
		await expect(event).resolves.toMatchObject({
			assets: [
				{
					digest: digest(replacement),
					path: first.path,
				},
			],
			removedPaths: [],
			units: [],
		})
	})
})
