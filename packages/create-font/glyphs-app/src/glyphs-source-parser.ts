import type {
	GlyphsSourceDictionary,
	GlyphsSourceDocument,
	GlyphsSourceParseResult,
	GlyphsSourceValue,
} from "./glyphs-source-types.ts"

class GlyphsParseError extends Error {
	readonly offset: number

	constructor(message: string, offset: number) {
		super(message)
		this.offset = offset
	}
}

/** Parser for the OpenStep property-list dialect used by Glyphs 2 and 3. */
class GlyphsPlistParser {
	readonly #text: string
	#index = 0
	#depth = 0
	#values = 0
	static readonly maxDepth = 256
	static readonly maxTokenLength = 1_048_576
	static readonly maxValues = 1_000_000

	constructor(text: string) {
		this.#text = text
		if (text.charCodeAt(0) === 0xfeff) this.#index = 1
	}

	parse(): GlyphsSourceValue {
		this.#skipTrivia()
		const value = this.#value()
		this.#skipTrivia()
		if (this.#index !== this.#text.length)
			throw new GlyphsParseError(
				"Unexpected content after the root value.",
				this.#index,
			)
		return value
	}

	#value(): GlyphsSourceValue {
		this.#values += 1
		if (this.#values > GlyphsPlistParser.maxValues)
			throw new GlyphsParseError(
				`Property list exceeds the ${GlyphsPlistParser.maxValues.toLocaleString("en-US")} value limit.`,
				this.#index,
			)
		this.#skipTrivia()
		const character = this.#text[this.#index]
		if (character === "{") return this.#dictionary()
		if (character === "(") return this.#array()
		if (character === '"') return this.#quotedString()
		if (character === "<") return this.#data()
		return this.#atom()
	}

	#dictionary(): GlyphsSourceDictionary {
		this.#enterCollection()
		this.#expect("{")
		const result: Record<string, GlyphsSourceValue> = Object.create(null)
		for (;;) {
			this.#skipTrivia()
			if (this.#take("}")) {
				this.#depth -= 1
				return result
			}
			const key =
				this.#text[this.#index] === '"' ? this.#quotedString() : this.#atom()
			if (Object.hasOwn(result, key))
				throw new GlyphsParseError(
					`Duplicate property ${JSON.stringify(key)}.`,
					this.#index,
				)
			this.#skipTrivia()
			this.#expect("=")
			result[key] = this.#value()
			this.#skipTrivia()
			this.#expect(";")
		}
	}

	#array(): readonly GlyphsSourceValue[] {
		this.#enterCollection()
		this.#expect("(")
		const result: GlyphsSourceValue[] = []
		for (;;) {
			this.#skipTrivia()
			if (this.#take(")")) {
				this.#depth -= 1
				return result
			}
			result.push(this.#value())
			this.#skipTrivia()
			if (this.#take(")")) {
				this.#depth -= 1
				return result
			}
			this.#expect(",")
		}
	}

