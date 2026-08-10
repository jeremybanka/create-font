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
					"create-sprites-cli": resolve(packageRoot, "src/create-sprites-cli.ts"),
					model: resolve(packageRoot, "src/model.ts"),
					"sprites-cli": resolve(packageRoot, "src/sprites-cli.ts"),
					"server": resolve(packageRoot, "src/server.ts"),
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
			outDir: resolve(outdir, "browser"),
			sourcemap: true,
			target: "es2024",
		},
	}),
])
