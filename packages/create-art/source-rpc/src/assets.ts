import type {
	SourceUnitRemoval,
	SourceUnitWrite,
	WriteSourceUnitsResult,
} from "./contracts.ts"

export type SourceAssetPath = string
export type SourceAssetDigest = `sha256:${string}`

/** Canonical identity and byte metadata for one source-owned binary asset. */
export type SourceAssetDescriptor = Readonly<{
	id: string
	path: SourceAssetPath
	mediaType: string
	byteLength: number
	digest: SourceAssetDigest
}>

export type SourceAssetContent = Readonly<{
	bytes: ReadableStream<Uint8Array>
	descriptor: SourceAssetDescriptor
}>

export type StageSourceAssetInput = Readonly<{
	bytes: AsyncIterable<Uint8Array> | ReadableStream<Uint8Array>
	descriptor: SourceAssetDescriptor
	operationId: string
}>

export type StagedSourceAsset = Readonly<{
	descriptor: SourceAssetDescriptor
	expiresAt: string
	operationId: string
	stagingToken: string
}>

export type SourceAssetWrite = Readonly<{
	/** `null` creates an asset; a digest conditionally replaces it. */
	expectedDigest: SourceAssetDigest | null
	stagingToken: string
}>

export type SourceAssetRemoval = Readonly<{
	expectedDigest: SourceAssetDigest
	path: SourceAssetPath
}>

export type WriteSourceAssetsInput = Readonly<{
	assetRemovals?: readonly SourceAssetRemoval[]
	assetWrites: readonly SourceAssetWrite[]
	idempotencyKey: string
	removals?: readonly SourceUnitRemoval[]
	writes?: readonly SourceUnitWrite[]
}>

export type WriteSourceAssetsResult = WriteSourceUnitsResult &
	Readonly<{
		assets: readonly SourceAssetDescriptor[]
		removedAssetPaths: readonly SourceAssetPath[]
	}>

export interface SourceAssetService {
	collectExpiredAssetStages(): Promise<number>
	discardAssetStage(stagingToken: string): Promise<void>
	readAsset(path: SourceAssetPath): Promise<SourceAssetContent>
	stageAsset(input: StageSourceAssetInput): Promise<StagedSourceAsset>
	writeAssets(input: WriteSourceAssetsInput): Promise<WriteSourceAssetsResult>
}

export type SourceAssetNotFound = Readonly<{
	code: `source.asset_not_found`
	message: string
	path: SourceAssetPath
}>

export type SourceAssetConflict = Readonly<{
	actualDigest: SourceAssetDigest | null
	code: `source.asset_conflict`
	expectedDigest: SourceAssetDigest | null
	message: string
	path: SourceAssetPath
}>

export type SourceAssetStageNotFound = Readonly<{
	code: `source.asset_stage_not_found`
	message: string
	stagingToken: string
}>

export type SourceAssetTooLarge = Readonly<{
	code: `source.asset_too_large`
	limit: number
	message: string
}>

export class SourceAssetNotFoundError extends Error {
	readonly path: SourceAssetPath

	constructor(path: SourceAssetPath) {
		super(`Source asset ${path} does not exist.`)
		this.name = `SourceAssetNotFoundError`
		this.path = path
	}
}

export class SourceAssetConflictError extends Error {
	readonly actualDigest: SourceAssetDigest | null
	readonly expectedDigest: SourceAssetDigest | null
	readonly path: SourceAssetPath

	constructor(
		path: SourceAssetPath,
		expectedDigest: SourceAssetDigest | null,
		actualDigest: SourceAssetDigest | null,
	) {
		super(`Source asset ${path} changed since it was read.`)
		this.name = `SourceAssetConflictError`
		this.actualDigest = actualDigest
		this.expectedDigest = expectedDigest
		this.path = path
	}
}

export class SourceAssetStageNotFoundError extends Error {
	readonly stagingToken: string

	constructor(stagingToken: string) {
		super(`Source asset staging token ${stagingToken} is missing or expired.`)
		this.name = `SourceAssetStageNotFoundError`
		this.stagingToken = stagingToken
	}
}

export class SourceAssetTooLargeError extends Error {
	readonly limit: number

	constructor(limit: number, message = `Source asset exceeds the byte limit.`) {
		super(message)
		this.name = `SourceAssetTooLargeError`
		this.limit = limit
	}
}

export class SourceAssetIntegrityError extends Error {
	constructor(message: string) {
		super(message)
		this.name = `SourceAssetIntegrityError`
	}
}
