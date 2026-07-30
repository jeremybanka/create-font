import { resolve } from "node:path"

import { Elysia, status, t } from "elysia"
import type { ElysiaAdapter } from "elysia/adapter"
import { sourceErrorResponse as sharedSourceErrorResponse } from "@create-art/source-rpc/server"

import { SourceVersionControlError } from "./contracts.ts"
import type {
	BuildResult,
	SourceInvalidRequest,
	SourceServiceUnavailable,
	CreateFontSourceService,
	CommitSourceUnitsInput,
	WriteSourceUnitInput,
	WriteSourceUnitsInput,
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
	return sharedSourceErrorResponse(error)
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
