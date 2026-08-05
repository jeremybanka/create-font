import { spawn } from "node:child_process"
import { pathToFileURL } from "node:url"

export type RuntimeCommandOptions = Readonly<{
	cwd?: string
	stderr?: "capture" | "inherit"
	stdout?: "capture" | "inherit"
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

export const nodeRuntimeAdapter: RuntimeAdapter = {
	run(command, args, options = {}) {
		return new Promise((resolve, reject) => {
			const child = spawn(command, args, {
				cwd: options.cwd,
				stdio: [
					"ignore",
					options.stdout === "inherit" ? "inherit" : "pipe",
					options.stderr === "inherit" ? "inherit" : "pipe",
				],
			})
			const stdout: Uint8Array[] = []
			const stderr: Uint8Array[] = []
			if (child.stdout !== null)
				child.stdout.on("data", (chunk: Uint8Array) => stdout.push(chunk))
			if (child.stderr !== null)
				child.stderr.on("data", (chunk: Uint8Array) => stderr.push(chunk))
			child.once("error", reject)
			child.once("close", (exitCode) =>
				resolve({
					exitCode,
					stderr: new TextDecoder().decode(concatenate(stderr)),
					stdout: concatenate(stdout),
				}),
			)
		})
	},
}

export function isMainModule(url: string): boolean {
	const entrypoint = process.argv[1]
	return entrypoint !== undefined && pathToFileURL(entrypoint).href === url
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
