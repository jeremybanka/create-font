import { resolve } from "node:path"

import { createSourceVersionControlRpc } from "@create-art/source-rpc/server"
import { Elysia, status, t } from "elysia"
import type { ElysiaAdapter } from "elysia/adapter"

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

export const CREATE_FONT_RPC_VERSION = 7 as const

export type CreateFontRpcOptions = Readonly<{
	adapter?: ElysiaAdapter
	build: () => Promise<BuildResult>
	name?: string
	root?: string
	source?: CreateFontSourceService
	workspace?: FontWorkspaceInventory
}>

export type FontWorkspaceInventory = Readonly<{
	id: string
	name: string
	activeProjectId: string
	projects: readonly Readonly<{ id: string; name: string; path: string }>[]
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
	const versionControl =
		options.source?.commitUnits === undefined ||
		options.source.readComparison === undefined
			? undefined
			: {
					commitUnits: options.source.commitUnits.bind(options.source),
					readComparison: options.source.readComparison.bind(options.source),
				}
	return new Elysia({
		name: options.name ?? `create-font-rpc`,
		prefix: `/api`,
		...(options.adapter === undefined ? {} : { adapter: options.adapter }),
	})
		.get(`/health`, () => ({
			ok: true as const,
			rpcVersion: CREATE_FONT_RPC_VERSION,
		}))
		.get(`/workspace`, () => ({ root, ...options.workspace }))
		.post(`/build`, options.build)
		.use(
			createSourceVersionControlRpc({
				name: `${options.name ?? `create-font-rpc`}:version-control`,
				...(versionControl === undefined ? {} : { service: versionControl }),
			}),
		)
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
			if (options.source === undefined)
				return status(501, sourceServiceUnavailable)
			try {
				return await options.source.readManifest()
			} catch (error) {
				return sourceErrorResponse(error)
			}
		})
		.get(`/source/snapshot`, async () => {
			if (options.source === undefined)
				return status(501, sourceServiceUnavailable)
			try {
				return await options.source.readSnapshot()
			} catch (error) {
				return sourceErrorResponse(error)
			}
		})
		.get(
			`/source/unit`,
			async ({ query }) => {
				if (options.source === undefined)
					return status(501, sourceServiceUnavailable)
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
				if (options.source === undefined)
					return status(501, sourceServiceUnavailable)
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
				if (options.source === undefined)
					return status(501, sourceServiceUnavailable)
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
			},
		)
}

export type CreateFontRpc = ReturnType<typeof createFontRpc>
