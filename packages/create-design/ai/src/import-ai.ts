import { parseIllustratorSource } from "./illustrator-source-parser.ts"
import { lowerIllustratorSource } from "./lower-illustrator-source.ts"
import { decodeIllustratorPrivateSource } from "./private-container.ts"
import type {
	IllustratorImportOptions,
	IllustratorImportResult,
} from "./types.ts"

/** Imports native, revisable Illustrator source; PDF pages are never artwork. */
export function importAdobeIllustrator(
	bytes: Uint8Array,
	options: IllustratorImportOptions = {},
): IllustratorImportResult {
	const decoded = decodeIllustratorPrivateSource(bytes)
	if (!decoded.ok)
		return {
			ok: false,
			document: null,
			diagnostics: [
				{
					code: decoded.code,
					message: decoded.message,
					severity: "error",
					stage: "container",
				},
			],
			summary: { artboards: 0, objects: 0, swatches: 0 },
		}
	return lowerIllustratorSource(
		parseIllustratorSource(decoded.value.text),
		options,
	)
}
