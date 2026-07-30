export const SOURCE_FORMAT_CONTRACT_VERSION = 1 as const
export const SOURCE_FORMAT_DPRINT_VERSION = "0.55.2" as const
export const SOURCE_FORMAT_JSON_PLUGIN_VERSION = "0.23.0" as const
export const SOURCE_FORMAT_FEA_PLUGIN_VERSION = "0.1.1" as const

export const sourceFormatConfiguration = Object.freeze({
	indentWidth: 2,
	lineWidth: 80,
	newLineKind: "lf",
	useTabs: true,
} as const)

export const sourceFormatFeaConfiguration = Object.freeze({
	...sourceFormatConfiguration,
	useTabs: false,
} as const)

export type SourceJsonValue =
	| null
	| boolean
	| number
	| string
	| readonly SourceJsonValue[]
	| { readonly [key: string]: SourceJsonValue }

/**
 * Produce the semantic seed supplied to dprint. Object names are recursively
 * sorted while array order, JSON string escaping, and finite number spellings
 * remain authored facts. Negative zero is retained explicitly.
 */
export function stringifySourceJson(value: SourceJsonValue): string {
	if (value === null) return "null"
	if (typeof value === "boolean") return value ? "true" : "false"
	if (typeof value === "number") {
		if (!Number.isFinite(value)) {
			throw new TypeError("Source JSON numbers must be finite.")
		}
		return Object.is(value, -0) ? "-0" : JSON.stringify(value)
	}
	if (typeof value === "string") return JSON.stringify(value)
	if (Array.isArray(value)) {
		return `[${value.map((item) => stringifySourceJson(item)).join(",")}]`
	}
	const record = value as { readonly [key: string]: SourceJsonValue }
	return `{${Object.keys(record)
		.sort()
		.map(
			(key) =>
				`${JSON.stringify(key)}:${stringifySourceJson(record[key] ?? null)}`,
		)
		.join(",")}}`
}
