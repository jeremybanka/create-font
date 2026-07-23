#!/usr/bin/env node

import {
	cli,
	help,
	options,
	optional,
	parseBooleanOption,
	parseStringOption,
} from "comline"
import { z } from "zod/v4"

import { type CliIo, defaultIo, writeLine } from "./cli-io.ts"
import { createFontWorkspace, isPackageManager } from "./create.ts"
import { isMainModule } from "./runtime.ts"

const createOptions = options(
	`Create a workspace, or add a font to the current workspace.`,
	z.object({
		help: z.boolean().optional(),
		"no-install": z.boolean().optional(),
		"package-manager": z.string().optional(),
	}),
	{
		help: {
			description: `Show command help.`,
			example: `--help`,
			flag: `h`,
			parse: parseBooleanOption,
			required: false,
		},
		"no-install": {
			description: `Do not install workspace dependencies.`,
			example: `--no-install`,
			parse: parseBooleanOption,
			required: false,
		},
		"package-manager": {
			description: `Package manager used to install a new workspace.`,
			example: `--package-manager=pnpm`,
			parse: parseStringOption,
			required: false,
		},
	},
)

export const createFontCli = cli({
	cliName: `create-font`,
	cliDescription: `Create a font workspace or add a font to one.`,
	routes: optional({ $name: null }),
	routeOptions: { "": createOptions, $name: createOptions },
})

export async function runCreateFontCli(
	args: string[] = [`create-font`, ...process.argv.slice(2)],
	io: CliIo = defaultIo,
): Promise<number> {
	try {
		const { inputs } = createFontCli(args)
		if (inputs.opts.help) {
			writeLine(io.stdout, help(createFontCli.definition))
			return 0
		}
		const packageManager = inputs.opts["package-manager"]
		if (packageManager !== undefined && !isPackageManager(packageManager)) {
			throw new Error(`Package manager must be npm, pnpm, yarn, or bun.`)
		}
		const result = await createFontWorkspace({
			...(inputs.opts["no-install"] ? { install: false } : {}),
			...(inputs.path[0] === undefined ? {} : { name: inputs.path[0] }),
			...(packageManager === undefined ? {} : { packageManager }),
		})
		writeLine(
			io.stdout,
			result.workspaceCreated
				? `Created font workspace ${result.workspaceRoot}.`
				: `Added font ${result.fontName} to ${result.workspaceRoot}.`,
		)
		writeLine(
			io.stdout,
			`Run: cd ${result.workspaceRoot} && ${packageManager ?? `npm`} run dev`,
		)
		return 0
	} catch (error) {
		writeLine(io.stderr, error instanceof Error ? error.message : String(error))
		return 1
	}
}

if (isMainModule(import.meta.url)) process.exitCode = await runCreateFontCli()
