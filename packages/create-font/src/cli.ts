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
import { startCreateFontServer } from "./server.ts"
import { createFileSystemSourceService } from "./source-service.ts"
import { selectFontProject } from "./workspace.ts"

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

export const createFontCli = cli({
	cliName: `create-font`,
	cliDescription: `Build and interactively edit a create-font project.`,
	routes: optional({
		build: null,
		serve: null,
	}),
	routeOptions: {
		"": options(`Show create-font help.`, z.object(helpSchema), helpConfig),
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
				font: z.string().optional(),
				hostname: z.string().optional(),
				port: z.number().int().min(1).max(65_535).optional(),
				root: z.string().optional(),
			}),
			{
				...helpConfig,
				font: {
					description: `Font project name below fonts/.`,
					example: `--font=create-font-sans`,
					flag: `f`,
					parse: parseStringOption,
					required: false,
				},
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
	args: string[] = [`create-font`, ...Bun.argv.slice(2)],
	io: CliIo = defaultIo,
): Promise<number> {
	try {
		const { inputs } = createFontCli(args)
		if (inputs.opts.help || inputs.case === ``) {
			writeLine(io.stdout, help(createFontCli.definition))
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
				const { font, hostname, port, root } = inputs.opts
				const project = await selectFontProject(root, font)
				const source = await createFileSystemSourceService(project.root)
				const server = startCreateFontServer({
					...(hostname === undefined ? {} : { hostname }),
					...(port === undefined ? {} : { port }),
					root: project.root,
					source,
				})
				writeLine(
					io.stdout,
					`create-font is serving ${project.path} at ${server.url}`,
				)
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
