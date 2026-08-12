import { defineConfig } from "vite-plus"

export default defineConfig({
	run: {
		tasks: {
			build: {
				cache: false,
				command: "node ../../../scripts/build-fea-rs-wasm.ts",
			},
		},
	},
	test: {
		include: ["tests/**/*.test.ts"],
	},
})
