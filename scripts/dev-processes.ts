import type { ChildProcess } from "node:child_process"

function exited(subprocess: ChildProcess): Promise<number> {
	return new Promise((resolveExit, reject) => {
		subprocess.once(`error`, reject)
		subprocess.once(`exit`, (code, signal) => {
			resolveExit(
				code ?? (signal === `SIGINT` ? 130 : signal === `SIGTERM` ? 143 : 1),
			)
		})
	})
}

export async function superviseDevProcesses(
	subprocesses: readonly ChildProcess[],
): Promise<void> {
	let stopping = false
	const stop = (): void => {
		if (stopping) return
		stopping = true
		for (const subprocess of subprocesses) subprocess.kill()
	}

	process.on(`SIGINT`, stop)
	process.on(`SIGTERM`, stop)

	const exits = subprocesses.map(exited)
	try {
		const exitCode = await Promise.race(exits)
		const stoppedExternally = stopping
		stop()
		await Promise.all(exits)
		if (!stoppedExternally && exitCode === 0) process.exitCode = 1
		else if (exitCode !== 0 && exitCode !== 130 && exitCode !== 143)
			process.exitCode = exitCode
	} catch (error) {
		stop()
		await Promise.allSettled(exits)
		throw error
	} finally {
		process.off(`SIGINT`, stop)
		process.off(`SIGTERM`, stop)
	}
}
