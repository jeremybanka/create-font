import { defineConfig } from "vite-plus"

export default defineConfig({
	run: {
		tasks: {
			build: {
				cache: false,
				command: "node ../../../scripts/build-create-design-vello-wasm.ts",
			},
		},
	},
	test: {
		include: ["tests/**/*.test.ts"],
	},
})
