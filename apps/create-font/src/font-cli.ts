#!/usr/bin/env node

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

import { CREATE_FONT_CLI_DEV_PORT } from "../../../scripts/dev-ports.ts"
import { installServerShutdown } from "../../../scripts/server-shutdown.ts"
import { buildProject } from "./build.ts"
import { checkFontProject, formatStylishCheck } from "./check.ts"
import { type CliIo, defaultIo, writeLine } from "./cli-io.ts"
import { startCreateFontServer } from "./server.ts"
import { createFileSystemSourceService } from "./source-service.ts"
import { isMainModule } from "./runtime.ts"
import {
	discoverFontProjects,
	isFontProjectAvailable,
	selectFontProject,
} from "./workspace.ts"
import { buildFeaVsix, installFeaVsix } from "./vsix.ts"

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

const checkOptions = options(
	`Check a font project's Adobe feature sources without writing artifacts.`,
	z.object({
		...helpSchema,
		format: z.string().optional(),
		root: z.string().optional(),
	}),
	{
		...helpConfig,
		format: {
			description: `Diagnostic output format: stylish or json.`,
			example: `--format=json`,
			flag: `f`,
			parse: parseStringOption,
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
			description: `TCP port. Defaults to ${CREATE_FONT_CLI_DEV_PORT}.`,
			example: `--port=${CREATE_FONT_CLI_DEV_PORT}`,
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
			description: `Build the universal VSIX without installing it.`,
			example: `--build-only`,
			parse: parseBooleanOption,
			required: false,
		},
		out: {
			description: `Directory for the VSIX.`,
			example: `--out=artifacts`,
			flag: `o`,
			parse: parseStringOption,
			required: false,
		},
		target: {
			description: `VS Code-compatible editor command used for installation.`,
			example: `--target=code-insiders`,
			flag: `t`,
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
		check: optional({ $font: null }),
		dev: optional({ $font: null }),
		serve: optional({ $font: null }),
		vsix: null,
	}),
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
	args: string[] = [`font`, ...process.argv.slice(2)],
	io: CliIo = defaultIo,
): Promise<number> {
	try {
		const { inputs } = fontCli(args)
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
			if (
				inputs.opts.format !== undefined &&
				inputs.opts.format !== `stylish` &&
				inputs.opts.format !== `json`
			)
				throw new Error(`Format must be stylish or json.`)
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
