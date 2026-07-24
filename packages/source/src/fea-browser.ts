import initWasm, {
	parseFea as wasmParseFea,
	type InitInput,
} from "@create-font/fea-wasm/web"

import { createFeaApi, type FeaWasmParse } from "./fea-core.ts"

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
	initialization ??= initWasm(input)
		.then(() => {
			initialized = true
		})
		.catch((error: unknown) => {
			initialization = undefined
			throw error
		})
	return initialization
}

const guardedWasmParse: FeaWasmParse = (source) => {
	if (!initialized)
		throw new Error(
			"Adobe feature Wasm is not initialized. Call initializeFeaParser() first.",
		)
	return wasmParseFea(source)
}
const api = createFeaApi(guardedWasmParse)

/** Parses Adobe feature syntax through the initialized Rust/Wasm parser. */
export const parseFea = api.parseFea

/** Returns the complete lossless Rust/Wasm syntax document. */
export const parseFeaSyntax = api.parseFeaSyntax
