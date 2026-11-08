import type { KnipConfig } from "knip"

// Public source entrypoints remain roots, including CLIs, workers, and conditional exports.
// Formatter plugins and JSON schemas are loaded by configuration paths, not imports.
// Fixture source is an executable test input and can keep development dependencies live.
// Generated distributions are checked through their authored source entrypoints.
export default {
	workspaces: {
		".": {
			entry: ["scripts/*.{ts,tsx}"],
			project: ["*.{ts,tsx,js,cjs,mjs}", "scripts/**/*.{ts,tsx,js,cjs,mjs}"],
			ignoreDependencies: [
				"@dprint/json",
				"@dprint/markdown",
				"@dprint/oxc",
				"@dprint/toml",
				"dprint-plugin-malva",
				"dprint-plugin-yaml",
				// Dprint loads the locally built plugin.wasm.
				"dprint-plugin-fea",
				// Keep workspace CLIs available for manual contributor use.
				"@create-art/source-format",
				"create-design",
				"create-font",
			],
		},
		"apps/create-design": {
			entry: [
				"src/server.ts!",
				"src/source-service.ts!",
				"src/create-design-cli.ts!",
				"src/design-cli.ts!",
				"vitest.config.ts",
				"eslint.config.ts",
				"scripts/**/*.{ts,tsx,js,mjs,cjs}",
				"tests/fixtures/**/*.{ts,tsx,js,mjs,cjs}",
			],
			project: [
				"*.{ts,tsx,js,cjs,mjs}",
				"{src,bin}/**/*.{ts,tsx,js,cjs,mjs}!",
				"{tests,__tests__,__scripts__,examples,docs,__exhibits__}/**/*.{ts,tsx,js,cjs,mjs}",
				"scripts/**/*.{ts,tsx,js,mjs,cjs}",
			],
		},
		"apps/create-font": {
			entry: [
				"src/server.ts!",
				"src/rpc.ts!",
				"src/rpc-client.ts!",
				"src/create-font-cli.ts!",
				"src/fea-lsp.ts!",
				"src/font-cli.ts!",
				"vitest.e2e.config.ts",
				"vitest.config.ts",
				"src/fea-vscode-extension.ts!",
				"scripts/**/*.{ts,tsx,js,mjs,cjs}",
			],
			project: [
				"*.{ts,tsx,js,cjs,mjs}",
				"{src,bin}/**/*.{ts,tsx,js,cjs,mjs}!",
				"{tests,__tests__,__scripts__,examples,docs,__exhibits__}/**/*.{ts,tsx,js,cjs,mjs}",
				"scripts/**/*.{ts,tsx,js,mjs,cjs}",
			],
			ignoreDependencies: [
				"@create-font/fea-rs-wasm",
				"@vscode/vsce",
				// Provided by the VS Code extension host.
				"vscode",
			],
		},
		"packages/create-art/editor": {
			entry: ["src/index.ts!", "scripts/**/*.{ts,tsx,js,mjs,cjs}"],
			project: [
				"*.{ts,tsx,js,cjs,mjs}",
				"{src,bin}/**/*.{ts,tsx,js,cjs,mjs}!",
				"{tests,__tests__,__scripts__,examples,docs,__exhibits__}/**/*.{ts,tsx,js,cjs,mjs}",
				"scripts/**/*.{ts,tsx,js,mjs,cjs}",
			],
		},
		"packages/create-art/source-format": {
			entry: ["src/browser.ts!", "src/index.ts!", "src/cli.ts!"],
			project: [
				"*.{ts,tsx,js,cjs,mjs}",
				"{src,bin}/**/*.{ts,tsx,js,cjs,mjs}!",
				"{tests,__tests__,__scripts__,examples,docs,__exhibits__}/**/*.{ts,tsx,js,cjs,mjs}",
			],
		},
		"packages/create-art/source-rpc": {
			entry: [
				"src/index.ts!",
				"src/client.ts!",
				"src/server.ts!",
				"src/node.ts!",
			],
			project: [
				"*.{ts,tsx,js,cjs,mjs}",
				"{src,bin}/**/*.{ts,tsx,js,cjs,mjs}!",
				"{tests,__tests__,__scripts__,examples,docs,__exhibits__}/**/*.{ts,tsx,js,cjs,mjs}",
			],
		},
		"packages/create-art/ui-layout": {
			entry: [
				"src/index.ts!",
				"src/client.ts!",
				"src/node.ts!",
				"src/server.ts!",
				"scripts/**/*.{ts,tsx,js,mjs,cjs}",
			],
			project: [
				"*.{ts,tsx,js,cjs,mjs}",
				"{src,bin}/**/*.{ts,tsx,js,cjs,mjs}!",
				"{tests,__tests__,__scripts__,examples,docs,__exhibits__}/**/*.{ts,tsx,js,cjs,mjs}",
				"scripts/**/*.{ts,tsx,js,mjs,cjs}",
			],
		},
		"packages/create-art/vector-geometry": {
			entry: ["src/index.ts!"],
			project: [
				"*.{ts,tsx,js,cjs,mjs}",
				"{src,bin}/**/*.{ts,tsx,js,cjs,mjs}!",
				"{tests,__tests__,__scripts__,examples,docs,__exhibits__}/**/*.{ts,tsx,js,cjs,mjs}",
			],
		},
		"packages/create-design/ai": {
			entry: ["src/index.ts!"],
			project: [
				"*.{ts,tsx,js,cjs,mjs}",
				"{src,bin}/**/*.{ts,tsx,js,cjs,mjs}!",
				"{tests,__tests__,__scripts__,examples,docs,__exhibits__}/**/*.{ts,tsx,js,cjs,mjs}",
			],
		},
		"packages/create-design/editor": {
			entry: [
				"src/browser-api.ts!",
				"src/browser.ts!",
				"src/source-session.ts!",
				"vitest.config.ts",
				"eslint.config.ts",
				"scripts/**/*.{ts,tsx,js,mjs,cjs}",
			],
			project: [
				"*.{ts,tsx,js,cjs,mjs}",
				"{src,bin}/**/*.{ts,tsx,js,cjs,mjs}!",
				"{tests,__tests__,__scripts__,examples,docs,__exhibits__}/**/*.{ts,tsx,js,cjs,mjs}",
				"scripts/**/*.{ts,tsx,js,mjs,cjs}",
			],
		},
		"packages/create-design/model": {
			entry: ["src/index.ts!"],
			project: [
				"*.{ts,tsx,js,cjs,mjs}",
				"{src,bin}/**/*.{ts,tsx,js,cjs,mjs}!",
				"{tests,__tests__,__scripts__,examples,docs,__exhibits__}/**/*.{ts,tsx,js,cjs,mjs}",
			],
		},
		"packages/create-design/pdf": {
			entry: ["src/index.ts!", "scripts/**/*.{ts,tsx,js,mjs,cjs}"],
			project: [
				"*.{ts,tsx,js,cjs,mjs}",
				"{src,bin}/**/*.{ts,tsx,js,cjs,mjs}!",
				"{tests,__tests__,__scripts__,examples,docs,__exhibits__}/**/*.{ts,tsx,js,cjs,mjs}",
				"scripts/**/*.{ts,tsx,js,mjs,cjs}",
			],
		},
		"packages/create-design/png": {
			entry: ["src/index.ts!", "scripts/**/*.{ts,tsx,js,mjs,cjs}"],
			project: [
				"*.{ts,tsx,js,cjs,mjs}",
				"{src,bin}/**/*.{ts,tsx,js,cjs,mjs}!",
				"{tests,__tests__,__scripts__,examples,docs,__exhibits__}/**/*.{ts,tsx,js,cjs,mjs}",
				"scripts/**/*.{ts,tsx,js,mjs,cjs}",
			],
		},
		"packages/create-design/source": {
			entry: ["src/index.ts!"],
			project: [
				"*.{ts,tsx,js,cjs,mjs}",
				"{src,bin}/**/*.{ts,tsx,js,cjs,mjs}!",
				"{tests,__tests__,__scripts__,examples,docs,__exhibits__}/**/*.{ts,tsx,js,cjs,mjs}",
			],
		},
		"packages/create-design/svg": {
			entry: ["src/index.ts!", "scripts/**/*.{ts,tsx,js,mjs,cjs}"],
			project: [
				"*.{ts,tsx,js,cjs,mjs}",
				"{src,bin}/**/*.{ts,tsx,js,cjs,mjs}!",
				"{tests,__tests__,__scripts__,examples,docs,__exhibits__}/**/*.{ts,tsx,js,cjs,mjs}",
				"scripts/**/*.{ts,tsx,js,mjs,cjs}",
			],
		},
		"packages/create-design/text": {
			entry: ["src/index.ts!"],
			project: [
				"*.{ts,tsx,js,cjs,mjs}",
				"{src,bin}/**/*.{ts,tsx,js,cjs,mjs}!",
				"{tests,__tests__,__scripts__,examples,docs,__exhibits__}/**/*.{ts,tsx,js,cjs,mjs}",
			],
		},
		"packages/create-font/editor": {
			entry: [
				"src/browser-api.ts!",
				"src/browser-build.ts!",
				"vitest.config.ts",
				"eslint.config.ts",
				"scripts/**/*.{ts,tsx,js,mjs,cjs}",
			],
			project: [
				"*.{ts,tsx,js,cjs,mjs}",
				"{src,bin}/**/*.{ts,tsx,js,cjs,mjs}!",
				"{tests,__tests__,__scripts__,examples,docs,__exhibits__}/**/*.{ts,tsx,js,cjs,mjs}",
				"scripts/**/*.{ts,tsx,js,mjs,cjs}",
			],
		},
		"packages/create-font/fea-rs-wasm": {
			entry: [],
			project: [
				"*.{ts,tsx,js,cjs,mjs}",
				"{src,bin}/**/*.{ts,tsx,js,cjs,mjs}!",
				"{tests,__tests__,__scripts__,examples,docs,__exhibits__}/**/*.{ts,tsx,js,cjs,mjs}",
			],
		},
		"packages/create-font/font-service": {
			entry: ["src/index.ts!"],
			project: [
				"*.{ts,tsx,js,cjs,mjs}",
				"{src,bin}/**/*.{ts,tsx,js,cjs,mjs}!",
				"{tests,__tests__,__scripts__,examples,docs,__exhibits__}/**/*.{ts,tsx,js,cjs,mjs}",
			],
		},
		"packages/create-font/glyphs-app": {
			entry: ["src/index.ts!", "src/parser.ts!"],
			project: [
				"*.{ts,tsx,js,cjs,mjs}",
				"{src,bin}/**/*.{ts,tsx,js,cjs,mjs}!",
				"{tests,__tests__,__scripts__,examples,docs,__exhibits__}/**/*.{ts,tsx,js,cjs,mjs}",
			],
		},
		"packages/create-font/server": {
			entry: ["src/index.ts!", "src/client.ts!"],
			project: [
				"*.{ts,tsx,js,cjs,mjs}",
				"{src,bin}/**/*.{ts,tsx,js,cjs,mjs}!",
				"{tests,__tests__,__scripts__,examples,docs,__exhibits__}/**/*.{ts,tsx,js,cjs,mjs}",
			],
		},
		"packages/create-font/source": {
			entry: ["src/index.ts!", "src/browser.ts!"],
			project: [
				"*.{ts,tsx,js,cjs,mjs}",
				"{src,bin}/**/*.{ts,tsx,js,cjs,mjs}!",
				"{tests,__tests__,__scripts__,examples,docs,__exhibits__}/**/*.{ts,tsx,js,cjs,mjs}",
			],
		},
		"packages/create-font/states": {
			entry: [
				"src/index.ts!",
				"eslint.config.ts",
				"tests/fixtures/**/*.{ts,tsx,js,mjs,cjs}",
			],
			project: [
				"*.{ts,tsx,js,cjs,mjs}",
				"{src,bin}/**/*.{ts,tsx,js,cjs,mjs}!",
				"{tests,__tests__,__scripts__,examples,docs,__exhibits__}/**/*.{ts,tsx,js,cjs,mjs}",
			],
		},
		"packages/create-font/target": {
			entry: [
				"src/index.ts!",
				"tests/type-contract.ts",
				"tests/fixtures/**/*.{ts,tsx,js,mjs,cjs}",
			],
			project: [
				"*.{ts,tsx,js,cjs,mjs}",
				"{src,bin}/**/*.{ts,tsx,js,cjs,mjs}!",
				"{tests,__tests__,__scripts__,examples,docs,__exhibits__}/**/*.{ts,tsx,js,cjs,mjs}",
			],
		},
		"packages/dprint-plugin-fea": {
			entry: [],
			project: [
				"*.{ts,tsx,js,cjs,mjs}",
				"{src,bin}/**/*.{ts,tsx,js,cjs,mjs}!",
				"{tests,__tests__,__scripts__,examples,docs,__exhibits__}/**/*.{ts,tsx,js,cjs,mjs}",
			],
		},
	},
	// mise is installed by the repository setup action.
	ignoreBinaries: ["mise"],
	// Preserve compatibility aliases and the two gesture helpers retained for implementation tests.
	ignoreIssues: {
		"scripts/dev-ports.ts": ["duplicates"],
		"packages/create-design/source/src/document.ts": ["duplicates"],
		"packages/create-design/model/src/coordinates.ts": ["duplicates"],
		"packages/create-font/editor/src/{canvas-wheel,transform-gesture}.ts": [
			"files",
		],
	},
	ignore: ["**/dist/**"],
} satisfies KnipConfig
