import { parseFea as wasmParseFea } from "@create-font/fea-wasm/node"

import { createFeaApi } from "./fea-core.ts"

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

const api = createFeaApi(wasmParseFea)

/** Parses Adobe feature syntax through the shared Rust/Wasm parser. */
export const parseFea = api.parseFea

/** Returns the complete lossless Rust/Wasm syntax document. */
export const parseFeaSyntax = api.parseFeaSyntax
