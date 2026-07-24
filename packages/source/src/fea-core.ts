/** A UTF-16 source range in an Adobe feature file. */
export interface FeaSourceRange {
	readonly start: number
	readonly end: number
	readonly line: number
	readonly column: number
}

/** A half-open UTF-8 byte range returned by the `fea-rs` binding. */
export interface FeaSyntaxRange {
	readonly start: number
	readonly end: number
}

export interface FeaSyntaxNode {
	readonly type: "node"
	readonly kind: string
	readonly range: FeaSyntaxRange
	readonly error: boolean
	readonly children: readonly FeaSyntaxElement[]
}

export interface FeaSyntaxToken {
	readonly type: "token"
	readonly kind: string
	readonly range: FeaSyntaxRange
	readonly text: string
}

export type FeaSyntaxElement = FeaSyntaxNode | FeaSyntaxToken

export interface FeaSyntaxDiagnostic {
	readonly code: string
	readonly message: string
	readonly severity: "error" | "warning" | "info"
	readonly range: FeaSyntaxRange
}

export interface FeaSyntaxDocument {
	readonly abiVersion: 1
	readonly sourceLen: number
	readonly root: FeaSyntaxNode
	readonly diagnostics: readonly FeaSyntaxDiagnostic[]
}

export interface FeaSubstitutionAst {
	readonly kind: "substitution"
	readonly from: readonly string[]
	readonly to: string
	readonly markedIndex?: number
	readonly range: FeaSourceRange
}

export interface FeaFeatureAst {
	readonly kind: "feature"
	readonly tag: string
	readonly statements: readonly FeaSubstitutionAst[]
	readonly range: FeaSourceRange
}

export interface FeaDocumentAst {
	readonly kind: "document"
	readonly features: readonly FeaFeatureAst[]
	readonly range: FeaSourceRange
}

export interface FeaDiagnostic {
	readonly message: string
	readonly range: FeaSourceRange
}

export type FeaParseResult =
	| { readonly ok: true; readonly value: FeaDocumentAst }
	| { readonly ok: false; readonly errors: readonly FeaDiagnostic[] }

export interface FeatureSubstitutionIr {
	readonly feature: string
	readonly from: readonly number[]
	readonly to: number
	readonly contextIndex?: number
	readonly range: FeaSourceRange
}

export type FeaParserBinding = (source: string) => string

type PositionForRange = (range: FeaSyntaxRange) => FeaSourceRange

const semanticNodeKinds = new Set(["GsubType1", "GsubType4", "GsubType6"])
const triviaKinds = new Set(["Comment", "Whitespace"])

function createPositioner(source: string): PositionForRange {
	const encoded = new TextEncoder().encode(source)
	const decoder = new TextDecoder()
	const utf16Offset = (byteOffset: number): number =>
		decoder.decode(
			encoded.subarray(0, Math.max(0, Math.min(byteOffset, encoded.length))),
		).length
	return (range) => {
		const start = utf16Offset(range.start)
		const end = utf16Offset(range.end)
		const before = source.slice(0, start)
		const lines = before.split("\n")
		return {
			start,
			end,
			line: lines.length,
			column: (lines.at(-1)?.length ?? 0) + 1,
		}
	}
}

function isSyntaxNode(element: FeaSyntaxElement): element is FeaSyntaxNode {
	return element.type === "node"
}

function directNodes(node: FeaSyntaxNode): readonly FeaSyntaxNode[] {
	return node.children.filter(isSyntaxNode)
}

function directTokens(node: FeaSyntaxNode): readonly FeaSyntaxToken[] {
	return node.children.filter(
		(element): element is FeaSyntaxToken => element.type === "token",
	)
}

function descendantTokens(node: FeaSyntaxNode): readonly FeaSyntaxToken[] {
	return node.children.flatMap((element): readonly FeaSyntaxToken[] =>
		element.type === "token" ? [element] : descendantTokens(element),
	)
}

function childNode(
	node: FeaSyntaxNode,
	kind: string,
): FeaSyntaxNode | undefined {
	return directNodes(node).find((child) => child.kind === kind)
}

