import { defineConfig } from "vite-plus"

export default defineConfig({
	run: {
		tasks: {
			build: {
				cache: false,
				command: "node ../../scripts/build-dprint-plugin-fea.ts",
				dependsOn: ["@create-font/fea-rs-wasm#build"],
			},
		},
	},
	test: {
		include: ["tests/**/*.test.ts"],
	},
})
