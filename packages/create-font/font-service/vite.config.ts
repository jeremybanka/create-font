import { defineConfig } from "vite-plus"

export default defineConfig({
	pack: [
		{
			clean: true,
			deps: {
				dts: { neverBundle: [/^[\w@]/] },
				onlyBundle: [],
				skipNodeModulesBundle: true,
			},
			dts: { entry: ["src/index.ts"], sourcemap: true },
			entry: { index: "src/index.ts" },
			format: "esm",
			outDir: "dist",
			sourcemap: true,
		},
	],
	test: { include: ["tests/**/*.test.ts"] },
})
