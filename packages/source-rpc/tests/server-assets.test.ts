import { createHash } from "node:crypto"

import { describe, expect, test } from "vitest"

import type {
	SourceAssetDescriptor,
	SourceAssetService,
	SourceService,
} from "../src/index.ts"
import { createSourceRpc } from "../src/server.ts"

function descriptor(bytes: Uint8Array): SourceAssetDescriptor {
	return {
		byteLength: bytes.byteLength,
		digest: `sha256:${createHash(`sha256`).update(bytes).digest(`hex`)}`,
		id: `asset:test`,
		mediaType: `application/octet-stream`,
		path: `assets/test.bin`,
	}
}

function assetService(
	asset: SourceAssetDescriptor,
	captured: Uint8Array[],
): SourceAssetService {
	return {
		async collectExpiredAssetStages() {
			return 0
		},
		async discardAssetStage() {},
		async readAsset() {
			return {
				bytes: new ReadableStream({
					start(controller) {
						controller.enqueue(new Uint8Array([0, 255, 1]))
						controller.close()
					},
				}),
				descriptor: asset,
			}
		},
		async stageAsset(input) {
			for await (const chunk of input.bytes) captured.push(chunk)
			return {
				descriptor: input.descriptor,
				expiresAt: new Date(Date.now() + 60_000).toISOString(),
				operationId: input.operationId,
				stagingToken: `token`,
			}
		},
		async writeAssets(input) {
			return {
				assets: [asset],
				previousRevision: `before`,
				removedAssetPaths: [],
				removedPaths: [],
				revision: `after`,
				units: [],
			}
		},
	}
}

describe(`source asset RPC`, () => {
	test(`keeps upload and download bodies as byte streams`, async () => {
		const bytes = new Uint8Array([0, 255, 1])
		const asset = descriptor(bytes)
		const captured: Uint8Array[] = []
		const app = createSourceRpc({
			assets: assetService(asset, captured),
		})
		const query = new URLSearchParams({
			byteLength: String(asset.byteLength),
			digest: asset.digest,
			id: asset.id,
			mediaType: asset.mediaType,
			operationId: `upload`,
			path: asset.path,
		})
		const upload = await app.handle(
			new Request(`http://localhost/source/asset/stage?${query}`, {
				body: new ReadableStream({
					start(controller) {
						controller.enqueue(bytes.subarray(0, 1))
						controller.enqueue(bytes.subarray(1))
						controller.close()
					},
				}),
				duplex: `half`,
				method: `PUT`,
			} as RequestInit & { duplex: `half` }),
		)
		expect(upload.status).toBe(200)
		expect(await upload.json()).toMatchObject({
			operationId: `upload`,
			stagingToken: `token`,
		})
		expect(captured).toEqual([bytes.subarray(0, 1), bytes.subarray(1)])

		const download = await app.handle(
			new Request(
				`http://localhost/source/asset?${new URLSearchParams({
					path: asset.path,
				})}`,
			),
		)
		expect(download.headers.get(`content-length`)).toBe(`3`)
		expect(download.headers.get(`x-source-asset-digest`)).toBe(asset.digest)
		expect(new Uint8Array(await download.arrayBuffer())).toEqual(bytes)
	})

	test(`preserves JSON-only response shapes`, async () => {
		const source: SourceService = {
			async readManifest() {
				return { revision: `one`, units: [] }
			},
			async readSnapshot() {
				return { revision: `one`, units: [] }
			},
			async readUnit() {
				throw new Error(`not used`)
			},
			async writeUnit() {
				throw new Error(`not used`)
			},
			async writeUnits() {
				throw new Error(`not used`)
			},
		}
		const response = await createSourceRpc({ source }).handle(
			new Request(`http://localhost/source/snapshot`),
		)
		expect(await response.json()).toEqual({ revision: `one`, units: [] })
	})
})
