import type { IllustratorSourceSpan } from "./illustrator-source-types.ts"

export type IllustratorSyntaxToken = Readonly<{
	kind:
		| "boolean"
		| "comment"
		| "delimiter"
		| "hex"
		| "name"
		| "null"
		| "number"
		| "operator"
		| "pseudo-comment"
		| "string"
		| "whitespace"
	raw: string
	value?: boolean | null | number | string
	span: IllustratorSourceSpan
}>

const number = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/u
export const MAX_ILLUSTRATOR_LEXER_SOURCE_CHARACTERS = 64 * 1024 * 1024
export const MAX_ILLUSTRATOR_SYNTAX_TOKENS = 1_000_000

export interface LexIllustratorSourceOptions {
	/** Testable lower bound; never raises the hard source limit. */
	readonly maxSourceCharacters?: number
	/** Testable lower bound; never raises the hard token limit. */
	readonly maxTokens?: number
}

function boundedLimit(
	requested: number | undefined,
	hardLimit: number,
): number {
	return requested === undefined ||
		!Number.isSafeInteger(requested) ||
		requested < 1
		? hardLimit
		: Math.min(requested, hardLimit)
}

/** Losslessly tokenizes the complete Illustrator PostScript program. */
export function lexIllustratorSource(
	source: string,
	options: LexIllustratorSourceOptions = {},
): IllustratorSyntaxToken[] {
	const maxSourceCharacters = boundedLimit(
		options.maxSourceCharacters,
		MAX_ILLUSTRATOR_LEXER_SOURCE_CHARACTERS,
	)
	if (source.length > maxSourceCharacters)
		throw new RangeError(
			`Illustrator source exceeds the ${maxSourceCharacters}-character lexer limit.`,
		)
	const maxTokens = boundedLimit(
		options.maxTokens,
		MAX_ILLUSTRATOR_SYNTAX_TOKENS,
	)
	const result: IllustratorSyntaxToken[] = []
	let index = 0
	let line = 1
	let column = 1
	const advance = (raw: string): void => {
		for (let offset = 0; offset < raw.length; offset++) {
			if (raw[offset] === "\r") {
				if (raw[offset + 1] === "\n") offset++
				line++
				column = 1
			} else if (raw[offset] === "\n") {
				line++
				column = 1
			} else column++
		}
	}
	const emit = (
		kind: IllustratorSyntaxToken["kind"],
		end: number,
		value?: IllustratorSyntaxToken["value"],
	): void => {
		if (result.length >= maxTokens)
			throw new RangeError(
				`Illustrator source exceeds the ${maxTokens}-token lexer limit.`,
			)
		const raw = source.slice(index, end)
		result.push({
			kind,
			raw,
			...(value === undefined ? {} : { value }),
			span: { start: index, end, line, column },
		})
		advance(raw)
		index = end
	}
	while (index < source.length) {
		const character = source[index]!
		if (/\s/u.test(character)) {
			let end = index + 1
			while (end < source.length && /\s/u.test(source[end]!)) end++
			emit("whitespace", end)
			continue
		}
		if (character === "%") {
			let end = index + 1
			while (
				end < source.length &&
				source[end] !== "\r" &&
				source[end] !== "\n"
			)
				end++
			emit(
				source[index + 1] === "_" ? "pseudo-comment" : "comment",
				end,
				source.slice(index + 1, end),
			)
			continue
		}
		if (character === "(") {
			let end = index + 1
			let depth = 1
			let decoded = ""
			while (end < source.length && depth > 0) {
				const next = source[end++]!
				if (next === "\\") {
					let escape = source[end++] ?? ""
					if (/[0-7]/u.test(escape)) {
						for (
							let count = 1;
							count < 3 && /[0-7]/u.test(source[end] ?? "");
							count++
						)
							escape += source[end++]
						decoded += String.fromCharCode(Number.parseInt(escape, 8))
					} else if (escape === "n") decoded += "\n"
					else if (escape === "r") decoded += "\r"
					else if (escape === "t") decoded += "\t"
					else if (escape === "b") decoded += "\b"
					else if (escape === "f") decoded += "\f"
					else if (escape === "\r" || escape === "\n") {
						if (escape === "\r" && source[end] === "\n") end++
					} else decoded += escape
				} else if (next === "(") {
					depth++
					decoded += next
				} else if (next === ")") {
					depth--
					if (depth > 0) decoded += next
				} else decoded += next
			}
			emit("string", end, decoded)
			continue
		}
		if (character === "<" && source[index + 1] !== "<") {
			const close = source.indexOf(">", index + 1)
			const end = close < 0 ? source.length : close + 1
			emit(
				"hex",
				end,
				source.slice(index + 1, close < 0 ? end : close).replace(/\s/gu, ""),
			)
			continue
		}
		const pair = source.slice(index, index + 2)
		if (pair === "<<" || pair === ">>") {
			emit("delimiter", index + 2, pair)
			continue
		}
		if ("[]{}".includes(character)) {
			emit("delimiter", index + 1, character)
			continue
		}
		let end = index + 1
		while (end < source.length && !/[\s[\](){}<>/%]/u.test(source[end]!)) end++
		if (character === "/")
			while (end < source.length && !/[\s[\](){}<>/%]/u.test(source[end]!))
				end++
		const raw = source.slice(index, end)
		if (character === "/") emit("name", end, raw.slice(1))
		else if (number.test(raw)) emit("number", end, Number(raw))
		else if (raw === "true" || raw === "false")
			emit("boolean", end, raw === "true")
		else if (raw === "null") emit("null", end, null)
		else emit("operator", end, raw)
	}
	return result
}
