import { rm } from "node:fs/promises"
import { resolve } from "node:path"

import { build } from "vite"

const packageRoot = resolve(import.meta.dirname, "..")
const outdir = resolve(packageRoot, "dist")
await rm(outdir, { force: true, recursive: true })
await build({
	configFile: false,
	define: { "process.env.NODE_ENV": JSON.stringify("production") },
	build: {
		emptyOutDir: true,
		lib: {
			cssFileName: "editor",
			entry: resolve(packageRoot, "src/index.ts"),
			fileName: "editor",
			formats: ["es"],
		},
		minify: true,
		outDir: outdir,
		rollupOptions: {
			external:
				/^(?:@radix-ui\/react-icons|konva|react|react-dom|react-konva)(?:\/|$)/,
		},
		sourcemap: true,
	},
})
