export {
	SOURCE_FORMAT_CONTRACT_VERSION,
	SOURCE_FORMAT_DPRINT_VERSION,
	SOURCE_FORMAT_FEA_PLUGIN_VERSION,
	SOURCE_FORMAT_JSON_PLUGIN_VERSION,
	sourceFormatFeaConfiguration,
	sourceFormatConfiguration,
	stringifySourceJson,
	type SourceJsonValue,
} from "./shared.ts"

export function formatSourceJson(
	_value?: SourceJsonValue,
	_filePath?: string,
): never {
	throw new Error(
		"Source formatting is available only from the trusted Node adapter.",
	)
}

export function formatSourceFea(_text?: string, _filePath?: string): never {
	throw new Error(
		"Adobe feature formatting is available only from the trusted Node adapter.",
	)
}
