import { resolve } from "node:path"

import { Elysia, status, t } from "elysia"

import {
	SourceUnitConflictError,
	SourceUnitNotFoundError,
} from "./contracts.ts"
import type {
	BuildResult,
	SourceInvalidRequest,
	SourceUnitConflict,
	SourceUnitNotFound,
	SourceServiceUnavailable,
	TrigraphSourceService,
	WriteSourceUnitInput,
} from "./contracts.ts"

export const TRIGRAPH_RPC_VERSION = 2 as const

export type CreateTrigraphRpcOptions = Readonly<{
	build: () => Promise<BuildResult>
	root?: string
	source?: TrigraphSourceService
}>

const sourceServiceUnavailable: SourceServiceUnavailable = {
	code: `source.not_ready`,
	message: `The font source service has not been configured yet.`,
}

function sourceErrorResponse(error: unknown) {
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
	throw error
}

export function createTrigraphRpc(options: CreateTrigraphRpcOptions) {
	const root = resolve(options.root ?? process.cwd())

	return new Elysia({
		name: `trigraph-rpc`,
		prefix: `/api`,
	})
		.get(`/health`, () => ({
			ok: true as const,
			rpcVersion: TRIGRAPH_RPC_VERSION,
		}))
		.get(`/workspace`, () => ({
			root,
		}))
		.post(`/build`, options.build)
		.get(`/source`, () =>
			options.source === undefined
				? status(501, sourceServiceUnavailable)
				: options.source.readManifest(),
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
}

export type TrigraphRpc = ReturnType<typeof createTrigraphRpc>
