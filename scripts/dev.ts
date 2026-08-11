import { resolve } from "node:path"

import {
	DEFAULT_DEV_PORT,
	resolveDevPort,
	workspaceDevPorts,
	WORKSPACE_DEV_PORT_COUNT,
} from "./dev-ports.ts"
import { spawnDevProcess, superviseDevProcesses } from "./dev-processes.ts"

const workspaceRoot = resolve(import.meta.dirname, `..`)
const ports = workspaceDevPorts(
	resolveDevPort({
		argv: process.argv.slice(2),
		defaultPort: DEFAULT_DEV_PORT,
		...(process.env.CREATE_ART_DEV_PORT === undefined
			? {}
			: { environmentValue: process.env.CREATE_ART_DEV_PORT }),
		portCount: WORKSPACE_DEV_PORT_COUNT,
	}),
)

process.stdout.write(
	[
		`create-font UI       http://127.0.0.1:${ports.createFontFrontend}/`,
		`create-font API      http://127.0.0.1:${ports.createFontBackend}/`,
		`create-design UI     http://127.0.0.1:${ports.createDesignFrontend}/`,
		`create-design API    http://127.0.0.1:${ports.createDesignBackend}/`,
	].join(`\n`) + `\n`,
)

await superviseDevProcesses([
	spawnDevProcess(
		process.execPath,
		[
			resolve(workspaceRoot, `apps/create-font/scripts/dev.ts`),
			`--port=${ports.createFontFrontend}`,
		],
		{ cwd: workspaceRoot, stdio: `inherit` },
	),
	spawnDevProcess(
		process.execPath,
		[
			resolve(workspaceRoot, `apps/create-design/scripts/dev.ts`),
			`--port=${ports.createDesignFrontend}`,
		],
		{ cwd: workspaceRoot, stdio: `inherit` },
	),
])
