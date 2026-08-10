#!/usr/bin/env node

import { createFoleyWorkspace, isPackageManager } from "./create.ts"
import { optionValue, positional } from "./cli-options.ts"
import { isMainModule } from "./runtime.ts"

const HELP = `create-foley [name] [options]

Create a sound-effect workspace, or add a foley project to the current workspace.

Options:
  --no-install                Do not install dependencies
  --package-manager <name>    npm, pnpm, yarn, or bun
  --help                      Show this help`

export async function runCreateFoleyCli(args = process.argv.slice(2)): Promise<number> {
	try {
		if (args.includes("--help") || args.includes("-h")) { process.stdout.write(`${HELP}\n`); return 0 }
		const manager = optionValue(args, "--package-manager")
		if (manager !== undefined && !isPackageManager(manager)) throw new Error("Package manager must be npm, pnpm, yarn, or bun.")
		const result = await createFoleyWorkspace({
			...(positional(args)[0] === undefined ? {} : { name: positional(args)[0] }),
			...(args.includes("--no-install") ? { install: false } : {}),
			...(manager === undefined ? {} : { packageManager: manager }),
		})
		process.stdout.write(`${result.workspaceCreated ? "Created workspace" : "Added project"} ${result.projectRoot}.\nRun: cd ${result.workspaceRoot} && npm run dev\n`)
		return 0
	} catch (error) {
		process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
		return 1
	}
}

if (isMainModule(import.meta.url)) process.exitCode = await runCreateFoleyCli()
