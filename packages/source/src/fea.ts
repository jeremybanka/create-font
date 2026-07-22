/** A UTF-16 source range in an Adobe feature file. */
export interface FeaSourceRange {
	readonly start: number
	readonly end: number
	readonly line: number
	readonly column: number
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

type Token = { readonly value: string; readonly range: FeaSourceRange }
type TokenizeResult =
	| { readonly ok: true; readonly tokens: readonly Token[] }
	| { readonly ok: false; readonly errors: readonly FeaDiagnostic[] }

function position(source: string, start: number, end = start): FeaSourceRange {
	const before = source.slice(0, start)
	const lines = before.split("\n")
	return {
		start,
		end,
		line: lines.length,
		column: (lines.at(-1)?.length ?? 0) + 1,
	}
}

function tokenize(source: string): TokenizeResult {
	const tokens: Token[] = []
	const pattern =
		/\s+|#[^\n]*|\/\*[\s\S]*?\*\/|[A-Za-z_.][A-Za-z0-9_.]*|[{};']/gy
	let cursor = 0
	while (cursor < source.length) {
		pattern.lastIndex = cursor
		const match = pattern.exec(source)
		if (match === null) {
			return {
				ok: false,
				errors: [
					{
						message: `Unsupported Adobe feature syntax ${JSON.stringify(source[cursor])}.`,
						range: position(source, cursor, cursor + 1),
					},
				],
			}
		}
		cursor = pattern.lastIndex
		if (
			/^\s/u.test(match[0]) ||
			match[0].startsWith("#") ||
			match[0].startsWith("/*")
		)
			continue
		const start = match.index
		tokens.push({
			value: match[0],
			range: position(source, start, start + match[0].length),
		})
	}
	return { ok: true, tokens }
}

/** Parses the feature/substitution subset used by create-font's pre-lowering IR. */
export function parseFea(source: string): FeaParseResult {
	const tokenized = tokenize(source)
	if (!tokenized.ok) return tokenized
	const tokens = tokenized.tokens
	const features: FeaFeatureAst[] = []
	const errors: FeaDiagnostic[] = []
	let cursor = 0
	const take = (): Token | undefined => tokens[cursor++]
	while (cursor < tokens.length) {
		const opening = take()
		const tag = take()
		const brace = take()
		if (
			opening?.value !== "feature" ||
			tag === undefined ||
			brace?.value !== "{"
		) {
			errors.push({
				message: "Expected `feature TAG {`.",
				range: opening?.range ?? position(source, source.length),
			})
			break
		}
		const statements: FeaSubstitutionAst[] = []
		while (tokens[cursor]?.value !== "}" && cursor < tokens.length) {
			const sub = take()
			const from: string[] = []
			let markedIndex: number | undefined
			while (tokens[cursor] !== undefined && tokens[cursor]?.value !== "by") {
				const token = take()
				if (token?.value === ";" || token?.value === "}") break
				if (token?.value === "'") {
					if (from.length === 0 || markedIndex !== undefined)
						errors.push({
							message:
								"Expected one apostrophe after the contextual input glyph.",
							range: token.range,
						})
					else markedIndex = from.length - 1
				} else if (token !== undefined) from.push(token.value)
			}
			const by = take()
			const to = take()
			const semicolon = take()
			if (
				sub?.value !== "sub" ||
				from.length === 0 ||
				by?.value !== "by" ||
				to === undefined ||
				semicolon?.value !== ";"
			) {
				errors.push({
					message: "Expected `sub glyph [glyph ...] by glyph;`.",
					range: sub?.range ?? tag.range,
				})
				while (
					cursor < tokens.length &&
					tokens[cursor]?.value !== ";" &&
					tokens[cursor]?.value !== "}"
				)
					cursor += 1
				if (tokens[cursor]?.value === ";") cursor += 1
				continue
			}
			statements.push({
				kind: "substitution",
				from,
				to: to.value,
				...(markedIndex === undefined ? {} : { markedIndex }),
				range: { ...sub.range, end: semicolon.range.end },
			})
		}
		const close = take()
		const closingTag = take()
		const semicolon = take()
		if (
			close?.value !== "}" ||
			closingTag?.value !== tag.value ||
			semicolon?.value !== ";"
		) {
			errors.push({
				message: `Expected \`} ${tag.value};\`.`,
				range: close?.range ?? tag.range,
			})
			break
		}
		features.push({
			kind: "feature",
			tag: tag.value,
			statements,
			range: { ...opening.range, end: semicolon.range.end },
		})
	}
	if (errors.length > 0) return { ok: false, errors }
	return {
		ok: true,
		value: {
			kind: "document",
			features,
			range: position(source, 0, source.length),
		},
	}
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
