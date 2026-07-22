import { resolve } from "node:path"

const packageRoot = resolve(import.meta.dir, `..`)
const workspaceRoot = resolve(packageRoot, `../..`)
const backendPort = 3001

const subprocesses = [
	Bun.spawn(
		[
			`bun`,
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
			stderr: `inherit`,
			stdout: `inherit`,
		},
	),
	Bun.spawn(
		[
			resolve(workspaceRoot, `node_modules/vite-plus/bin/vp`),
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
			stderr: `inherit`,
			stdout: `inherit`,
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

const exitCode = await Promise.race(
	subprocesses.map((subprocess) => subprocess.exited),
)
stop()
await Promise.all(subprocesses.map((subprocess) => subprocess.exited))

if (exitCode !== 0 && exitCode !== 143) process.exitCode = exitCode
