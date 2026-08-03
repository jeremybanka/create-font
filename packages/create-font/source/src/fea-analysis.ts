import {
	lowerFeaSubstitutions,
	type FeaDiagnostic,
	type FeaSourceRange,
	type FeaSyntaxDocument,
	type FeaSyntaxElement,
	type FeaSyntaxNode,
	type FeaSyntaxRange,
	type FeaSyntaxToken,
	type FeatureSubstitutionIr,
} from "./fea-core.ts"

export interface FeaProjectGlyph {
	readonly export?: boolean
	readonly id: number
	readonly name: string
}

export interface FeaAnalysisDiagnostic {
	readonly code: string
	readonly message: string
	readonly path: string
	readonly range: FeaSourceRange
	readonly severity: "error" | "warning" | "info"
}

export interface FeaAnalysisDocument {
	readonly path: string
	readonly source: string
	readonly syntax: FeaSyntaxDocument
}

export interface FeaProjectAnalysis {
	readonly diagnostics: readonly FeaAnalysisDiagnostic[]
	readonly documents: readonly FeaAnalysisDocument[]
	readonly ir: readonly FeatureSubstitutionIr[]
	readonly ok: boolean
}

export interface FeaAnalysisParser {
	readonly parseFea: (source: string) =>
		| {
				readonly ok: true
				readonly value: import("./fea-core.ts").FeaDocumentAst
		  }
		| { readonly ok: false; readonly errors: readonly FeaDiagnostic[] }
	readonly parseFeaSyntax: (source: string) => FeaSyntaxDocument
}

export interface AnalyzeFeaProjectInput {
	/** Indexed entry points, expressed as project-relative POSIX paths. */
	readonly entries: readonly string[]
	readonly glyphs: readonly FeaProjectGlyph[]
	/** Every available feature source, including include-only files. */
	readonly sources: ReadonlyMap<string, string>
}

const emptyRange: FeaSourceRange = {
	column: 1,
	end: 0,
	line: 1,
	start: 0,
}

function normalizePosixPath(path: string): string {
	const parts: string[] = []
	for (const part of path.replaceAll("\\", "/").split("/")) {
		if (part === "" || part === ".") continue
		if (part === ".." && parts.at(-1) !== "..") {
			if (parts.length > 0) parts.pop()
			else parts.push(part)
		} else parts.push(part)
	}
	return parts.join("/")
}

function dirname(path: string): string {
	const slash = path.lastIndexOf("/")
	return slash < 0 ? "" : path.slice(0, slash)
}

/** Per-document conversion between the Wasm ABI's UTF-8 bytes and JS/LSP UTF-16. */
export class FeaLineIndex {
	readonly #byteToUtf16: Uint32Array
	readonly #lineStarts: readonly number[]
	readonly source: string

	constructor(source: string) {
		this.source = source
		const encoded = new TextEncoder().encode(source)
		this.#byteToUtf16 = new Uint32Array(encoded.length + 1)
		let byteOffset = 0
		let utf16Offset = 0
		for (const character of source) {
			const byteLength = new TextEncoder().encode(character).length
			for (let index = 0; index < byteLength; index += 1)
				this.#byteToUtf16[byteOffset + index] = utf16Offset
			byteOffset += byteLength
			utf16Offset += character.length
			this.#byteToUtf16[byteOffset] = utf16Offset
		}
		const lineStarts = [0]
		for (let index = 0; index < source.length; index += 1)
			if (source[index] === "\n") lineStarts.push(index + 1)
		this.#lineStarts = lineStarts
	}

	fromBytes(range: FeaSyntaxRange): FeaSourceRange {
		const last = this.#byteToUtf16.length - 1
		const start = this.#byteToUtf16[Math.max(0, Math.min(range.start, last))]!
		const end = this.#byteToUtf16[Math.max(0, Math.min(range.end, last))]!
		let lineIndex = 0
		for (let low = 0, high = this.#lineStarts.length; low < high;) {
			const middle = (low + high) >>> 1
			if (this.#lineStarts[middle]! <= start) {
				lineIndex = middle
				low = middle + 1
			} else high = middle
		}
		return {
			column: start - this.#lineStarts[lineIndex]! + 1,
			end,
			line: lineIndex + 1,
			start,
		}
	}

