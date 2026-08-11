const shutdownSignals = [
	`SIGINT`,
	`SIGTERM`,
] as const satisfies readonly NodeJS.Signals[]

export type ServerShutdownRuntime = Readonly<{
	exit: (code: number) => never
	on: (signal: NodeJS.Signals, listener: () => void) => void
	off: (signal: NodeJS.Signals, listener: () => void) => void
	setExitCode: (code: number) => void
}>

const processRuntime: ServerShutdownRuntime = {
	exit: (code) => process.exit(code),
	on: (signal, listener) => process.on(signal, listener),
	off: (signal, listener) => process.off(signal, listener),
	setExitCode: (code) => {
		process.exitCode = code
	},
}

function signalExitCode(signal: NodeJS.Signals): number {
	return signal === `SIGINT` ? 130 : 143
}

export function installServerShutdown(
	options: Readonly<{
		runtime?: ServerShutdownRuntime
		shutdownTimeoutMs?: number
		stop: () => Promise<unknown> | unknown
	}>,
): () => void {
	const runtime = options.runtime ?? processRuntime
	const shutdownTimeoutMs = options.shutdownTimeoutMs ?? 5_000
	let stopping = false
	let timeout: NodeJS.Timeout | undefined

	const listeners = new Map<NodeJS.Signals, () => void>()
	const cleanup = (): void => {
		if (timeout !== undefined) clearTimeout(timeout)
		for (const [signal, listener] of listeners) runtime.off(signal, listener)
		listeners.clear()
	}
	const stop = (signal: NodeJS.Signals): void => {
		const exitCode = signalExitCode(signal)
		if (stopping) runtime.exit(exitCode)
		stopping = true
		runtime.setExitCode(exitCode)
		timeout = setTimeout(() => runtime.exit(exitCode), shutdownTimeoutMs)
		timeout.unref()
		void Promise.resolve()
			.then(options.stop)
			.then(() => runtime.exit(exitCode))
			.catch((error: unknown) => {
				process.stderr.write(
					`Server shutdown failed: ${error instanceof Error ? error.message : String(error)}\n`,
				)
				runtime.exit(exitCode)
			})
			.finally(cleanup)
	}

	for (const signal of shutdownSignals) {
		const listener = (): void => stop(signal)
		listeners.set(signal, listener)
		runtime.on(signal, listener)
	}
	return cleanup
}
