import { readFileSync } from "node:fs"

import { createContext } from "@dprint/formatter"
import { getPath as getJsonPluginPath } from "@dprint/json"

import {
	sourceFormatFeaConfiguration,
	sourceFormatConfiguration,
	sourceFormatJsonConfiguration,
	stringifySourceJson,
	type SourceJsonValue,
} from "./shared.ts"

export {
	SOURCE_FORMAT_CONTRACT_VERSION,
	SOURCE_FORMAT_DPRINT_RANGE,
	SOURCE_FORMAT_DPRINT_VERSION,
	SOURCE_FORMAT_FEA_PLUGIN_VERSION,
	SOURCE_FORMAT_JSON_PLUGIN_VERSION,
	sourceFormatFeaConfiguration,
	sourceFormatConfiguration,
	sourceFormatJsonConfiguration,
	stringifySourceJson,
	type SourceJsonValue,
} from "./shared.ts"

const context = createContext(sourceFormatConfiguration)
context.addPlugin(readFileSync(getJsonPluginPath()), sourceFormatJsonConfiguration)
context.addPlugin(
	readFileSync(new URL(import.meta.resolve("dprint-plugin-fea/plugin.wasm"))),
	sourceFormatFeaConfiguration,
)

function exactlyOneLf(text: string): string {
	return `${text.replace(/(?:\r\n?|\n)+$/u, "")}\n`
}

/** Format validated JSON with the trusted, package-pinned dprint plugin. */
export function formatSourceJson(
	value: SourceJsonValue,
	filePath = "source.json",
): string {
	return exactlyOneLf(
		context.formatText({
			filePath,
			fileText: stringifySourceJson(value),
		}),
	)
}

/** Format application-owned Adobe feature text with the trusted plugin. */
export function formatSourceFea(text: string, filePath = "features/source.fea"): string {
	return exactlyOneLf(context.formatText({ filePath, fileText: text }))
}