	#quotedString(): string {
		this.#expect('"')
		const start = this.#index
		let result = ""
		while (this.#index < this.#text.length) {
			if (this.#index - start > GlyphsPlistParser.maxTokenLength)
				throw new GlyphsParseError(
					"String exceeds the 1 MiB token limit.",
					start,
				)
			const character = this.#text[this.#index++]
			if (character === '"') return result
			if (character !== "\\") {
				result += character
				continue
			}
			if (this.#index >= this.#text.length)
				throw new GlyphsParseError("Unterminated escape sequence.", this.#index)
			const escape = this.#text[this.#index++] ?? ""
			const simple: Readonly<Record<string, string>> = {
				'"': '"',
				"\\": "\\",
				a: "\x07",
				b: "\b",
				e: "\x1b",
				f: "\f",
				n: "\n",
				r: "\r",
				t: "\t",
				v: "\v",
			}
			if (Object.hasOwn(simple, escape)) {
				result += simple[escape]
				continue
			}
			if (/[0-7]/u.test(escape)) {
				let octal = escape
				for (let count = 1; count < 3; count += 1) {
					const next = this.#text[this.#index]
					if (next === undefined || !/[0-7]/u.test(next)) break
					octal += next
					this.#index += 1
				}
				result += String.fromCharCode(Number.parseInt(octal, 8))
				continue
			}
			if (escape === "U") {
				const hexadecimal = this.#text.slice(this.#index, this.#index + 4)
				if (!/^[0-9A-Fa-f]{4}$/u.test(hexadecimal))
					throw new GlyphsParseError(
						"Expected four hexadecimal digits after \\U.",
						this.#index,
					)
				result += String.fromCharCode(Number.parseInt(hexadecimal, 16))
				this.#index += 4
				continue
			}
			if (escape === "\n") continue
			// OpenStep accepts an escaped literal for otherwise ordinary characters.
			result += escape
		}
		throw new GlyphsParseError("Unterminated quoted string.", this.#index)
	}

	#data(): string {
		const start = this.#index
		this.#expect("<")
		while (this.#index < this.#text.length && this.#text[this.#index] !== ">") {
			this.#index += 1
			if (this.#index - start > GlyphsPlistParser.maxTokenLength)
				throw new GlyphsParseError("Data exceeds the 1 MiB token limit.", start)
		}
		if (!this.#take(">"))
			throw new GlyphsParseError("Unterminated data value.", start)
		return this.#text.slice(start, this.#index)
	}

	#atom(): string {
		const start = this.#index
		while (this.#index < this.#text.length) {
			const character = this.#text[this.#index]
			if (character === undefined || /[\s{}()=;,<>]/u.test(character)) break
			this.#index += 1
			if (this.#index - start > GlyphsPlistParser.maxTokenLength)
				throw new GlyphsParseError("Atom exceeds the 1 MiB token limit.", start)
		}
		if (start === this.#index)
			throw new GlyphsParseError("Expected a property-list value.", this.#index)
		return this.#text.slice(start, this.#index)
	}

	#skipTrivia(): void {
		for (;;) {
			while (/\s/u.test(this.#text[this.#index] ?? "")) this.#index += 1
			if (this.#text.startsWith("//", this.#index)) {
				const end = this.#text.indexOf("\n", this.#index + 2)
				this.#index = end < 0 ? this.#text.length : end + 1
				continue
			}
			if (this.#text.startsWith("/*", this.#index)) {
				const end = this.#text.indexOf("*/", this.#index + 2)
				if (end < 0)
					throw new GlyphsParseError("Unterminated block comment.", this.#index)
				this.#index = end + 2
				continue
			}
			return
		}
	}

	#expect(character: string): void {
		this.#skipTrivia()
		if (!this.#take(character))
			throw new GlyphsParseError(
				`Expected ${JSON.stringify(character)}.`,
				this.#index,
			)
	}

	#take(character: string): boolean {
		if (this.#text[this.#index] !== character) return false
		this.#index += 1
		return true
	}

	#enterCollection(): void {
		this.#depth += 1
		if (this.#depth > GlyphsPlistParser.maxDepth)
			throw new GlyphsParseError(
				`Property list exceeds the maximum nesting depth of ${GlyphsPlistParser.maxDepth}.`,
				this.#index,
			)
	}
}

function position(
	text: string,
	offset: number,
): { line: number; column: number } {
	let line = 1
	let lineStart = 0
	for (let index = 0; index < offset; index += 1) {
		if (text.charCodeAt(index) !== 10) continue
		line += 1
		lineStart = index + 1
	}
	return { line, column: offset - lineStart + 1 }
}

function exceedsUtf8ByteLength(text: string, limit: number): boolean {
	let bytes = 0
	for (let index = 0; index < text.length; index += 1) {
		const codeUnit = text.charCodeAt(index)
		if (codeUnit <= 0x7f) bytes += 1
		else if (codeUnit <= 0x7ff) bytes += 2
		else if (
			codeUnit >= 0xd800 &&
			codeUnit <= 0xdbff &&
			text.charCodeAt(index + 1) >= 0xdc00 &&
			text.charCodeAt(index + 1) <= 0xdfff
		) {
			bytes += 4
			index += 1
		} else bytes += 3
		if (bytes > limit) return true
	}
	return false
}

function dictionary(
	value: GlyphsSourceValue | undefined,
): GlyphsSourceDictionary | undefined {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as GlyphsSourceDictionary)
		: undefined
}

function string(value: GlyphsSourceValue | undefined): string | undefined {
	return typeof value === "string" ? value : undefined
}

function number(value: GlyphsSourceValue | undefined): number | undefined {
	const text = string(value)
	if (text === undefined || text.trim() === "") return undefined
	const parsed = Number(text)
	return Number.isFinite(parsed) ? parsed : undefined
}

/** Parse a bounded editable Glyphs 2 or 3 text source without lowering it. */
export function parseGlyphsSource(text: string): GlyphsSourceParseResult {
	if (exceedsUtf8ByteLength(text, 33_554_432)) {
		return {
			ok: false,
			errors: [
				{
					severity: "error",
					code: "glyphs.resource_limit",
					path: "$",
					message: "Glyphs source exceeds the 32 MiB import limit.",
				},
			],
		}
	}
	if (text.startsWith("bplist00")) {
		return {
			ok: false,
			errors: [
				{
					severity: "error",
					code: "glyphs.parse",
					path: "$",
					message:
						"Binary property lists are not supported; save an editable text .glyphs file from Glyphs.app.",
				},
			],
		}
	}
	let value: GlyphsSourceValue
	try {
		value = new GlyphsPlistParser(text).parse()
	} catch (error) {
		const parseError = error instanceof GlyphsParseError ? error : undefined
		const location = position(text, parseError?.offset ?? 0)
		const resourceLimit =
			parseError === undefined
				? false
				: /limit|nesting depth/u.test(parseError.message)
		return {
			ok: false,
			errors: [
				{
					severity: "error",
					code: resourceLimit ? "glyphs.resource_limit" : "glyphs.parse",
					path: "$",
					message:
						parseError?.message ?? "The Glyphs source could not be parsed.",
					span: {
						start: parseError?.offset ?? 0,
						end: Math.min(text.length, (parseError?.offset ?? 0) + 1),
						...location,
					},
				},
			],
		}
	}
	const root = dictionary(value)
	if (root === undefined) {
		return {
			ok: false,
			errors: [
				{
					severity: "error",
					code: "glyphs.invalid_value",
					path: "$",
					message: "A Glyphs source must have a dictionary at its root.",
				},
			],
		}
	}
	const parsedFormatVersion =
		number(root[".formatVersion"] ?? root.formatVersion) ?? 2
	if (
		!Number.isInteger(parsedFormatVersion) ||
		parsedFormatVersion < 2 ||
		parsedFormatVersion > 3
	) {
		const declaredFormatVersion =
			string(root[".formatVersion"] ?? root.formatVersion) ??
			parsedFormatVersion
		return {
			ok: false,
			errors: [
				{
					severity: "error",
					code: "glyphs.unsupported_version",
					path: "$.formatVersion",
					message: `Glyphs format version ${JSON.stringify(declaredFormatVersion)} is not supported; expected version 2 or 3.`,
				},
			],
		}
	}
	const document: GlyphsSourceDocument = {
		format: "glyphs.source",
		formatVersion: parsedFormatVersion as 2 | 3,
		root,
		rawSource: text,
	}
	return { ok: true, value: document }
}
