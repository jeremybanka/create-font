import { Elysia, status, t } from "elysia"

import {
	SourceValidationError,
	SourceVersionControlError,
	type CommitSourceUnitsInput,
	type SourceValidationFailure,
	type SourceVersionControlService,
} from "./contracts.ts"

export type SourceVersionControlRpcOptions = Readonly<{
	service?: SourceVersionControlService
}>

function versionControlErrorResponse(error: unknown) {
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

export function createSourceVersionControlRpc(
	options: SourceVersionControlRpcOptions,
) {
	return new Elysia({ name: `create-art-source-version-control-rpc` })
		.get(
			`/source/comparison`,
			async ({ query }) => {
				if (options.service === undefined) {
					return status(501, {
						code: `source.git_unavailable` as const,
						message: `Version control is not available for this source workspace.`,
					})
				}
				try {
					return await options.service.readComparison({
						baseRef: query.baseRef,
						...(query.targetRef === undefined
							? {}
							: { targetRef: query.targetRef }),
					})
				} catch (error) {
					return versionControlErrorResponse(error)
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
				if (options.service === undefined) {
					return status(501, {
						code: `source.git_unavailable` as const,
						message: `Version control commits are not available for this source workspace.`,
					})
				}
				try {
					return await options.service.commitUnits(
						body as CommitSourceUnitsInput,
					)
				} catch (error) {
					return versionControlErrorResponse(error)
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
}
