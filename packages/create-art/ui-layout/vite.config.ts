import { defineConfig } from "vite-plus"

export default defineConfig({
	pack: [
		{
			clean: true,
			deps: {
				dts: { neverBundle: [/^[\w@]/] },
				neverBundle: true,
				onlyBundle: [],
			},
			dts: {
				entry: [
					"src/index.ts",
					"src/client.ts",
					"src/node.ts",
					"src/server.ts",
				],
				sourcemap: true,
			},
			entry: {
				client: "src/client.ts",
				index: "src/index.ts",
				node: "src/node.ts",
				server: "src/server.ts",
			},
			format: "esm",
			outDir: "dist",
			sourcemap: true,
		},
	],
	test: { include: ["tests/**/*.test.ts"] },
})
