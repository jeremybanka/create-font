import { Elysia, status, t } from "elysia"
import type { ElysiaAdapter } from "elysia/adapter"

import {
	SourceAssetConflictError,
	SourceAssetIntegrityError,
	SourceAssetNotFoundError,
	SourceAssetStageNotFoundError,
	SourceAssetTooLargeError,
	type SourceAssetConflict,
	type SourceAssetDigest,
	type SourceAssetNotFound,
	type SourceAssetService,
	type SourceAssetStageNotFound,
	type SourceAssetTooLarge,
	type WriteSourceAssetsInput,
} from "./assets.ts"
import {
	SourceUnitConflictError,
	SourceUnitNotFoundError,
	SourceValidationError,
	type SourceInvalidRequest,
	type SourceService,
	type SourceUnitConflict,
	type SourceUnitNotFound,
	type SourceValidationFailure,
	type SourceVersionControlService,
	type WriteSourceUnitInput,
	type WriteSourceUnitsInput,
} from "./contracts.ts"
import { createSourceVersionControlRpc } from "./version-control-server.ts"

export { createSourceVersionControlRpc } from "./version-control-server.ts"

export type SourceRpcOptions = Readonly<{
	adapter?: ElysiaAdapter
	assets?: SourceAssetService
	/** Unique plugin identity when several source sessions share one server. */
	name?: string
	source?: SourceService
	unavailableMessage?: string
	versionControl?: SourceVersionControlService
}>

export function sourceErrorResponse(error: unknown) {
	if (error instanceof SourceAssetNotFoundError) {
		const body: SourceAssetNotFound = {
			code: `source.asset_not_found`,
			message: error.message,
			path: error.path,
		}
		return status(404, body)
	}
	if (error instanceof SourceAssetConflictError) {
		const body: SourceAssetConflict = {
			actualDigest: error.actualDigest,
			code: `source.asset_conflict`,
			expectedDigest: error.expectedDigest,
			message: error.message,
			path: error.path,
		}
		return status(409, body)
	}
	if (error instanceof SourceAssetStageNotFoundError) {
		const body: SourceAssetStageNotFound = {
			code: `source.asset_stage_not_found`,
			message: error.message,
			stagingToken: error.stagingToken,
		}
		return status(410, body)
	}
	if (error instanceof SourceAssetTooLargeError) {
		const body: SourceAssetTooLarge = {
			code: `source.asset_too_large`,
			limit: error.limit,
			message: error.message,
		}
		return status(413, body)
	}
	if (error instanceof SourceAssetIntegrityError) {
		const body: SourceInvalidRequest = {
			code: `source.invalid_request`,
			message: error.message,
		}
		return status(422, body)
	}
	if (error instanceof SourceUnitNotFoundError) {
		const body: SourceUnitNotFound = {
			code: `source.unit_not_found`,
			message: error.message,
			path: error.path,
		}
		return status(404, body)
	}
	if (error instanceof SourceUnitConflictError) {
		const body: SourceUnitConflict = {
			actualRevision: error.actualRevision,
			code: `source.revision_conflict`,
			expectedRevision: error.expectedRevision,
			message: error.message,
			path: error.path,
		}
		return status(409, body)
	}
	if (error instanceof SourceValidationError) {
		const body: SourceValidationFailure = {
			code: `source.validation_failed`,
			issues: error.issues,
			message: error.message,
		}
		return status(422, body)
	}
	throw error
}

