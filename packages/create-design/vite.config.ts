import { resolve } from "node:path"

import preact from "@preact/preset-vite"
import { defineConfig } from "vite-plus"

export default defineConfig({
	plugins: [preact()],
	resolve: {
		alias: {
			"@create-font/editor/shared": resolve(
				import.meta.dirname,
				`../editor/src/shared.ts`,
			),
		},
		conditions: [`development`],
	},
	root: resolve(import.meta.dirname, `public`),
})
