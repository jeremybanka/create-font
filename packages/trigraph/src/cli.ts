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
import { startTrigraphServer } from "./server.ts"

const helpSchema = {
	help: z.boolean().optional(),
}

const helpConfig = {
	help: {
		description: `Show command help.`,
		example: `--help`,
		flag: `h`,
		parse: parseBooleanOption,
		required: false,
	},
} as const

export const trigraphCli = cli({
	cliName: `trigraph`,
	cliDescription: `Build and interactively edit a Trigraph font project.`,
	routes: optional({
		build: null,
		serve: null,
	}),
	routeOptions: {
		"": options(`Show Trigraph help.`, z.object(helpSchema), helpConfig),
		build: options(
			`Build the font project.`,
			z.object({
				...helpSchema,
				root: z.string().optional(),
			}),
			{
				...helpConfig,
				root: {
					description: `Font repository root.`,
					example: `--root=.`,
					flag: `r`,
					parse: parseStringOption,
					required: false,
				},
			},
		),
		serve: options(
			`Start the interactive workspace server.`,
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
					description: `Font repository root.`,
					example: `--root=.`,
					flag: `r`,
					parse: parseStringOption,
					required: false,
				},
			},
		),
	},
})

type OutputWriter = Readonly<{
	write: (value: string) => unknown
}>

type CliIo = Readonly<{
	stderr: OutputWriter
	stdout: OutputWriter
}>

const defaultIo: CliIo = {
	stderr: process.stderr,
	stdout: process.stdout,
}

function writeLine(stream: OutputWriter, value: string) {
	stream.write(`${value}\n`)
}

export async function runCli(
	args: string[] = [`trigraph`, ...Bun.argv.slice(2)],
	io: CliIo = defaultIo,
): Promise<number> {
	try {
		const { inputs } = trigraphCli(args)
		if (inputs.opts.help || inputs.case === ``) {
			writeLine(io.stdout, help(trigraphCli.definition))
			return 0
		}

		switch (inputs.case) {
			case `build`: {
				const result = await buildProject(inputs.opts.root)
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
			case `serve`: {
				const { hostname, port, root } = inputs.opts
				const server = startTrigraphServer({
					...(hostname === undefined ? {} : { hostname }),
					...(port === undefined ? {} : { port }),
					...(root === undefined ? {} : { root }),
				})
				writeLine(io.stdout, `Trigraph is running at ${server.url}`)
				return 0
			}
		}
	} catch (error) {
		writeLine(io.stderr, error instanceof Error ? error.message : String(error))
		return 1
	}
}

if (import.meta.main) {
	process.exitCode = await runCli()
}
