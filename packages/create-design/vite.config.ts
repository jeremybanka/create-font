import { resolve } from "node:path"

import preact from "@preact/preset-vite"
import { defineConfig } from "vite-plus"

import { DEFAULT_DEV_PORT } from "../../scripts/dev-ports.ts"

const backendPort = Number(
	process.env.CREATE_DESIGN_BACKEND_PORT ?? DEFAULT_DEV_PORT + 3,
)
if (!Number.isInteger(backendPort) || backendPort < 1 || backendPort > 65_535) {
	throw new Error(`CREATE_DESIGN_BACKEND_PORT must be a valid TCP port.`)
}
const backend = `http://127.0.0.1:${backendPort}`

export default defineConfig({
	plugins: [preact()],
	resolve: {
		alias: {
			"@create-font/editor/shared": resolve(
				import.meta.dirname,
				`../editor/src/shared.ts`,
			),
			"@create-font/preact-konva": resolve(
				import.meta.dirname,
				`../preact-konva/src/index.ts`,
			),
		},
		conditions: [`development`],
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
