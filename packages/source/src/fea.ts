import { parseFea as parseFeaWithBinding } from "@create-font/fea-rs-wasm/node"

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

const api = createFeaApi(parseFeaWithBinding)

/** Projects Adobe feature syntax from the shared `fea-rs` binding. */
export const parseFea = api.parseFea

/** Returns the complete lossless concrete syntax document from `fea-rs`. */
export const parseFeaSyntax = api.parseFeaSyntax