function meaningfulTokens(node: FeaSyntaxNode): readonly FeaSyntaxToken[] {
	return descendantTokens(node).filter((token) => !triviaKinds.has(token.kind))
}

function unsupportedDiagnostic(
	node: FeaSyntaxNode,
	position: PositionForRange,
): FeaDiagnostic {
	return {
		message: `Unsupported create-font Adobe feature semantics in ${node.kind}.`,
		range: position(node.range),
	}
}

function projectionDiagnostic(
	message: string,
	node: FeaSyntaxNode,
	position: PositionForRange,
): FeaDiagnostic {
	return { message, range: position(node.range) }
}

function parseDirectSubstitution(
	node: FeaSyntaxNode,
	position: PositionForRange,
): FeaSubstitutionAst | FeaDiagnostic {
	const tokens = meaningfulTokens(node)
	if (
		tokens.some(
			(token) => !["SubKw", "GlyphName", "ByKw", "Semi"].includes(token.kind),
		)
	) {
		return unsupportedDiagnostic(node, position)
	}
	const byIndex = tokens.findIndex((token) => token.kind === "ByKw")
	const from = tokens
		.slice(1, byIndex)
		.filter((token) => token.kind === "GlyphName")
		.map((token) => token.text)
	const replacements = tokens
		.slice(byIndex + 1)
		.filter((token) => token.kind === "GlyphName")
	if (byIndex < 0 || from.length === 0 || replacements.length !== 1) {
		return projectionDiagnostic(
			"Expected one create-font substitution output glyph.",
			node,
			position,
		)
	}
	return {
		kind: "substitution",
		from,
		to: replacements[0]!.text,
		range: position(node.range),
	}
}

function glyphNames(node: FeaSyntaxNode | undefined): readonly string[] {
	if (node === undefined) return []
	return descendantTokens(node)
		.filter((token) => token.kind === "GlyphName")
		.map((token) => token.text)
}

function parseContextualSubstitution(
	node: FeaSyntaxNode,
	position: PositionForRange,
): FeaSubstitutionAst | FeaDiagnostic {
	const tokens = descendantTokens(node)
	if (
		tokens.some(
			(token) =>
				token.kind === "NamedGlyphClass" ||
				token.kind === "GlyphClass" ||
				token.kind === "LookupKw",
		) ||
		tokens.filter((token) => token.kind === "SingleQuote").length !== 1
	) {
		return unsupportedDiagnostic(node, position)
	}
	const backtrack = glyphNames(childNode(node, "BacktrackSequence"))
	const contextNode = childNode(node, "ContextSequence")
	const contextGlyphs =
		contextNode === undefined
			? []
			: directNodes(contextNode).filter(
					(child) => child.kind === "ContextGlyphNode",
				)
	const context = contextGlyphs.flatMap((child) => glyphNames(child))
	const lookahead = glyphNames(childNode(node, "LookaheadSequence"))
	const replacements = glyphNames(childNode(node, "InlineSubNode"))
	if (
		contextGlyphs.length !== 1 ||
		context.length !== 1 ||
		replacements.length !== 1
	) {
		return unsupportedDiagnostic(node, position)
	}
	return {
		kind: "substitution",
		from: [...backtrack, ...context, ...lookahead],
		to: replacements[0]!,
		markedIndex: backtrack.length,
		range: position(node.range),
	}
}

function parseSubstitution(
	node: FeaSyntaxNode,
	position: PositionForRange,
): FeaSubstitutionAst | FeaDiagnostic {
	return node.kind === "GsubType6"
		? parseContextualSubstitution(node, position)
		: parseDirectSubstitution(node, position)
}

function parseFeature(
	node: FeaSyntaxNode,
	position: PositionForRange,
): FeaFeatureAst | readonly FeaDiagnostic[] {
	const tags = directTokens(node).filter((token) => token.kind === "Tag")
	if (tags.length !== 2 || tags[0]!.text !== tags[1]!.text) {
		return [
			projectionDiagnostic(
				"Expected matching opening and closing feature tags.",
				node,
				position,
			),
		]
	}
	const statements: FeaSubstitutionAst[] = []
	const errors: FeaDiagnostic[] = []
	for (const child of directNodes(node)) {
		if (!semanticNodeKinds.has(child.kind)) {
			errors.push(unsupportedDiagnostic(child, position))
			continue
		}
		const statement = parseSubstitution(child, position)
		if ("message" in statement) errors.push(statement)
		else statements.push(statement)
	}
	if (errors.length > 0) return errors
	return {
		kind: "feature",
		tag: tags[0]!.text,
		statements,
		range: position(node.range),
	}
}

