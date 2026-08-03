#!/usr/bin/env node

import { readFile, readdir, stat } from "node:fs/promises"
import { basename, dirname, join, resolve, sep } from "node:path"
import { pathToFileURL } from "node:url"

import {
	CompletionItemKind,
	createConnection,
	DidChangeWatchedFilesNotification,
	Files,
	MarkupKind,
	ProposedFeatures,
	SymbolKind,
	TextDocumentSyncKind,
	TextDocuments,
	WatchKind,
	type CompletionItem,
	type Diagnostic,
	type DocumentSymbol,
	type Hover,
	type InitializeParams,
	type InitializeResult,
	type Range,
} from "vscode-languageserver/node"
import { TextDocument } from "vscode-languageserver-textdocument"

import {
	FeaLineIndex,
	feaSyntaxTokensAtOffset,
	type FeaAnalysisDocument,
	type FeaAnalysisDiagnostic,
	type FeaSyntaxNode,
	type FeaSyntaxToken,
} from "@create-font/source"

import { analyzeFontProjectFeatures } from "./fea-project.ts"

const WATCH_PATTERNS = [
	`**/features/**/*.fea`,
	`**/features/index.json`,
	`**/glyphs/index.json`,
	`**/glyphs/**/*.json`,
	`**/create-font.json`,
] as const
const FEA_KEYWORDS = [
	`anchor`,
	`by`,
	`enum`,
	`exclude_dflt`,
	`feature`,
	`from`,
	`ignore`,
	`include`,
	`languagesystem`,
	`language`,
	`lookup`,
	`lookupflag`,
	`markClass`,
	`pos`,
	`required`,
	`script`,
	`sub`,
	`subtable`,
	`table`,
] as const

type OpenDocument = {
	readonly path: string
	readonly text: string
	readonly uri: string
	readonly version: number
}

function log(level: `debug` | `error` | `info`, message: string): void {
	const configured = process.env.CREATE_FONT_FEA_LOG_LEVEL ?? `info`
	const rank = { debug: 0, info: 1, error: 2, off: 3 } as const
	if ((rank[configured as keyof typeof rank] ?? 1) > rank[level]) return
	process.stderr.write(
		`${JSON.stringify({ level, message, source: `create-font-fea-lsp` })}\n`,
	)
}

function filePath(uri: string): string | undefined {
	return Files.uriToFilePath(uri) ?? undefined
}

async function isFile(path: string): Promise<boolean> {
	return (await stat(path).catch(() => undefined))?.isFile() === true
}

export async function findFontProjectRoot(
	inputPath: string,
): Promise<string | undefined> {
	let current = resolve(dirname(inputPath))
	for (;;) {
		if (await isFile(join(current, `create-font.json`))) return current
		const parent = dirname(current)
		if (parent === current) return
		current = parent
	}
}

async function workspaceProjectRoots(workspaceRoot: string): Promise<string[]> {
	const roots: string[] = []
	if (await isFile(join(workspaceRoot, `create-font.json`)))
		roots.push(workspaceRoot)
	const fontsRoot = join(workspaceRoot, `fonts`)
	for (const entry of await readdir(fontsRoot, { withFileTypes: true }).catch(
		() => [],
	))
		if (
			entry.isDirectory() &&
			!entry.isSymbolicLink() &&
			(await isFile(join(fontsRoot, entry.name, `create-font.json`)))
		)
			roots.push(join(fontsRoot, entry.name))
	return roots.toSorted()
}

export function feaDiagnosticToLsp(
	source: string,
	diagnostic: FeaAnalysisDiagnostic,
): Diagnostic {
	const index = new FeaLineIndex(source)
	return {
		code: diagnostic.code,
		message: diagnostic.message,
		range: {
			end: index.position(diagnostic.range.end),
			start: index.position(diagnostic.range.start),
		},
		severity:
			diagnostic.severity === `error`
				? 1
				: diagnostic.severity === `warning`
					? 2
					: 3,
		source: `create-font-fea`,
	}
}

export function createFeaInitializeResult(
	params?: InitializeParams,
): InitializeResult {
	return {
		capabilities: {
			completionProvider: { triggerCharacters: [` `, `@`, `.`] },
			documentSymbolProvider: true,
			hoverProvider: true,
			textDocumentSync: TextDocumentSyncKind.Incremental,
			workspace: {
				workspaceFolders: {
					changeNotifications:
						params?.capabilities.workspace?.workspaceFolders === true,
					supported: true,
				},
			},
		},
		serverInfo: { name: `create-font-fea-lsp` },
	}
}

function allNodes(node: FeaSyntaxNode): readonly FeaSyntaxNode[] {
	return node.children.flatMap((child): readonly FeaSyntaxNode[] =>
		child.type === `node` ? [child, ...allNodes(child)] : [],
	)
}

function allTokens(node: FeaSyntaxNode): readonly FeaSyntaxToken[] {
	return node.children.flatMap((child): readonly FeaSyntaxToken[] =>
		child.type === `token` ? [child] : allTokens(child),
	)
}

