import { describe, expect, it } from "vitest"

import { analyzeFeaProject } from "@create-font/source"

import {
	createFeaDocumentSymbols,
	createFeaInitializeResult,
	feaDiagnosticToLsp,
} from "../src/fea-lsp.ts"
import {
	CREATE_FONT_FEA_RESTART_COMMAND,
	CREATE_FONT_FEA_SETTINGS,
	createFontFeaVscodeManifest,
} from "../src/fea-vscode-manifest.ts"

describe(`feature language tooling`, () => {
	it(`advertises only implemented incremental language capabilities`, () => {
		expect(createFeaInitializeResult()).toMatchObject({
			capabilities: {
				completionProvider: {},
				documentSymbolProvider: true,
				hoverProvider: true,
				textDocumentSync: 2,
			},
			serverInfo: { name: `create-font-fea-lsp` },
		})
	})

	it(`maps Wasm byte ranges to LSP UTF-16 positions`, () => {
		const source = `# 😀\nfeature liga {} liga;`
		const start = source.indexOf(`feature`)
		expect(
			feaDiagnosticToLsp(source, {
				code: `fea.test`,
				message: `test`,
				path: `features/layout.fea`,
				range: {
					column: 1,
					end: start + 7,
					line: 2,
					start,
				},
				severity: `error`,
			}),
		).toMatchObject({
			range: {
				end: { character: 7, line: 1 },
				start: { character: 0, line: 1 },
			},
		})
	})

	it(`creates symbols from the Rust-owned syntax projection`, () => {
		const source = `@Upper = [A];\nlookup Replace { sub A by A.alt; } Replace;\nfeature salt { sub A by A.alt; } salt;`
		const analysis = analyzeFeaProject({
			entries: [`features/layout.fea`],
			glyphs: [
				{ id: 0, name: `A` },
				{ id: 1, name: `A.alt` },
			],
			sources: new Map([[`features/layout.fea`, source]]),
		})
		const document = analysis.documents[0]!

		expect(
			createFeaDocumentSymbols(document).map((symbol) => symbol.name),
		).toEqual([`@Upper`, `Replace`, `salt`])
	})

	it(`keeps extension commands, settings, and manifest contributions aligned`, () => {
		const manifest = createFontFeaVscodeManifest(`0.1.0`)
		expect(manifest.contributes.commands).toContainEqual({
			command: CREATE_FONT_FEA_RESTART_COMMAND,
			title: `Create Font: Restart Feature Language Server`,
		})
		expect(manifest.contributes.configuration.properties).toHaveProperty(
			CREATE_FONT_FEA_SETTINGS.trace,
		)
		expect(manifest.contributes.languages[0]).toMatchObject({
			extensions: [`.fea`],
			id: `fea`,
		})
	})
})
