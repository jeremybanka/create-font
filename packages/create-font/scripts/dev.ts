import { spawn } from "node:child_process"
import { resolve } from "node:path"

const packageRoot = resolve(import.meta.dirname, `..`)
const workspaceRoot = resolve(packageRoot, `../..`)
const backendPort = 3001
const vpEntrypoint = resolve(workspaceRoot, `node_modules/vite-plus/bin/vp`)

const subprocesses = [
	spawn(
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
	spawn(
		process.execPath,
		[
			vpEntrypoint,
			`dev`,
			`./public`,
			`--config=./vite.config.ts`,
			`--host=127.0.0.1`,
			`--port=3000`,
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
]

let stopping = false
function stop(): void {
	if (stopping) return
	stopping = true
	for (const subprocess of subprocesses) subprocess.kill()
}

process.on(`SIGINT`, stop)
process.on(`SIGTERM`, stop)

function exited(subprocess: (typeof subprocesses)[number]): Promise<number> {
	return new Promise((resolveExit, reject) => {
		subprocess.once(`error`, reject)
		subprocess.once(`exit`, (code, signal) => {
			resolveExit(code ?? (signal === `SIGTERM` ? 143 : 1))
		})
	})
}

const exits = subprocesses.map(exited)
const exitCode = await Promise.race(exits)
stop()
await Promise.all(exits)

if (exitCode !== 0 && exitCode !== 143) {
	process.exitCode = exitCode
}