	position(offset: number): {
		readonly character: number
		readonly line: number
	} {
		const clamped = Math.max(0, Math.min(offset, this.source.length))
		let lineIndex = 0
		for (let low = 0, high = this.#lineStarts.length; low < high;) {
			const middle = (low + high) >>> 1
			if (this.#lineStarts[middle]! <= clamped) {
				lineIndex = middle
				low = middle + 1
			} else high = middle
		}
		return {
			character: clamped - this.#lineStarts[lineIndex]!,
			line: lineIndex,
		}
	}

	offset(line: number, character: number): number {
		const start =
			this.#lineStarts[
				Math.max(0, Math.min(line, this.#lineStarts.length - 1))
			]!
		return Math.max(start, Math.min(start + character, this.source.length))
	}
}

function isNode(element: FeaSyntaxElement): element is FeaSyntaxNode {
	return element.type === "node"
}

function tokens(node: FeaSyntaxNode): readonly FeaSyntaxToken[] {
	return node.children.flatMap((child): readonly FeaSyntaxToken[] =>
		child.type === "token" ? [child] : tokens(child),
	)
}

function nodes(node: FeaSyntaxNode): readonly FeaSyntaxNode[] {
	return node.children.flatMap((child): readonly FeaSyntaxNode[] =>
		isNode(child) ? [child, ...nodes(child)] : [],
	)
}

function diagnosticCode(diagnostic: FeaDiagnostic): string {
	if (diagnostic.code) return diagnostic.code
	if (diagnostic.message.startsWith("Unsupported create-font"))
		return "fea.unsupported"
	if (diagnostic.message.startsWith("Unknown glyph")) return "fea.unknown_glyph"
	if (diagnostic.message.startsWith("Unexported glyph"))
		return "fea.unexported_glyph"
	return "fea.semantic"
}

function normalizeProjectPath(path: string): string | undefined {
	if (path.startsWith("/") || /^[A-Za-z]:[/\\]/u.test(path)) return
	const normalized = normalizePosixPath(path)
	if (normalized === ".." || normalized.startsWith("../")) return
	return normalized.replace(/^\.\//u, "")
}

function compareDiagnostics(
	left: FeaAnalysisDiagnostic,
	right: FeaAnalysisDiagnostic,
): number {
	return (
		left.path.localeCompare(right.path) ||
		left.range.start - right.range.start ||
		left.code.localeCompare(right.code) ||
		left.message.localeCompare(right.message)
	)
}

function uniqueDiagnostics(
	diagnostics: readonly FeaAnalysisDiagnostic[],
): readonly FeaAnalysisDiagnostic[] {
	const seen = new Set<string>()
	return diagnostics.filter((diagnostic) => {
		const key = `${diagnostic.path}\0${diagnostic.range.start}\0${diagnostic.range.end}\0${diagnostic.code}\0${diagnostic.message}`
		if (seen.has(key)) return false
		seen.add(key)
		return true
	})
}

export function analyzeFeaProjectWithParser(
	input: AnalyzeFeaProjectInput & { readonly parser: FeaAnalysisParser },
): FeaProjectAnalysis {
	const diagnostics: FeaAnalysisDiagnostic[] = []
	const documents = new Map<string, FeaAnalysisDocument>()
	const ir: FeatureSubstitutionIr[] = []
	const exportedGlyphs = new Map(
		input.glyphs
			.filter((glyph) => glyph.export !== false)
			.map((glyph) => [glyph.name, glyph.id] as const),
	)
	const unexportedGlyphs = new Set(
		input.glyphs
			.filter((glyph) => glyph.export === false)
			.map((glyph) => glyph.name),
	)
	const active: string[] = []

	const analyze = (rawPath: string, includeRange?: FeaSourceRange): void => {
		const path = normalizeProjectPath(rawPath)
		if (path === undefined) {
			diagnostics.push({
				code: "fea.include_escape",
				message: `Include path escapes the font project: ${rawPath}.`,
				path: active.at(-1) ?? rawPath,
				range: includeRange ?? emptyRange,
				severity: "error",
			})
			return
		}
		const cycleIndex = active.indexOf(path)
		if (cycleIndex >= 0) {
			diagnostics.push({
				code: "fea.include_cycle",
				message: `Feature include cycle: ${[...active.slice(cycleIndex), path].join(" -> ")}.`,
				path: active.at(-1) ?? path,
				range: includeRange ?? emptyRange,
				severity: "error",
			})
			return
		}
		if (documents.has(path)) return
		const source = input.sources.get(path)
		if (source === undefined) {
			diagnostics.push({
				code: "fea.include_missing",
				message: `Feature source does not exist: ${path}.`,
				path: active.at(-1) ?? path,
				range: includeRange ?? emptyRange,
				severity: "error",
			})
			return
		}
		active.push(path)
		const lineIndex = new FeaLineIndex(source)
		let syntax: FeaSyntaxDocument
		try {
			syntax = input.parser.parseFeaSyntax(source)
		} catch (error) {
			diagnostics.push({
				code: "fea.wasm_initialization",
				message: error instanceof Error ? error.message : String(error),
				path,
				range: emptyRange,
				severity: "error",
			})
			active.pop()
			return
		}
		documents.set(path, { path, source, syntax })
		for (const diagnostic of syntax.diagnostics) {
			diagnostics.push({
				code: diagnostic.code,
				message: diagnostic.message,
				path,
				range: lineIndex.fromBytes(diagnostic.range),
				severity: diagnostic.severity,
			})
		}

		for (const include of nodes(syntax.root).filter(
			(node) => node.kind === "IncludeNode",
		)) {
			const includePath = tokens(include).find((token) => token.kind === "Path")
			if (!includePath) continue
			const resolved = normalizeProjectPath(
				`${dirname(path)}/${includePath.text}`,
			)
			if (resolved === undefined) {
				diagnostics.push({
					code: "fea.include_escape",
					message: `Include path escapes the font project: ${includePath.text}.`,
					path,
					range: lineIndex.fromBytes(includePath.range),
					severity: "error",
				})
			} else analyze(resolved, lineIndex.fromBytes(includePath.range))
		}

		if (
			!syntax.diagnostics.some((diagnostic) => diagnostic.severity === "error")
		) {
			const parsed = input.parser.parseFea(source)
			if (!parsed.ok) {
				for (const diagnostic of parsed.errors)
					diagnostics.push({
						code: diagnosticCode(diagnostic),
						message: diagnostic.message,
						path,
						range: diagnostic.range,
						severity: diagnostic.severity ?? "error",
					})
			} else {
				const lowered = lowerFeaSubstitutions(parsed.value, exportedGlyphs)
				for (const diagnostic of lowered.errors) {
					const match = /^Unknown glyphs?: (.+)\.$/u.exec(diagnostic.message)
					const missing = match?.[1]?.split(", ") ?? []
					const onlyUnexported =
						missing.length > 0 &&
						missing.every((glyph) => unexportedGlyphs.has(glyph))
					diagnostics.push({
						code: onlyUnexported ? "fea.unexported_glyph" : "fea.unknown_glyph",
						message: onlyUnexported
							? `Unexported glyph${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}.`
							: diagnostic.message,
						path,
						range: diagnostic.range,
						severity: "error",
					})
				}
				ir.push(...lowered.ir)
			}
		}
		active.pop()
	}

	for (const entry of [...new Set(input.entries)].toSorted()) analyze(entry)
	const orderedDiagnostics = uniqueDiagnostics(
		diagnostics.toSorted(compareDiagnostics),
	)
	return {
		diagnostics: orderedDiagnostics,
		documents: [...documents.values()].toSorted((left, right) =>
			left.path.localeCompare(right.path),
		),
		ir,
		ok: !orderedDiagnostics.some(
			(diagnostic) => diagnostic.severity === "error",
		),
	}
}

export function feaSyntaxTokensAtOffset(
	document: FeaAnalysisDocument,
	offset: number,
): readonly FeaSyntaxToken[] {
	const encodedBefore = new TextEncoder().encode(
		document.source.slice(0, Math.max(0, offset)),
	).length
	return tokens(document.syntax.root).filter(
		(token) =>
			token.range.start <= encodedBefore && encodedBefore <= token.range.end,
	)
}
