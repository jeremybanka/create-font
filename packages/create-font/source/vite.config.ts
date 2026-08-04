import { defineConfig } from "vite-plus"

export default defineConfig({
	pack: [
		{
			clean: true,
			deps: {
				dts: {
					neverBundle: [/^[\w@]/],
				},
				neverBundle: true,
				onlyBundle: [],
			},
			dts: {
				entry: ["src/index.ts", "src/browser.ts"],
				sourcemap: true,
			},
			entry: {
				browser: "src/browser.ts",
				index: "src/index.ts",
			},
			format: "esm",
			outDir: "dist",
			sourcemap: true,
		},
	],
	test: {
		include: ["tests/**/*.test.ts"],
	},
})
