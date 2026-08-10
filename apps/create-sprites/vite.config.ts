import { resolve } from "node:path"

import react from "@vitejs/plugin-react"
import { defineConfig } from "vite-plus"

import { DEFAULT_DEV_PORT } from "../../scripts/dev-ports.ts"

const backendPort = Number(process.env.CREATE_SPRITES_BACKEND_PORT ?? DEFAULT_DEV_PORT + 5)
if (!Number.isInteger(backendPort) || backendPort < 1 || backendPort > 65_535) throw new Error(`CREATE_SPRITES_BACKEND_PORT must be a valid TCP port.`)

export default defineConfig({
	plugins: [react()],
	resolve: {
		alias: {
			"@create-art/editor": resolve(import.meta.dirname, "src/shared-editor.ts"),
		},
	},
	root: resolve(import.meta.dirname, "public"),
	server: { proxy: { "/api": { target: `http://127.0.0.1:${backendPort}` } } },
})
