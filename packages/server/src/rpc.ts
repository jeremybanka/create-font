import { resolve } from "node:path"

import { Elysia, status, t } from "elysia"
import type { ElysiaAdapter } from "elysia/adapter"

import {
	SourceUnitConflictError,
	SourceUnitNotFoundError,
	SourceValidationError,
	SourceVersionControlError,
} from "./contracts.ts"
import type {
	BuildResult,
	SourceInvalidRequest,
	SourceUnitConflict,
	SourceUnitNotFound,
	SourceServiceUnavailable,
	SourceValidationFailure,
	CreateFontSourceService,
	WriteSourceUnitInput,
	WriteSourceUnitsInput,
	CommitSourceUnitsInput,
} from "./contracts.ts"

export const CREATE_FONT_RPC_VERSION = 6 as const

export type CreateFontRpcOptions = Readonly<{
	adapter?: ElysiaAdapter
	build: () => Promise<BuildResult>
	root?: string
	source?: CreateFontSourceService
}>

const sourceServiceUnavailable: SourceServiceUnavailable = {
	code: `source.not_ready`,
	message: `The font source service has not been configured yet.`,
}

function sourceErrorResponse(error: unknown) {
	if (error instanceof SourceVersionControlError) {
		return status(
			error.code === `source.invalid_ref`
				? 422
				: error.code === `source.commit_conflict`
					? 409
					: 503,
			{ code: error.code, message: error.message },
		)
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

export function createFontRpc(options: CreateFontRpcOptions) {
	const root = resolve(options.root ?? process.cwd())
	const sourceConnections = new WeakMap<object, () => void>()

	return new Elysia({
		name: `create-font-rpc`,
		prefix: `/api`,
		...(options.adapter === undefined ? {} : { adapter: options.adapter }),
	})
		.get(`/health`, () => ({
			ok: true as const,
			rpcVersion: CREATE_FONT_RPC_VERSION,
		}))
		.get(`/workspace`, () => ({
			root,
		}))
		.post(`/build`, options.build)
		.ws(`/source/events`, {
			open(ws) {
				if (options.source?.subscribe === undefined) {
					ws.close()
					return
				}
				const unsubscribe = options.source.subscribe((event) => {
					ws.send(event)
				})
				sourceConnections.set(ws.raw, unsubscribe)
			},
			close(ws) {
				sourceConnections.get(ws.raw)?.()
				sourceConnections.delete(ws.raw)
			},
			response: t.Object({
				type: t.Literal(`source.changed`),
				operationId: t.Optional(t.String()),
				previousRevision: t.String(),
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
		.get(`/source`, async () => {
			if (options.source === undefined) {
				return status(501, sourceServiceUnavailable)
			}
			try {
				return await options.source.readManifest()
			} catch (error) {
				return sourceErrorResponse(error)
			}
		})
		.get(`/source/snapshot`, async () => {
			if (options.source === undefined) {
				return status(501, sourceServiceUnavailable)
			}
			try {
				return await options.source.readSnapshot()
			} catch (error) {
				return sourceErrorResponse(error)
			}
		})
		.get(
			`/source/comparison`,
			async ({ query }) => {
				if (options.source?.readComparison === undefined) {
					return status(501, {
						code: `source.git_unavailable` as const,
						message: `Version control is not available for this font source.`,
					})
				}
				try {
					return await options.source.readComparison({
						baseRef: query.baseRef,
						...(query.targetRef === undefined
							? {}
							: { targetRef: query.targetRef }),
					})
				} catch (error) {
					return sourceErrorResponse(error)
				}
			},
			{
				query: t.Object({
					baseRef: t.String({ minLength: 1, maxLength: 256 }),
					targetRef: t.Optional(t.String({ minLength: 1, maxLength: 256 })),
				}),
			},
		)
		.post(
			`/source/commit`,
			async ({ body }) => {
				if (options.source?.commitUnits === undefined) {
					return status(501, {
						code: `source.git_unavailable` as const,
						message: `Version control commits are not available for this font source.`,
					})
				}
				try {
					return await options.source.commitUnits(
						body as CommitSourceUnitsInput,
					)
				} catch (error) {
					return sourceErrorResponse(error)
				}
			},
			{
				body: t.Object({
					expectedComparisonIdentity: t.String({ minLength: 1 }),
					message: t.String({ minLength: 1, maxLength: 10_000 }),
					paths: t.Array(t.String({ minLength: 1 }), {
						minItems: 1,
						maxItems: 1_000,
					}),
				}),
			},
		)
		.get(
			`/source/unit`,
			async ({ query }) => {
				if (options.source === undefined) {
					return status(501, sourceServiceUnavailable)
				}
				try {
					return await options.source.readUnit(query.path)
				} catch (error) {
					return sourceErrorResponse(error)
				}
			},
			{
				query: t.Object({
					path: t.String({ minLength: 1 }),
				}),
			},
		)
		.put(
			`/source/unit`,
			async ({ body }) => {
				if (
					body.expectedRevision !== null &&
					typeof body.expectedRevision !== `string`
				) {
					const invalidRequest: SourceInvalidRequest = {
						code: `source.invalid_request`,
						message: `expectedRevision must be a string or null.`,
					}
					return status(422, invalidRequest)
				}
				if (options.source === undefined) {
					return status(501, sourceServiceUnavailable)
				}
				try {
					return await options.source.writeUnit(body as WriteSourceUnitInput)
				} catch (error) {
					return sourceErrorResponse(error)
				}
			},
			{
				body: t.Object({
					// Elysia's Node-side exact-mirror validator cannot compile a
					// string|null union without TypeCompiler. The service contract
					// remains exact and directory handlers validate this field.
					expectedRevision: t.Any(),
					idempotencyKey: t.String({ minLength: 1 }),
					path: t.String({ minLength: 1 }),
					value: t.Any(),
				}),
			},
		)
		.put(
			`/source/units`,
			async ({ body }) => {
				if (
					body.writes.some(
						(write) =>
							write.expectedRevision !== null &&
							typeof write.expectedRevision !== `string`,
					)
				) {
					const invalidRequest: SourceInvalidRequest = {
						code: `source.invalid_request`,
						message: `Every expectedRevision must be a string or null.`,
					}
					return status(422, invalidRequest)
				}
				if (options.source === undefined) {
					return status(501, sourceServiceUnavailable)
				}
				try {
					return await options.source.writeUnits(body as WriteSourceUnitsInput)
				} catch (error) {
					return sourceErrorResponse(error)
				}
			},
			{
				body: t.Object({
					idempotencyKey: t.String({ minLength: 1 }),
					writes: t.Array(
						t.Object({
							expectedRevision: t.Any(),
							path: t.String({ minLength: 1 }),
							value: t.Any(),
						}),
						{ minItems: 1 },
					),
				}),
			},
		)
}

export type CreateFontRpc = ReturnType<typeof createFontRpc>
