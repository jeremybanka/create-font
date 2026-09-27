import { defineConfig } from "vite-plus"

export default defineConfig({
	pack: [
		{
			clean: true,
			deps: {
				// tsdown <0.23 compatibility: resolve external dependency subpaths.
				// Remove to preserve subpath imports as written (the new default).
				// https://tsdown.dev/options/dependencies#deps-resolvedepsubpath
				resolveDepSubpath: true,
				dts: {
					neverBundle: [/^[\w@]/],
				},
				neverBundle: true,
				onlyBundle: [],
			},
			dts: {
				entry: [
					"src/index.ts",
					"src/client.ts",
					"src/server.ts",
					"src/node.ts",
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
	test: {
		include: ["tests/**/*.test.ts"],
	},
})
