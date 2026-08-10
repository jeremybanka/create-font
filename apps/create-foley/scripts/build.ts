import { rm } from "node:fs/promises"
import { resolve } from "node:path"

import { build } from "vite"

const packageRoot = resolve(import.meta.dirname, "..")
const outdir = resolve(packageRoot, "dist")
await rm(outdir, { force: true, recursive: true })
const externalPackage = /^[^./]|^\.[^./]|^\.\.[^/]/

await Promise.all([
	build({
		configFile: false,
		build: {
			emptyOutDir: false,
			lib: {
				entry: {
					"create-foley-cli": resolve(packageRoot, "src/create-foley-cli.ts"),
					"foley-cli": resolve(packageRoot, "src/foley-cli.ts"),
					server: resolve(packageRoot, "src/server.ts"),
				},
				fileName: (_format, entryName) => `${entryName}.js`,
				formats: ["es"],
			},
			outDir: outdir,
			rollupOptions: { external: externalPackage },
			sourcemap: true,
			target: "node22",
		},
	}),
	build({
		configFile: resolve(packageRoot, "vite.config.ts"),
		build: {
			emptyOutDir: false,
			minify: true,
			outDir: outdir,
			sourcemap: true,
			target: "es2024",
		},
	}),
])

// Vite treats files beside the HTML entry as public candidates when the app
// root is `public`; the transformed bundle and fingerprinted favicon are the
// only copies that belong in the distributable.
await Promise.all([
	rm(resolve(outdir, "index.tsx"), { force: true }),
	rm(resolve(outdir, "create-foley-favicon.svg"), { force: true }),
])
