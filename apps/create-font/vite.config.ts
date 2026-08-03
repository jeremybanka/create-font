import { resolve } from "node:path"

import preact from "@preact/preset-vite"
import { defineConfig } from "vite-plus"

import { DEFAULT_DEV_PORT } from "../../scripts/dev-ports.ts"

const backendPort = Number(
	process.env.CREATE_FONT_BACKEND_PORT ?? DEFAULT_DEV_PORT + 1,
)
if (!Number.isInteger(backendPort) || backendPort < 1 || backendPort > 65_535) {
	throw new Error(`CREATE_FONT_BACKEND_PORT must be a valid TCP port.`)
}
const backend = `http://127.0.0.1:${backendPort}`

export default defineConfig({
	plugins: [preact()],
	resolve: {
		alias: {
			"@create-font/editor/browser": resolve(
				import.meta.dirname,
				`../../packages/create-font/editor/src/browser.ts`,
			),
		},
		conditions: [`development`],
	},
	define: {
		__CREATE_FONT_DEVELOPMENT__: `true`,
	},
	root: resolve(import.meta.dirname, `public`),
	server: {
		proxy: {
			"/api": {
				target: backend,
				ws: true,
			},
		},
	},
})
