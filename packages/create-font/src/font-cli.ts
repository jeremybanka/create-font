#!/usr/bin/env bun

import {
	cli,
	help,
	options,
	optional,
	parseBooleanOption,
	parseNumberOption,
	parseStringOption,
} from "comline"
import { z } from "zod/v4"

import { buildProject } from "./build.ts"
import { type CliIo, defaultIo, writeLine } from "./cli-io.ts"
import { startCreateFontServer } from "./server.ts"
import { createFileSystemSourceService } from "./source-service.ts"
import { selectFontProject } from "./workspace.ts"

const helpSchema = { help: z.boolean().optional() }
const helpConfig = {
	help: {
		description: `Show command help.`,
		example: `--help`,
		flag: `h`,
		parse: parseBooleanOption,
		required: false,
	},
} as const

const buildOptions = options(
	`Build a font project.`,
	z.object({ ...helpSchema, root: z.string().optional() }),
	{
		...helpConfig,
		root: {
			description: `Font workspace root.`,
			example: `--root=.`,
			flag: `r`,
			parse: parseStringOption,
			required: false,
		},
	},
)

const devOptions = options(
	`Start the interactive font workspace server.`,
	z.object({
		...helpSchema,
		hostname: z.string().optional(),
		port: z.number().int().min(1).max(65_535).optional(),
		root: z.string().optional(),
	}),
	{
		...helpConfig,
		hostname: {
			description: `Address to bind. Loopback is the default.`,
			example: `--hostname=127.0.0.1`,
			parse: parseStringOption,
			required: false,
		},
		port: {
			description: `TCP port.`,
			example: `--port=4173`,
			flag: `p`,
			parse: parseNumberOption,
			required: false,
		},
		root: {
			description: `Font workspace root.`,
			example: `--root=.`,
			flag: `r`,
			parse: parseStringOption,
			required: false,
		},
	},
)

export const fontCli = cli({
	cliName: `font`,
	cliDescription: `Build and interactively edit fonts in a create-font workspace.`,
	routes: optional({
		build: optional({ $font: null }),
		dev: optional({ $font: null }),
		serve: optional({ $font: null }),
	}),
	routeOptions: {
		"": options(`Show font help.`, z.object(helpSchema), helpConfig),
		build: buildOptions,
		"build/$font": buildOptions,
		dev: devOptions,
		"dev/$font": devOptions,
		serve: devOptions,
		"serve/$font": devOptions,
	},
})

export async function runFontCli(
	args: string[] = [`font`, ...Bun.argv.slice(2)],
	io: CliIo = defaultIo,
): Promise<number> {
	try {
		const { inputs } = fontCli(args)
		if (inputs.opts.help || inputs.case === ``) {
			writeLine(io.stdout, help(fontCli.definition))
			return 0
		}
		const project = await selectFontProject(inputs.opts.root, inputs.path[1])
		if (inputs.case === `build` || inputs.case === `build/$font`) {
			const result = await buildProject(project.root)
			if (result.ok) {
				for (const output of result.outputs) writeLine(io.stdout, output)
				return 0
			}
			for (const diagnostic of result.errors) {
				writeLine(
					io.stderr,
					`${diagnostic.code}: ${diagnostic.message} (${diagnostic.path})`,
				)
			}
			return 1
		}

		const { hostname, port } = inputs.opts
		const source = await createFileSystemSourceService(project.root)
		const server = startCreateFontServer({
			...(hostname === undefined ? {} : { hostname }),
			...(port === undefined ? {} : { port }),
			root: project.root,
			source,
		})
		writeLine(io.stdout, `font is serving ${project.path} at ${server.url}`)
		return 0
	} catch (error) {
		writeLine(io.stderr, error instanceof Error ? error.message : String(error))
		return 1
	}
}

if (import.meta.main) process.exitCode = await runFontCli()