export function createSourceRpc(options: SourceRpcOptions) {
	const sourceConnections = new WeakMap<object, () => void>()
	const unavailable = {
		code: `source.not_ready` as const,
		message:
			options.unavailableMessage ??
			`The source workspace service has not been configured yet.`,
	}
	const assetDescriptorSchema = t.Object({
		id: t.String({ minLength: 1 }),
		path: t.String({ minLength: 1 }),
		mediaType: t.String({ minLength: 1 }),
		byteLength: t.Number({ minimum: 0 }),
		digest: t.String({ minLength: 1 }),
	})
	return new Elysia({
		...(options.adapter === undefined ? {} : { adapter: options.adapter }),
		name: options.name ?? `create-art-source-rpc`,
	})
		.ws(`/source/events`, {
			open(ws) {
				if (options.source?.subscribe === undefined) {
					ws.close()
					return
				}
				sourceConnections.set(
					ws.raw,
					options.source.subscribe((event) =>
						ws.send({
							...(event.assets === undefined
								? {}
								: {
										assets: event.assets.map((asset) => ({
											...asset,
										})),
									}),
							...(event.operationId === undefined
								? {}
								: { operationId: event.operationId }),
							previousRevision: event.previousRevision,
							...(event.removedAssetPaths === undefined
								? {}
								: {
										removedAssetPaths: [...event.removedAssetPaths],
									}),
							removedPaths: [...event.removedPaths],
							revision: event.revision,
							type: event.type,
							units: event.units.map((unit) => ({ ...unit })),
						}),
					),
				)
			},
			close(ws) {
				sourceConnections.get(ws.raw)?.()
				sourceConnections.delete(ws.raw)
			},
			response: t.Object({
				assets: t.Optional(t.Array(assetDescriptorSchema)),
				type: t.Literal(`source.changed`),
				operationId: t.Optional(t.String()),
				previousRevision: t.String(),
				removedAssetPaths: t.Optional(t.Array(t.String())),
				removedPaths: t.Array(t.String()),
				revision: t.String(),
				units: t.Array(
					t.Object({
						path: t.String(),
						revision: t.String(),
						value: t.Any(),
					}),
				),
			}),
		})
		.get(
			`/source/asset`,
			async ({ query }) => {
				if (options.assets === undefined) return status(501, unavailable)
				try {
					const { bytes, descriptor } = await options.assets.readAsset(
						query.path,
					)
					return new Response(bytes, {
						headers: {
							"content-length": String(descriptor.byteLength),
							"content-type": descriptor.mediaType,
							etag: `"${descriptor.digest}"`,
							"x-source-asset-digest": descriptor.digest,
							"x-source-asset-id": encodeURIComponent(descriptor.id),
						},
					})
				} catch (error) {
					return sourceErrorResponse(error)
				}
			},
			{ query: t.Object({ path: t.String({ minLength: 1 }) }) },
		)
		.put(
			`/source/asset/stage`,
			async ({ query, request }) => {
				if (options.assets === undefined) return status(501, unavailable)
				const byteLength = Number(query.byteLength)
				const contentLength = request.headers.get(`content-length`)
				if (
					!Number.isSafeInteger(byteLength) ||
					byteLength < 0 ||
					(contentLength !== null && Number(contentLength) !== byteLength)
				) {
					const invalid: SourceInvalidRequest = {
						code: `source.invalid_request`,
						message: `The declared and HTTP content lengths must match.`,
					}
					return status(422, invalid)
				}
				if (request.body === null && byteLength !== 0) {
					const invalid: SourceInvalidRequest = {
						code: `source.invalid_request`,
						message: `An asset upload body is required.`,
					}
					return status(422, invalid)
				}
				try {
					return await options.assets.stageAsset({
						bytes:
							request.body ??
							new ReadableStream<Uint8Array>({
								start(controller) {
									controller.close()
								},
							}),
						descriptor: {
							byteLength,
							digest: query.digest as SourceAssetDigest,
							id: query.id,
							mediaType: query.mediaType,
							path: query.path,
						},
						operationId: query.operationId,
					})
				} catch (error) {
					return sourceErrorResponse(error)
				}
			},
			{
				parse: `none`,
				query: t.Object({
					byteLength: t.String({ minLength: 1 }),
					digest: t.String({ minLength: 1 }),
					id: t.String({ minLength: 1 }),
					mediaType: t.String({ minLength: 1 }),
					operationId: t.String({ minLength: 1 }),
					path: t.String({ minLength: 1 }),
				}),
			},
		)
		.delete(
			`/source/asset/stage`,
			async ({ query }) => {
				if (options.assets === undefined) return status(501, unavailable)
				try {
					await options.assets.discardAssetStage(query.stagingToken)
					return { discarded: true as const }
				} catch (error) {
					return sourceErrorResponse(error)
				}
			},
			{
				query: t.Object({
					stagingToken: t.String({ minLength: 1 }),
				}),
			},
		)
		.get(`/source`, async () => {
			if (options.source === undefined) return status(501, unavailable)
			try {
				return await options.source.readManifest()
			} catch (error) {
				return sourceErrorResponse(error)
			}
		})
		.get(`/source/snapshot`, async () => {
			if (options.source === undefined) return status(501, unavailable)
			try {
				return await options.source.readSnapshot()
			} catch (error) {
				return sourceErrorResponse(error)
			}
		})
		.use(
			createSourceVersionControlRpc(
				options.versionControl === undefined
					? {
							name: `${options.name ?? "create-art-source-rpc"}:version-control`,
						}
					: {
							name: `${options.name ?? "create-art-source-rpc"}:version-control`,
							service: options.versionControl,
						},
			),
		)
		.get(
			`/source/unit`,
			async ({ query }) => {
				if (options.source === undefined) return status(501, unavailable)
				try {
					return await options.source.readUnit(query.path)
				} catch (error) {
					return sourceErrorResponse(error)
				}
			},
			{ query: t.Object({ path: t.String({ minLength: 1 }) }) },
		)
		.put(
			`/source/unit`,
			async ({ body }) => {
				if (
					body.expectedRevision !== null &&
					typeof body.expectedRevision !== `string`
				) {
					const invalid: SourceInvalidRequest = {
						code: `source.invalid_request`,
						message: `expectedRevision must be a string or null.`,
					}
					return status(422, invalid)
				}
				if (options.source === undefined) return status(501, unavailable)
				try {
					return await options.source.writeUnit(body as WriteSourceUnitInput)
				} catch (error) {
					return sourceErrorResponse(error)
				}
			},
			{
				body: t.Object({
					expectedRevision: t.Any(),
					idempotencyKey: t.String({ minLength: 1 }),
					path: t.String({ minLength: 1 }),
					value: t.Any(),
				}),
			},
		)
		.put(
			`/source/assets`,
			async ({ body }) => {
				const writes = body.writes ?? []
				const removals = body.removals ?? []
				const assetRemovals = body.assetRemovals ?? []
				if (
					writes.length +
						removals.length +
						body.assetWrites.length +
						assetRemovals.length ===
						0 ||
					writes.some(
						(write) =>
							write.expectedRevision !== null &&
							typeof write.expectedRevision !== `string`,
					) ||
					body.assetWrites.some(
						(write) =>
							write.expectedDigest !== null &&
							typeof write.expectedDigest !== `string`,
					)
				) {
					const invalid: SourceInvalidRequest = {
						code: `source.invalid_request`,
						message: `An asset transaction needs at least one valid change.`,
					}
					return status(422, invalid)
				}
				if (options.assets === undefined) return status(501, unavailable)
				try {
					return await options.assets.writeAssets({
						...body,
						assetRemovals,
						removals,
						writes,
					} as WriteSourceAssetsInput)
				} catch (error) {
					return sourceErrorResponse(error)
				}
			},
			{
				body: t.Object({
					assetRemovals: t.Optional(
						t.Array(
							t.Object({
								expectedDigest: t.String({ minLength: 1 }),
								path: t.String({ minLength: 1 }),
							}),
						),
					),
					assetWrites: t.Array(
						t.Object({
							expectedDigest: t.Any(),
							stagingToken: t.String({ minLength: 1 }),
						}),
					),
					idempotencyKey: t.String({ minLength: 1 }),
					removals: t.Optional(
						t.Array(
							t.Object({
								expectedRevision: t.String({ minLength: 1 }),
								path: t.String({ minLength: 1 }),
							}),
						),
					),
					writes: t.Optional(
						t.Array(
							t.Object({
								expectedRevision: t.Any(),
								path: t.String({ minLength: 1 }),
								value: t.Any(),
							}),
						),
					),
				}),
				transform({ body }) {
					body.assetRemovals ??= []
					body.removals ??= []
					body.writes ??= []
				},
			},
		)
		.put(
			`/source/units`,
			async ({ body }) => {
				const removals = body.removals ?? []
				if (
					body.writes.length + removals.length === 0 ||
					body.writes.some(
						(write) =>
							write.expectedRevision !== null &&
							typeof write.expectedRevision !== `string`,
					)
				) {
					const invalid: SourceInvalidRequest = {
						code: `source.invalid_request`,
						message: `A transaction needs at least one valid write or removal.`,
					}
					return status(422, invalid)
				}
				if (options.source === undefined) return status(501, unavailable)
				try {
					return await options.source.writeUnits({
						...body,
						removals,
					} as WriteSourceUnitsInput)
				} catch (error) {
					return sourceErrorResponse(error)
				}
			},
			{
				body: t.Object({
					idempotencyKey: t.String({ minLength: 1 }),
					removals: t.Optional(
						t.Array(
							t.Object({
								expectedRevision: t.String({ minLength: 1 }),
								path: t.String({ minLength: 1 }),
							}),
						),
					),
					writes: t.Array(
						t.Object({
							expectedRevision: t.Any(),
							path: t.String({ minLength: 1 }),
							value: t.Any(),
						}),
					),
				}),
				transform({ body }) {
					body.removals ??= []
				},
			},
		)
}