function isSyntaxDocument(value: unknown): value is FeaSyntaxDocument {
	if (typeof value !== "object" || value === null) return false
	const candidate = value as Partial<FeaSyntaxDocument>
	return (
		candidate.abiVersion === 1 &&
		typeof candidate.sourceLen === "number" &&
		candidate.root?.type === "node" &&
		candidate.root.kind === "SourceFile" &&
		Array.isArray(candidate.diagnostics)
	)
}

export function createFeaApi(parseWithBinding: FeaParserBinding): {
	readonly parseFea: (source: string) => FeaParseResult
	readonly parseFeaSyntax: (source: string) => FeaSyntaxDocument
} {
	const parseFeaSyntax = (source: string): FeaSyntaxDocument => {
		const parsed: unknown = JSON.parse(parseWithBinding(source))
		if (!isSyntaxDocument(parsed))
			throw new Error("Unsupported Adobe feature binding ABI.")
		if (parsed.sourceLen !== new TextEncoder().encode(source).length)
			throw new Error(
				"Adobe feature binding returned an invalid source length.",
			)
		return parsed
	}
	const parseFea = (source: string): FeaParseResult => {
		const position = createPositioner(source)
		let parsed: FeaSyntaxDocument
		try {
			parsed = parseFeaSyntax(source)
		} catch (error) {
			return {
				ok: false,
				errors: [
					{
						message: error instanceof Error ? error.message : String(error),
						range: position({ start: 0, end: 0 }),
					},
				],
			}
		}
		const syntaxErrors = parsed.diagnostics
			.filter((diagnostic) => diagnostic.severity === "error")
			.map((diagnostic) => ({
				message: diagnostic.message,
				range: position(diagnostic.range),
			}))
		if (syntaxErrors.length > 0) return { ok: false, errors: syntaxErrors }

		const features: FeaFeatureAst[] = []
		const errors: FeaDiagnostic[] = []
		for (const child of directNodes(parsed.root)) {
			if (child.kind !== "FeatureNode") {
				errors.push(unsupportedDiagnostic(child, position))
				continue
			}
			const feature = parseFeature(child, position)
			if (Array.isArray(feature)) errors.push(...feature)
			else features.push(feature as FeaFeatureAst)
		}
		if (errors.length > 0) return { ok: false, errors }
		return {
			ok: true,
			value: {
				kind: "document",
				features,
				range: position(parsed.root.range),
			},
		}
	}
	return { parseFea, parseFeaSyntax }
}

/** Resolves glyph names only after parsing, producing stable compiler-facing glyph IDs. */
export function lowerFeaSubstitutions(
	document: FeaDocumentAst,
	glyphs: ReadonlyMap<string, number>,
): {
	readonly ir: readonly FeatureSubstitutionIr[]
	readonly errors: readonly FeaDiagnostic[]
} {
	const ir: FeatureSubstitutionIr[] = []
	const errors: FeaDiagnostic[] = []
	for (const feature of document.features) {
		for (const statement of feature.statements) {
			const from = statement.from.map((name) => glyphs.get(name))
			const to = glyphs.get(statement.to)
			const missing = statement.from.filter(
				(_, index) => from[index] === undefined,
			)
			if (to === undefined) missing.push(statement.to)
			if (missing.length > 0) {
				errors.push({
					message: `Unknown glyph${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}.`,
					range: statement.range,
				})
				continue
			}
			ir.push({
				feature: feature.tag,
				from: from as number[],
				to,
				...(statement.markedIndex === undefined
					? {}
					: { contextIndex: statement.markedIndex }),
				range: statement.range,
			})
		}
	}
	return { ir, errors }
}
