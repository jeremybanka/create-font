import { Elysia, status, t } from "elysia"
import type { ElysiaAdapter } from "elysia/adapter"

import {
	SourceUnitConflictError,
	SourceUnitNotFoundError,
	SourceValidationError,
	type SourceInvalidRequest,
	type SourceService,
	type SourceUnitConflict,
	type SourceUnitNotFound,
	type SourceValidationFailure,
	type WriteSourceUnitInput,
	type WriteSourceUnitsInput,
} from "./contracts.ts"

export type SourceRpcOptions = Readonly<{
	adapter?: ElysiaAdapter
	source?: SourceService
	unavailableMessage?: string
}>

export function sourceErrorResponse(error: unknown) {
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
	return new Elysia({
		...(options.adapter === undefined ? {} : { adapter: options.adapter }),
		name: `create-art-source-rpc`,
	})
		.ws(`/source/events`, {
			open(ws) {
				if (options.source?.subscribe === undefined) {
					ws.close()
					return
				}
				sourceConnections.set(
					ws.raw,
					options.source.subscribe((event) => ws.send(event)),
				)
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
			`/source/units`,
			async ({ body }) => {
				if (
					body.writes.length + body.removals.length === 0 ||
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
					return await options.source.writeUnits(body as WriteSourceUnitsInput)
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
