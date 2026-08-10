import { spawn } from "node:child_process"
import { resolve } from "node:path"

import {
	DEFAULT_DEV_PORT,
	resolveDevPort,
	workspaceDevPorts,
	WORKSPACE_DEV_PORT_COUNT,
} from "./dev-ports.ts"
import { superviseDevProcesses } from "./dev-processes.ts"

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
		`create-sprites UI    http://127.0.0.1:${ports.createSpritesFrontend}/`,
		`create-sprites API   http://127.0.0.1:${ports.createSpritesBackend}/`,
	].join(`\n`) + `\n`,
)

await superviseDevProcesses([
	spawn(
		process.execPath,
		[
			resolve(workspaceRoot, `apps/create-font/scripts/dev.ts`),
			`--port=${ports.createFontFrontend}`,
		],
		{ cwd: workspaceRoot, stdio: `inherit` },
	),
	spawn(
		process.execPath,
		[
			resolve(workspaceRoot, `apps/create-design/scripts/dev.ts`),
			`--port=${ports.createDesignFrontend}`,
		],
		{ cwd: workspaceRoot, stdio: `inherit` },
	),
	spawn(
		process.execPath,
		[
			resolve(workspaceRoot, `apps/create-sprites/scripts/dev.ts`),
			`--port=${ports.createSpritesFrontend}`,
		],
		{ cwd: workspaceRoot, stdio: `inherit` },
	),
])
