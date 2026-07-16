import { resolve } from "node:path"

import { Elysia, status, t } from "elysia"

import {
	SourceUnitConflictError,
	SourceUnitNotFoundError,
	SourceValidationError,
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
} from "./contracts.ts"

export const CREATE_FONT_RPC_VERSION = 3 as const

export type CreateFontRpcOptions = Readonly<{
	build: () => Promise<BuildResult>
	root?: string
	source?: CreateFontSourceService
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
				sourceConnections.set(ws, unsubscribe)
			},
			close(ws) {
				sourceConnections.get(ws)?.()
				sourceConnections.delete(ws)
			},
			response: t.Object({
				type: t.Literal(`source.changed`),
				manifest: t.Object({
					revision: t.String(),
					units: t.Array(
						t.Object({
							path: t.String(),
							revision: t.String(),
						}),
					),
				}),
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
