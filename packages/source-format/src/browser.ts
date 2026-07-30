export {
	SOURCE_FORMAT_CONTRACT_VERSION,
	SOURCE_FORMAT_DPRINT_VERSION,
	SOURCE_FORMAT_FEA_PLUGIN_VERSION,
	SOURCE_FORMAT_JSON_PLUGIN_VERSION,
	formatPortableSourceJson,
	sourceFormatFeaConfiguration,
	sourceFormatConfiguration,
	stringifySourceJson,
	type SourceJsonValue,
} from "./shared.ts"

export { formatPortableSourceJson as formatSourceJson } from "./shared.ts"

export function formatSourceFea(): never {
	throw new Error(
		"Adobe feature formatting is available only from the trusted Node adapter.",
	)
}
