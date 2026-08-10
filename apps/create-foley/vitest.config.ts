import { resolve } from "node:path"

import { defineConfig } from "vite-plus"

export default defineConfig({
	resolve: {
		alias: {
			"@create-foley/audio": resolve(import.meta.dirname, "../../packages/create-foley/audio/src/index.ts"),
			"@create-foley/source": resolve(import.meta.dirname, "../../packages/create-foley/source/src/index.ts"),
		},
	},
	test: { include: ["tests/**/*.test.ts"] },
})
