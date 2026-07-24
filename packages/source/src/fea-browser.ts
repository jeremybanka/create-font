import initializeParserModule, {
	parseFea as parseFeaWithBinding,
	type InitInput,
} from "@create-font/fea-parser/web"

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

/** Initializes the browser WebAssembly parser once. */
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
			"Adobe feature parser is not initialized. Call initializeFeaParser() first.",
		)
	return parseFeaWithBinding(source)
}
const api = createFeaApi(guardedParse)

/** Parses Adobe feature syntax through the initialized Rust parser. */
export const parseFea = api.parseFea

/** Returns the complete lossless Rust syntax document. */
export const parseFeaSyntax = api.parseFeaSyntax
