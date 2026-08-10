import { resolve } from "node:path"

import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

import { DEFAULT_DEV_PORT } from "../../scripts/dev-ports.ts"

const backendPort = Number(process.env.CREATE_FOLEY_BACKEND_PORT ?? DEFAULT_DEV_PORT + 5)
if (!Number.isInteger(backendPort) || backendPort < 1 || backendPort > 65_535)
	throw new Error("CREATE_FOLEY_BACKEND_PORT must be a valid TCP port.")

export default defineConfig({
	plugins: [react()],
	publicDir: false,
	resolve: {
		alias: {
			"@create-art/editor": resolve(import.meta.dirname, "../../packages/create-art/editor/src/index.ts"),
			"@create-art/vector-geometry": resolve(import.meta.dirname, "../../packages/create-art/vector-geometry/src/index.ts"),
			"@create-foley/audio": resolve(import.meta.dirname, "../../packages/create-foley/audio/src/index.ts"),
			"@create-foley/editor/browser": resolve(import.meta.dirname, "../../packages/create-foley/editor/src/browser.ts"),
			"@create-foley/source": resolve(import.meta.dirname, "../../packages/create-foley/source/src/index.ts"),
		},
	},
	root: resolve(import.meta.dirname, "public"),
	server: { proxy: { "/api": { target: `http://127.0.0.1:${backendPort}` } } },
})
