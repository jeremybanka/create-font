import { resolve } from "node:path"

import { DEFAULT_DEV_PORT, resolveDevPort } from "../../../scripts/dev-ports.ts"
import {
	spawnDevProcess,
	superviseDevProcesses,
} from "../../../scripts/dev-processes.ts"

await import("./build-development.ts")

const packageRoot = resolve(import.meta.dirname, `..`)
const workspaceRoot = resolve(packageRoot, `../..`)
const frontendPort = resolveDevPort({
	argv: process.argv.slice(2),
	defaultPort: DEFAULT_DEV_PORT,
	...(process.env.CREATE_FONT_DEV_PORT === undefined
		? {}
		: { environmentValue: process.env.CREATE_FONT_DEV_PORT }),
	portCount: 2,
})
const backendPort = frontendPort + 1
const vpEntrypoint = resolve(workspaceRoot, `node_modules/vite-plus/bin/vp`)

await superviseDevProcesses([
	spawnDevProcess(
		process.execPath,
		[
			// A hard restart keeps workspace dependencies and generated source in
			// one revision after an in-place pull. Hot reload can retain old exports.
			`--watch`,
			`--conditions=development`,
			`./src/font-cli.ts`,
			`dev`,
			`--root=../..`,
			`--port=${backendPort}`,
		],
		{
			cwd: packageRoot,
			stdio: `inherit`,
		},
	),
	spawnDevProcess(
		process.execPath,
		[
			vpEntrypoint,
			`dev`,
			`./public`,
			`--config=./vite.config.ts`,
			`--host=127.0.0.1`,
			`--port=${frontendPort}`,
			`--strictPort`,
		],
		{
			cwd: packageRoot,
			env: {
				...process.env,
				CREATE_FONT_BACKEND_PORT: String(backendPort),
			},
			stdio: `inherit`,
		},
	),
])
