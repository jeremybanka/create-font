import type {
	SourceAssetContent,
	SourceAssetDescriptor,
	SourceAssetDigest,
	StagedSourceAsset,
	WriteSourceAssetsInput,
	WriteSourceAssetsResult,
} from "./assets.ts"
import type {
	CommitSourceUnitsInput,
	CommitSourceUnitsResult,
	ReadSourceComparisonInput,
	SourceComparison,
	SourceProjectSnapshot,
	WriteSourceUnitsInput,
	WriteSourceUnitsResult,
} from "./contracts.ts"

async function responseJson<Value>(response: Response): Promise<Value> {
	const value = (await response.json()) as Value | { message?: string }
	if (!response.ok) {
		const errorValue = value as { message?: unknown }
		throw new Error(
			typeof errorValue.message === `string`
				? errorValue.message
				: `Source RPC request failed with ${response.status}.`,
		)
	}
	return value as Value
}

export function createSourceRpcClient(origin = ``) {
	const base = origin.replace(/\/$/, ``)
	return {
		commitUnits: (input: CommitSourceUnitsInput) =>
			fetch(`${base}/api/source/commit`, {
				body: JSON.stringify(input),
				headers: { "content-type": `application/json` },
				method: `POST`,
			}).then((response) => responseJson<CommitSourceUnitsResult>(response)),
		discardAssetStage: (stagingToken: string) =>
			fetch(
				`${base}/api/source/asset/stage?${new URLSearchParams({
					stagingToken,
				})}`,
				{ method: `DELETE` },
			).then((response) =>
				responseJson<Readonly<{ discarded: true }>>(response),
			),
		readAsset: async (path: string): Promise<SourceAssetContent> => {
			const response = await fetch(
				`${base}/api/source/asset?${new URLSearchParams({ path })}`,
			)
			if (!response.ok) {
				await responseJson<never>(response)
				throw new Error(`Unreachable source asset response.`)
			}
			const bytes = response.body
			const id = response.headers.get(`x-source-asset-id`)
			const digest = response.headers.get(`x-source-asset-digest`)
			const mediaType = response.headers.get(`content-type`)
			const byteLength = Number(response.headers.get(`content-length`))
			if (
				bytes === null ||
				id === null ||
				digest === null ||
				mediaType === null ||
				!Number.isSafeInteger(byteLength)
			) {
				throw new Error(`Source RPC returned invalid asset metadata.`)
			}
			return {
				bytes,
				descriptor: {
					byteLength,
					digest: digest as SourceAssetDigest,
					id: decodeURIComponent(id),
					mediaType,
					path,
				},
			}
		},
		readComparison: (input: ReadSourceComparisonInput) => {
			const query = new URLSearchParams({ baseRef: input.baseRef })
			if (input.targetRef !== undefined) query.set(`targetRef`, input.targetRef)
			return fetch(`${base}/api/source/comparison?${query}`).then((response) =>
				responseJson<SourceComparison>(response),
			)
		},
		readSnapshot: () =>
			fetch(`${base}/api/source/snapshot`).then((response) =>
				responseJson<SourceProjectSnapshot>(response),
			),
		stageAsset: (
			operationId: string,
			descriptor: SourceAssetDescriptor,
			bytes: BodyInit,
		) =>
			fetch(
				`${base}/api/source/asset/stage?${new URLSearchParams({
					byteLength: String(descriptor.byteLength),
					digest: descriptor.digest,
					id: descriptor.id,
					mediaType: descriptor.mediaType,
					operationId,
					path: descriptor.path,
				})}`,
				{
					body: bytes,
					duplex: `half`,
					headers: {
						"content-type": `application/vnd.create-art.source-asset`,
					},
					method: `PUT`,
				} as RequestInit & { duplex: `half` },
			).then((response) => responseJson<StagedSourceAsset>(response)),
		writeAssets: (input: WriteSourceAssetsInput) =>
			fetch(`${base}/api/source/assets`, {
				body: JSON.stringify(input),
				headers: { "content-type": `application/json` },
				method: `PUT`,
			}).then((response) => responseJson<WriteSourceAssetsResult>(response)),
		writeUnits: (input: WriteSourceUnitsInput) =>
			fetch(`${base}/api/source/units`, {
				body: JSON.stringify(input),
				headers: { "content-type": `application/json` },
				method: `PUT`,
			}).then((response) => responseJson<WriteSourceUnitsResult>(response)),
	}
}
