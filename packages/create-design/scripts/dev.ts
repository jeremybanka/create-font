import { spawn } from "node:child_process"
import { resolve } from "node:path"

import { DEFAULT_DEV_PORT, resolveDevPort } from "../../../scripts/dev-ports.ts"
import { superviseDevProcesses } from "../../../scripts/dev-processes.ts"

const packageRoot = resolve(import.meta.dirname, `..`)
const workspaceRoot = resolve(packageRoot, `../..`)
const frontendPort = resolveDevPort({
	argv: process.argv.slice(2),
	defaultPort: DEFAULT_DEV_PORT + 2,
	...(process.env.CREATE_DESIGN_DEV_PORT === undefined
		? {}
		: { environmentValue: process.env.CREATE_DESIGN_DEV_PORT }),
	portCount: 2,
})
const backendPort = frontendPort + 1
const vpEntrypoint = resolve(workspaceRoot, `node_modules/vite-plus/bin/vp`)

await superviseDevProcesses([
	spawn(
		process.execPath,
		[
			`--watch`,
			`--conditions=development`,
			`./scripts/dev-server.ts`,
			`--root=./dist/dev/source`,
			`--port=${backendPort}`,
		],
		{
			cwd: packageRoot,
			stdio: `inherit`,
		},
	),
	spawn(
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
				CREATE_DESIGN_BACKEND_PORT: String(backendPort),
			},
			stdio: `inherit`,
		},
	),
])
