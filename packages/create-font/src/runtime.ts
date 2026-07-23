import { spawn } from "node:child_process"

export type RuntimeCommandOptions = Readonly<{
	cwd?: string
	env?: NodeJS.ProcessEnv
	input?: string
	stderr?: `capture` | `inherit`
	stdout?: `capture` | `inherit`
	timeout?: number
}>

export type RuntimeCommandResult = Readonly<{
	exitCode: number | null
	stderr: string
	stdout: Uint8Array
}>

export type RuntimeAdapter = Readonly<{
	run(
		command: string,
		args: readonly string[],
		options?: RuntimeCommandOptions,
	): Promise<RuntimeCommandResult>
}>

/**
 * Node's process APIs are also implemented by Bun, making this the shared
 * compatibility adapter for supported server runtimes.
 */
export const nodeRuntimeAdapter: RuntimeAdapter = {
	run(command, args, options = {}) {
		return new Promise((resolve, reject) => {
			const child = spawn(command, args, {
				cwd: options.cwd,
				env: options.env,
				stdio: [
					options.input === undefined ? `ignore` : `pipe`,
					options.stdout === `inherit` ? `inherit` : `pipe`,
					options.stderr === `inherit` ? `inherit` : `pipe`,
				],
			})
			const stdout: Uint8Array[] = []
			const stderr: Uint8Array[] = []
			if (child.stdout !== null) {
				child.stdout.on(`data`, (chunk: Uint8Array) => stdout.push(chunk))
			}
			if (child.stderr !== null) {
				child.stderr.on(`data`, (chunk: Uint8Array) => stderr.push(chunk))
			}
			child.once(`error`, reject)
			const timeout =
				options.timeout === undefined
					? undefined
					: setTimeout(() => child.kill(), options.timeout)
			child.once(`close`, (exitCode) => {
				if (timeout !== undefined) clearTimeout(timeout)
				resolve({
					exitCode,
					stderr: new TextDecoder().decode(concatenate(stderr)),
					stdout: concatenate(stdout),
				})
			})
			if (child.stdin !== null) child.stdin.end(options.input)
		})
	},
}

function concatenate(chunks: readonly Uint8Array[]): Uint8Array {
	const byteLength = chunks.reduce(
		(total, chunk) => total + chunk.byteLength,
		0,
	)
	const bytes = new Uint8Array(byteLength)
	let offset = 0
	for (const chunk of chunks) {
		bytes.set(chunk, offset)
		offset += chunk.byteLength
	}
	return bytes
}
