import { rm } from "node:fs/promises"
import { resolve } from "node:path"

import { build } from "vite"

import { buildBrowserApplication } from "./build-browser.ts"

const packageRoot = resolve(import.meta.dirname, `..`)
const outdir = resolve(packageRoot, `dist`)

await rm(outdir, { force: true, recursive: true })

const externalPackage = /^[^./]|^\.[^./]|^\.\.[^/]/

await Promise.all([
	build({
		configFile: false,
		define: { __CREATE_FONT_DEVELOPMENT__: `false` },
		build: {
			emptyOutDir: false,
			lib: {
				entry: {
					"create-font-cli": resolve(packageRoot, `src/create-font-cli.ts`),
					"fea-lsp": resolve(packageRoot, `src/fea-lsp.ts`),
					"font-cli": resolve(packageRoot, `src/font-cli.ts`),
					rpc: resolve(packageRoot, `src/rpc.ts`),
					server: resolve(packageRoot, `src/server.ts`),
				},
				fileName: (_format, entryName) => `${entryName}.js`,
				formats: [`es`],
			},
			outDir: outdir,
			rollupOptions: {
				external: externalPackage,
			},
			sourcemap: true,
			target: `node22`,
		},
	}),
	build({
		configFile: false,
		define: { __CREATE_FONT_DEVELOPMENT__: `false` },
		build: {
			emptyOutDir: false,
			lib: {
				entry: {
					"rpc-client": resolve(packageRoot, `src/rpc-client.ts`),
				},
				fileName: (_format, entryName) => `${entryName}.js`,
				formats: [`es`],
			},
			outDir: outdir,
			rollupOptions: {
				external: externalPackage,
			},
			sourcemap: true,
			target: `es2024`,
		},
	}),
	buildBrowserApplication(resolve(outdir, `public`)),
])