function symbolName(node: FeaSyntaxNode): string | undefined {
	const tokens = allTokens(node)
	switch (node.kind) {
		case `FeatureNode`:
			return tokens.find((token) => token.kind === `Tag`)?.text
		case `LookupBlockNode`:
			return tokens.find((token) => token.kind === `Label`)?.text
		case `TableNode`:
			return tokens.find(
				(token) => token.kind === `Tag` || token.kind === `Ident`,
			)?.text
		case `GlyphClassDefNode`:
			return tokens.find((token) => token.kind === `NamedGlyphClass`)?.text
	}
	return
}

function symbolKind(node: FeaSyntaxNode): SymbolKind {
	if (node.kind === `GlyphClassDefNode`) return SymbolKind.Array
	if (node.kind === `FeatureNode`) return SymbolKind.Namespace
	if (node.kind === `TableNode`) return SymbolKind.Struct
	return SymbolKind.Function
}

export function createFeaDocumentSymbols(
	document: FeaAnalysisDocument,
): DocumentSymbol[] {
	const index = new FeaLineIndex(document.source)
	return allNodes(document.syntax.root).flatMap((node) => {
		const name = symbolName(node)
		if (!name) return []
		const range: Range = {
			end: index.position(index.fromBytes(node.range).end),
			start: index.position(index.fromBytes(node.range).start),
		}
		return [
			{
				kind: symbolKind(node),
				name,
				range,
				selectionRange: range,
			},
		]
	})
}

async function projectGlyphs(root: string): Promise<
	readonly {
		readonly export: boolean
		readonly id: string
		readonly name: string
	}[]
> {
	const entries = JSON.parse(
		await readFile(join(root, `glyphs`, `index.json`), `utf8`),
	) as readonly { readonly id: string; readonly path: string }[]
	return Promise.all(
		entries.map(async (entry) => {
			const glyph = JSON.parse(
				await readFile(join(root, entry.path), `utf8`),
			) as { readonly export?: boolean; readonly name: string }
			return {
				export: glyph.export ?? true,
				id: entry.id,
				name: glyph.name,
			}
		}),
	)
}

