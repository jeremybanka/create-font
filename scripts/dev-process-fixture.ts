import { spawnDevProcess, superviseDevProcesses } from "./dev-processes.ts"

const pidFile = process.argv[2]
if (pidFile === undefined) throw new Error(`Expected a child PID file path.`)
const nested = spawnDevProcess(
	process.execPath,
	[
		`-e`,
		`require("node:fs").writeFileSync(process.argv[1], String(process.pid)); setInterval(() => {}, 1000)`,
		pidFile,
	],
	{ stdio: `ignore` },
)
await superviseDevProcesses([nested])
