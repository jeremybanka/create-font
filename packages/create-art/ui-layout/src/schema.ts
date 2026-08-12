import { z } from "zod"

export const UI_LAYOUT_VERSION = 1 as const
export const UI_LAYOUT_ORIGINS = ["home", "project"] as const
export const UI_LAYOUT_PRODUCTS = ["create-font", "create-design"] as const

const hotbar = z.array(z.string().min(1).nullable()).length(12).readonly()
const tile = z
	.strictObject({
		id: z.string().min(1),
		kind: z.string().min(1),
		fill: z.boolean(),
	})
	.readonly()
const column = z
	.strictObject({
		id: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
		alignment: z.enum(["top", "bottom"]),
		collapsed: z.boolean(),
		tiles: z.array(tile).readonly(),
	})
	.readonly()
export const uiTilingLayoutV1Schema = z
	.strictObject({
		version: z.literal(3),
		columns: z.array(column).length(4).readonly(),
	})
	.superRefine((layout, context) => {
		const columns = new Set(layout.columns.map(({ id }) => id))
		if (columns.size !== 4)
			context.addIssue({
				code: "custom",
				message: "Columns 1–4 must each occur exactly once.",
				path: ["columns"],
			})
		const ids = layout.columns.flatMap(({ tiles }) => tiles.map(({ id }) => id))
		if (new Set(ids).size !== ids.length)
			context.addIssue({
				code: "custom",
				message: "Tile instance IDs must be unique.",
				path: ["columns"],
			})
	})
	.readonly()

const commonState = {
	tiling: uiTilingLayoutV1Schema,
	hotbars: z.strictObject({ primary: hotbar, alternate: hotbar }).readonly(),
}
const fontRecord = z
	.strictObject({
		version: z.literal(UI_LAYOUT_VERSION),
		id: z.string().min(1).max(128),
		name: z.string().trim().min(1).max(128),
		product: z.literal("create-font"),
		state: z
			.strictObject({
				...commonState,
				preferences: z.strictObject({ diffView: z.boolean() }).readonly(),
			})
			.readonly(),
	})
	.readonly()
const designRecord = z
	.strictObject({
		version: z.literal(UI_LAYOUT_VERSION),
		id: z.string().min(1).max(128),
		name: z.string().trim().min(1).max(128),
		product: z.literal("create-design"),
		state: z
			.strictObject({
				...commonState,
				preferences: z
					.strictObject({
						canvasDimmer: z.number().int().min(0).max(255).nullable(),
					})
					.readonly(),
			})
			.readonly(),
	})
	.readonly()

export const uiLayoutRecordV1Schema = z.discriminatedUnion("product", [
	fontRecord,
	designRecord,
])
export const uiLayoutFileV1Schema = z
	.array(uiLayoutRecordV1Schema)
	.superRefine((records, context) => {
		for (const field of ["id", "name"] as const) {
			const seen = new Map<string, number>()
			for (const [index, record] of records.entries()) {
				const key =
					field === "name" ? record.name.toLocaleLowerCase() : record.id
				const previous = seen.get(key)
				if (previous !== undefined)
					context.addIssue({
						code: "custom",
						message: `Duplicate layout ${field} (first used at record ${previous}).`,
						path: [index, field],
					})
				else seen.set(key, index)
			}
		}
	})
	.readonly()

export type UiLayoutRecordV1 = z.infer<typeof uiLayoutRecordV1Schema>
export type UiLayoutFileV1 = z.infer<typeof uiLayoutFileV1Schema>
export type UiLayoutProduct = UiLayoutRecordV1["product"]
export type UiLayoutOrigin = (typeof UI_LAYOUT_ORIGINS)[number]
export type UiLayoutState = UiLayoutRecordV1["state"]

export const uiLayoutJsonSchema = z.toJSONSchema(uiLayoutFileV1Schema, {
	target: "draft-2020-12",
})

export function canonicalUiLayout(value: UiLayoutRecordV1): string {
	return JSON.stringify(value)
}

export function prettyUiLayoutFile(value: UiLayoutFileV1): string {
	return `${JSON.stringify(value, null, 2)}\n`
}
