import { defineConfig } from "vite-plus"

export default defineConfig({
	run: {
		tasks: {
			build: {
				cache: false,
				command: "node ./scripts/build.ts",
				dependsOn: ["@create-design/vello-hybrid-wasm#build"],
			},
		},
	},
	test: {
		include: ["tests/**/*.test.ts"],
	},
})
