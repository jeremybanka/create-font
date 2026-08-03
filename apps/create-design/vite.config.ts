import { resolve } from "node:path"

import react from "@vitejs/plugin-react"
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
	plugins: [react()],
	resolve: {
		alias: {
			"@create-art/editor": resolve(
				import.meta.dirname,
				`../../packages/create-art/editor/src/index.ts`,
			),
			"@create-art/vector-geometry": resolve(
				import.meta.dirname,
				`../../packages/create-art/vector-geometry/src/index.ts`,
			),
			"@create-design/editor/browser": resolve(
				import.meta.dirname,
				`../../packages/create-design/editor/src/browser.ts`,
			),
			"@create-design/model": resolve(
				import.meta.dirname,
				`../../packages/create-design/model/src/index.ts`,
			),
			"@create-design/pdf": resolve(
				import.meta.dirname,
				`../../packages/create-design/pdf/src/index.ts`,
			),
			"@create-design/source": resolve(
				import.meta.dirname,
				`../../packages/create-design/source/src/index.ts`,
			),
		},
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
