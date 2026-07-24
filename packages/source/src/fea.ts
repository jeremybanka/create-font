import { parseFea as parseFeaWithBinding } from "@create-font/fea-parser/node"

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

/** Parses Adobe feature syntax through the shared Rust parser. */
export const parseFea = api.parseFea

/** Returns the complete lossless Rust syntax document. */
export const parseFeaSyntax = api.parseFeaSyntax
