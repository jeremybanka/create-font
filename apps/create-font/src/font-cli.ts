#!/usr/bin/env node

import {
	cli,
	completionResponse,
	type CompletionHints,
	help,
	options,
	optional,
	parseBooleanOption,
	parseNumberOption,
	parseStringOption,
} from "comline"
import { z } from "zod/v4"

import { CREATE_FONT_CLI_DEV_PORT } from "../../../scripts/dev-ports.ts"
import { installServerShutdown } from "../../../scripts/server-shutdown.ts"
import { buildProject } from "./build.ts"
import { checkFontProject, formatStylishCheck } from "./check.ts"
import { type CliIo, defaultIo, writeLine, writeWarnings } from "./cli-io.ts"
import { startCreateFontServer } from "./server.ts"
import { createFileSystemSourceService } from "./source-service.ts"
import { isMainModule } from "./runtime.ts"
import {
	discoverFontProjects,
	isFontProjectAvailable,
	selectFontProject,
} from "./workspace.ts"
import { buildFeaVsix, installFeaVsix } from "./vsix.ts"

const diagnosticFormats = [`stylish`, `json`] as const
const helpSchema = { help: z.boolean().optional() }
const helpConfig = {
	help: {
		completion: { repeatable: false },
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
			completion: { fileSystem: `directories`, repeatable: false },
			description: `Font workspace root.`,
			example: `--root=.`,
			flag: `r`,
			parse: parseStringOption,
			required: false,
		},
	},
)

const checkOptions = options(
	`Check a font project's Adobe feature sources without writing artifacts.`,
	z.object({
		...helpSchema,
		format: z
			.enum(diagnosticFormats, {
				error: `Format must be stylish or json.`,
			})
			.optional(),
		root: z.string().optional(),
	}),
	{
		...helpConfig,
		format: {
			completion: { repeatable: false },
			description: `Diagnostic output format: stylish or json.`,
			example: `--format=json`,
			flag: `f`,
			parse: parseStringOption,
			required: false,
		},
		root: {
			completion: { fileSystem: `directories`, repeatable: false },
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
			completion: { repeatable: false },
			description: `Address to bind. Loopback is the default.`,
			example: `--hostname=127.0.0.1`,
			parse: parseStringOption,
			required: false,
		},
		port: {
			completion: { repeatable: false },
			description: `TCP port. Defaults to ${CREATE_FONT_CLI_DEV_PORT}.`,
			example: `--port=${CREATE_FONT_CLI_DEV_PORT}`,
			flag: `p`,
			parse: parseNumberOption,
			required: false,
		},
		root: {
			completion: { fileSystem: `directories`, repeatable: false },
			description: `Font workspace root.`,
			example: `--root=.`,
			flag: `r`,
			parse: parseStringOption,
			required: false,
		},
	},
)

const vsixOptions = options(
	`Build and optionally install the Create Font Features VS Code extension.`,
	z.object({
		...helpSchema,
		"build-only": z.boolean().optional(),
		out: z.string().optional(),
		target: z.string().optional(),
	}),
	{
		...helpConfig,
		"build-only": {
			completion: { repeatable: false },
			description: `Build the universal VSIX without installing it.`,
			example: `--build-only`,
			parse: parseBooleanOption,
			required: false,
		},
		out: {
			completion: { fileSystem: `directories`, repeatable: false },
			description: `Directory for the VSIX.`,
			example: `--out=artifacts`,
			flag: `o`,
			parse: parseStringOption,
			required: false,
		},
		target: {
			completion: {
				choices: [`code`, `code-insiders`, `codium`],
				repeatable: false,
			},
			description: `VS Code-compatible editor command used for installation.`,
			example: `--target=code-insiders`,
			flag: `t`,
			parse: parseStringOption,
			required: false,
		},
	},
)

const completeFontProjects: Exclude<
	CompletionHints["provide"],
	undefined
