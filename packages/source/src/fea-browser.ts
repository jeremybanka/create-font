import initializeParserModule, {
	parseFea as parseFeaWithBinding,
	type InitInput,
} from "@create-font/fea-rs-wasm/web"

import { createFeaApi, type FeaParserBinding } from "./fea-core.ts"

export {
	lowerFeaSubstitutions,
	type FeaDiagnostic,
	type FeaDocumentAst,
	type FeaFeatureAst,
	type FeaParseResult,
	type FeaSourceRange,
	type FeaSubstitutionAst,
	type FeaSyntaxDiagnostic,
	type FeaSyntaxDocument,
	type FeaSyntaxElement,
	type FeaSyntaxNode,
	type FeaSyntaxRange,
	type FeaSyntaxToken,
	type FeatureSubstitutionIr,
} from "./fea-core.ts"

let initialized = false
let initialization: Promise<void> | undefined

/** Initializes the browser WebAssembly bindings once. */
export function initializeFeaParser(input?: InitInput): Promise<void> {
	initialization ??= initializeParserModule(input)
		.then(() => {
			initialized = true
		})
		.catch((error: unknown) => {
			initialization = undefined
			throw error
		})
	return initialization
}

const guardedParse: FeaParserBinding = (source) => {
	if (!initialized)
		throw new Error(
			"Adobe feature bindings are not initialized. Call initializeFeaParser() first.",
		)
	return parseFeaWithBinding(source)
}
const api = createFeaApi(guardedParse)

/** Projects Adobe feature syntax from the initialized `fea-rs` binding. */
export const parseFea = api.parseFea

/** Returns the complete lossless concrete syntax document from `fea-rs`. */
export const parseFeaSyntax = api.parseFeaSyntax
