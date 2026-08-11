import {
	type ChildProcess,
	type SpawnOptions,
	spawn,
	spawnSync,
} from "node:child_process"

const gracefulShutdownTimeoutMs = 5_000

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

export function spawnDevProcess(
	command: string,
	args: readonly string[],
	options: SpawnOptions,
): ChildProcess {
	return spawn(command, args, {
		...options,
		// A dedicated POSIX group lets the supervisor signal Node --watch, Vite,
		// and their descendants as one lifecycle without touching unrelated peers.
		detached: process.platform !== `win32`,
	})
}

function signalDevProcess(
	subprocess: ChildProcess,
	signal: NodeJS.Signals,
	force: boolean,
): void {
	if (subprocess.exitCode !== null || subprocess.signalCode !== null) return
	const pid = subprocess.pid
	if (pid === undefined) return
	if (process.platform === `win32`) {
		spawnSync(
			`taskkill`,
			[`/pid`, String(pid), `/t`, ...(force ? [`/f`] : [])],
			{ stdio: `ignore`, windowsHide: true },
		)
		return
	}
	try {
		process.kill(-pid, force ? `SIGKILL` : signal)
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== `ESRCH`) throw error
	}
}

export async function superviseDevProcesses(
	subprocesses: readonly ChildProcess[],
): Promise<void> {
	let stoppingSignal: NodeJS.Signals | undefined
	let forceTimer: NodeJS.Timeout | undefined
	const forceStop = (): void => {
		for (const subprocess of subprocesses)
			signalDevProcess(subprocess, `SIGTERM`, true)
	}
	const stop = (signal: NodeJS.Signals = `SIGTERM`): void => {
		if (stoppingSignal !== undefined) {
			forceStop()
			return
		}
		stoppingSignal = signal
		process.exitCode =
			signal === `SIGINT` ? 130 : signal === `SIGTERM` ? 143 : 1
		for (const subprocess of subprocesses)
			signalDevProcess(subprocess, signal, false)
		forceTimer = setTimeout(forceStop, gracefulShutdownTimeoutMs)
		forceTimer.unref()
	}
	const onSigint = (): void => stop(`SIGINT`)
	const onSigterm = (): void => stop(`SIGTERM`)

	process.on(`SIGINT`, onSigint)
	process.on(`SIGTERM`, onSigterm)

	const exits = subprocesses.map(exited)
	try {
		const exitCode = await Promise.race(exits)
		const stoppedExternally = stoppingSignal !== undefined
		stop(stoppingSignal ?? `SIGTERM`)
		await Promise.all(exits)
		if (!stoppedExternally && exitCode === 0) process.exitCode = 1
		else if (!stoppedExternally) process.exitCode = exitCode
	} catch (error) {
		stop()
		await Promise.allSettled(exits)
		throw error
	} finally {
		if (forceTimer !== undefined) clearTimeout(forceTimer)
		process.off(`SIGINT`, onSigint)
		process.off(`SIGTERM`, onSigterm)
	}
}