> = async ({ options: occurrences }) => {
	const root = occurrences.findLast(({ key }) => key === `root`)?.value
	return (await discoverFontProjects(root || process.cwd())).map((project) => ({
		description: project.path,
		value: project.name,
	}))
}

export const fontCli = cli({
	cliName: `font`,
	cliDescription: `Build and interactively edit fonts in a create-font workspace.`,
	routes: optional({
		build: optional({ $font: null }),
		check: optional({ $font: null }),
		dev: optional({ $font: null }),
		serve: optional({ $font: null }),
		vsix: null,
	}),
	positionalCompletions: {
		"build/$font": { provide: completeFontProjects },
		"check/$font": { provide: completeFontProjects },
		"dev/$font": { provide: completeFontProjects },
		"serve/$font": { provide: completeFontProjects },
	},
	routeOptions: {
		"": options(`Show font help.`, z.object(helpSchema), helpConfig),
		build: buildOptions,
		"build/$font": buildOptions,
		check: checkOptions,
		"check/$font": checkOptions,
		dev: devOptions,
		"dev/$font": devOptions,
		serve: devOptions,
		"serve/$font": devOptions,
		vsix: vsixOptions,
	},
})

export async function runFontCli(
	args: string[] = process.argv,
	io: CliIo = defaultIo,
): Promise<number> {
	try {
		const completion = await completionResponse(fontCli.definition, args)
		if (completion !== undefined) {
			io.stdout.write(completion)
			return 0
		}
		const { inputs, warnings } = fontCli(args)
		writeWarnings(io.stderr, warnings)
		if (inputs.opts.help || inputs.case === ``) {
			writeLine(io.stdout, help(fontCli.definition))
			return 0
		}
		if (inputs.case === `vsix`) {
			const result = await buildFeaVsix({
				outdir: inputs.opts.out ?? `artifacts`,
			})
			writeLine(io.stdout, result.vsixPath)
			if (!inputs.opts[`build-only`])
				await installFeaVsix(
					result.vsixPath,
					inputs.opts.target ?? `code`,
					process.cwd(),
				)
			return 0
		}
		const project = await selectFontProject(inputs.opts.root, inputs.path[1])
		if (inputs.case === `check` || inputs.case === `check/$font`) {
			const result = await checkFontProject(project.root)
			writeLine(
				inputs.opts.format === `json` ? io.stdout : io.stderr,
				inputs.opts.format === `json`
					? JSON.stringify(result.diagnostics, null, 2)
					: await formatStylishCheck(result),
			)
			return result.ok ? 0 : 1
		}
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
		const workspaceRoot = inputs.opts.root ?? process.cwd()
		const discovered = await discoverFontProjects(workspaceRoot)
		const mounted = (
			await Promise.all(
				discovered.map(async (candidate) => {
					try {
						return {
							available: () => isFontProjectAvailable(candidate.root),
							id: candidate.name,
							name: candidate.name,
							path: candidate.path,
							root: candidate.root,
							source: await createFileSystemSourceService(candidate.root),
						}
					} catch (error) {
						if (candidate.root === project.root) throw error
						return null
					}
				}),
			)
		).filter((candidate) => candidate !== null)
		const active = mounted.find(({ root }) => root === project.root)
		if (active === undefined)
			throw new Error(`The selected font could not be mounted.`)
		const server = startCreateFontServer({
			...(hostname === undefined ? {} : { hostname }),
			activeProjectId: active.id,
			port: port ?? CREATE_FONT_CLI_DEV_PORT,
			projects: mounted,
			root: active.root,
			source: active.source,
			workspaceRoot,
		})
		installServerShutdown({ stop: () => server.app.stop(true) })
		writeLine(io.stdout, `font is serving ${project.path} at ${server.url}`)
		return 0
	} catch (error) {
		writeLine(io.stderr, error instanceof Error ? error.message : String(error))
		return 1
	}
}

if (isMainModule(import.meta.url)) {
	const exitCode = await runFontCli()
	process.exitCode ??= exitCode
}