export async function startFeaLanguageServer(): Promise<void> {
	const connection = createConnection(
		ProposedFeatures.all,
		process.stdin,
		process.stdout,
	)
	const documents = new TextDocuments(TextDocument)
	const open = new Map<string, OpenDocument>()
	const projectRoots = new Set<string>()
	const generations = new Map<string, number>()
	const timers = new Map<string, NodeJS.Timeout>()
	const analysisDocuments = new Map<string, FeaAnalysisDocument>()
	const publishedUris = new Map<string, Set<string>>()
	let supportsDynamicWatchedFiles = false
	let supportsWorkspaceFolders = false

	const analyzeRoot = async (
		root: string,
		generation: number,
	): Promise<void> => {
		try {
			const overrides = new Map(
				[...open.values()]
					.filter((document) => document.path.startsWith(`${root}${sep}`))
					.map((document) => [document.path, document.text] as const),
			)
			const analysis = await analyzeFontProjectFeatures(
				root,
				undefined,
				overrides,
			)
			if (generations.get(root) !== generation) return
			const diagnosticsByPath = new Map<string, FeaAnalysisDiagnostic[]>()
			for (const diagnostic of analysis.diagnostics) {
				const list = diagnosticsByPath.get(diagnostic.path) ?? []
				list.push(diagnostic)
				diagnosticsByPath.set(diagnostic.path, list)
			}
			const nextPublishedUris = new Set<string>()
			const nextDocumentPaths = new Set<string>()
			for (const document of analysis.documents) {
				const absolute = join(root, document.path)
				nextDocumentPaths.add(absolute)
				analysisDocuments.set(absolute, document)
				const openDocument = open.get(absolute)
				const uri = openDocument?.uri ?? pathToFileURL(absolute).href
				nextPublishedUris.add(uri)
				await connection.sendDiagnostics({
					diagnostics: (diagnosticsByPath.get(document.path) ?? []).map(
						(diagnostic) => feaDiagnosticToLsp(document.source, diagnostic),
					),
					uri,
					...(openDocument ? { version: openDocument.version } : {}),
				})
			}
			for (const uri of publishedUris.get(root) ?? [])
				if (!nextPublishedUris.has(uri))
					await connection.sendDiagnostics({ diagnostics: [], uri })
			for (const path of analysisDocuments.keys())
				if (path.startsWith(`${root}${sep}`) && !nextDocumentPaths.has(path))
					analysisDocuments.delete(path)
			publishedUris.set(root, nextPublishedUris)
			log(
				`info`,
				`analyzed ${basename(root)} (${analysis.diagnostics.length} diagnostics)`,
			)
		} catch (error) {
			log(
				`error`,
				error instanceof Error ? (error.stack ?? error.message) : String(error),
			)
		}
	}

	const schedule = (root: string): void => {
		const generation = (generations.get(root) ?? 0) + 1
		generations.set(root, generation)
		const previous = timers.get(root)
		if (previous) clearTimeout(previous)
		timers.set(
			root,
			setTimeout(() => {
				timers.delete(root)
				void analyzeRoot(root, generation)
			}, 75),
		)
	}

	connection.onInitialize(async (params: InitializeParams) => {
		supportsWorkspaceFolders =
			params.capabilities.workspace?.workspaceFolders === true
		supportsDynamicWatchedFiles =
			params.capabilities.workspace?.didChangeWatchedFiles
				?.dynamicRegistration === true
		const folders =
			params.workspaceFolders?.flatMap((folder) => {
				const path = filePath(folder.uri)
				return path ? [path] : []
			}) ??
			(params.rootUri && filePath(params.rootUri)
				? [filePath(params.rootUri)!]
				: [])
		for (const folder of folders)
			for (const root of await workspaceProjectRoots(folder))
				projectRoots.add(root)
		return createFeaInitializeResult(params)
	})

	connection.onInitialized(async () => {
		if (supportsDynamicWatchedFiles)
			await connection.client
				.register(DidChangeWatchedFilesNotification.type, {
					watchers: WATCH_PATTERNS.map((globPattern) => ({
						globPattern,
						kind: WatchKind.Create | WatchKind.Change | WatchKind.Delete,
					})),
				})
				.catch(() => undefined)
		for (const root of projectRoots) schedule(root)
		if (supportsWorkspaceFolders)
			connection.workspace.onDidChangeWorkspaceFolders(
				async ({ added, removed }) => {
					for (const folder of removed) {
						const path = filePath(folder.uri)
						if (path)
							for (const root of projectRoots)
								if (root === path || root.startsWith(`${path}${sep}`))
									projectRoots.delete(root)
					}
					for (const folder of added) {
						const path = filePath(folder.uri)
						if (path)
							for (const root of await workspaceProjectRoots(path)) {
								projectRoots.add(root)
								schedule(root)
							}
					}
				},
			)
	})

	documents.onDidOpen(async ({ document }) => {
		const path = filePath(document.uri)
		if (!path || !path.endsWith(`.fea`)) return
		open.set(path, {
			path,
			text: document.getText(),
			uri: document.uri,
			version: document.version,
		})
		const root = await findFontProjectRoot(path)
		if (root) {
			projectRoots.add(root)
			schedule(root)
		}
	})
	documents.onDidChangeContent(async ({ document }) => {
		const path = filePath(document.uri)
		if (!path || !path.endsWith(`.fea`)) return
		open.set(path, {
			path,
			text: document.getText(),
			uri: document.uri,
			version: document.version,
		})
		const root = await findFontProjectRoot(path)
		if (root) schedule(root)
	})
	documents.onDidClose(async ({ document }) => {
		const path = filePath(document.uri)
		if (!path) return
		open.delete(path)
		const root = await findFontProjectRoot(path)
		if (root) schedule(root)
	})
	connection.onDidChangeWatchedFiles(() => {
		for (const root of projectRoots) schedule(root)
	})
	connection.onCompletion(
		async ({ textDocument }): Promise<CompletionItem[]> => {
			const path = filePath(textDocument.uri)
			if (!path) return []
			const root = await findFontProjectRoot(path)
			const glyphs = root ? await projectGlyphs(root).catch(() => []) : []
			return [
				...FEA_KEYWORDS.map((label) => ({
					kind: CompletionItemKind.Keyword,
					label,
				})),
				...glyphs
					.filter((glyph) => glyph.export)
					.map((glyph) => ({
						detail: glyph.id,
						kind: CompletionItemKind.Value,
						label: glyph.name,
					})),
			]
		},
	)
	connection.onDocumentSymbol(({ textDocument }) => {
		const path = filePath(textDocument.uri)
		const document = path ? analysisDocuments.get(path) : undefined
		return document ? createFeaDocumentSymbols(document) : []
	})
	connection.onHover(
		async ({ position, textDocument }): Promise<Hover | null> => {
			const path = filePath(textDocument.uri)
			if (!path) return null
			const document = analysisDocuments.get(path)
			if (!document) return null
			const offset = new FeaLineIndex(document.source).offset(
				position.line,
				position.character,
			)
			const token = feaSyntaxTokensAtOffset(document, offset).find(
				(candidate) => candidate.kind === `GlyphName`,
			)
			if (!token) return null
			const root = await findFontProjectRoot(path)
			const glyph = root
				? (await projectGlyphs(root).catch(() => [])).find(
						(candidate) => candidate.name === token.text,
					)
				: undefined
			if (!glyph) return null
			return {
				contents: {
					kind: MarkupKind.Markdown,
					value: `**${glyph.name}**  \n${glyph.id}${glyph.export ? `` : ` (not exported)`}`,
				},
			}
		},
	)

	documents.listen(connection)
	connection.listen()
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? ``).href)
	await startFeaLanguageServer()
