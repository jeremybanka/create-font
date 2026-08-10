import { spawn } from "node:child_process"
import { pathToFileURL } from "node:url"

export type RuntimeAdapter = Readonly<{
	run(command: string, args: readonly string[], cwd: string): Promise<number | null>
}>

export const nodeRuntimeAdapter: RuntimeAdapter = {
	run(command, args, cwd) {
		return new Promise((resolve, reject) => {
			const child = spawn(command, args, { cwd, stdio: "inherit" })
			child.once("error", reject)
			child.once("close", resolve)
		})
	},
}

export function isMainModule(url: string): boolean {
	const entrypoint = process.argv[1]
	return entrypoint !== undefined && pathToFileURL(entrypoint).href === url
}
