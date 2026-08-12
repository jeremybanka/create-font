import { Elysia, t } from "elysia"
import type { ElysiaAdapter } from "elysia/adapter"
import { type SaveUiLayoutInput } from "./contracts.ts"
import {
	createUiLayoutFileService,
	UiLayoutConflictError,
	type UiLayoutFileServiceOptions,
} from "./node.ts"
import {
	UI_LAYOUT_ORIGINS,
	UI_LAYOUT_PRODUCTS,
	uiLayoutRecordV1Schema,
} from "./schema.ts"

export function createUiLayoutRpc(
	options: UiLayoutFileServiceOptions & Readonly<{ adapter?: ElysiaAdapter }>,
) {
	const service = createUiLayoutFileService(options)
	return new Elysia({
		...(options.adapter === undefined ? {} : { adapter: options.adapter }),
		name: "create-art-ui-layout-rpc",
	})
		.get(
			"/ui-layouts",
			async ({ query, status }) => {
				if (!UI_LAYOUT_PRODUCTS.includes(query.product as never))
					return status(400, {
						code: "ui.invalid_request",
						message: "Unknown UI layout product.",
					})
				try {
					return await service.load(
						query.product as SaveUiLayoutInput["product"],
					)
				} catch (error) {
					return status(500, {
						code: "ui.io_error",
						message:
							error instanceof Error
								? error.message
								: "Could not read UI layouts.",
					})
				}
			},
			{ query: t.Object({ product: t.String() }) },
		)
		.post(
			"/ui-layouts",
			async ({ body, status }) => {
				if (typeof body !== "object" || body === null)
					return status(400, {
						code: "ui.invalid_request",
						message: "Expected a UI layout save request.",
					})
				const candidate = body as Partial<SaveUiLayoutInput>
				if (
					!UI_LAYOUT_PRODUCTS.includes(candidate.product as never) ||
					!UI_LAYOUT_ORIGINS.includes(candidate.origin as never) ||
					(candidate.expectedRevision !== null &&
						typeof candidate.expectedRevision !== "string")
				)
					return status(400, {
						code: "ui.invalid_request",
						message: "Invalid UI layout product, origin, or revision.",
					})
				const parsed = uiLayoutRecordV1Schema.safeParse(candidate.layout)
				if (!parsed.success)
					return status(422, {
						code: "ui.validation_failed",
						message: "The UI layout is invalid.",
						issues: parsed.error.issues.map((issue) => ({
							file: candidate.origin!,
							path: `$.${issue.path.join(".")}`,
							message: issue.message,
						})),
					})
				try {
					return await service.save({
						product: candidate.product!,
						origin: candidate.origin!,
						expectedRevision: candidate.expectedRevision!,
						layout: parsed.data,
					})
				} catch (error) {
					if (error instanceof UiLayoutConflictError)
						return status(409, {
							code: "ui.write_conflict",
							message: error.message,
						})
					return status(500, {
						code: "ui.io_error",
						message:
							error instanceof Error
								? error.message
								: "Could not save UI layouts.",
					})
				}
			},
			{ body: t.Any() },
		)
}
