#!/usr/bin/env node

import { open } from "node:fs/promises"
import { basename, extname, resolve } from "node:path"

import {
	cli,
	help,
	options,
	optional,
	parseBooleanOption,
	parseStringOption,
} from "comline"
import { z } from "zod/v4"

import { importGlyphsSource } from "@create-font/glyphs"

import { type CliIo, defaultIo, writeLine } from "./cli-io.ts"
import { createFontWorkspace, isPackageManager } from "./create.ts"
import { isMainModule } from "./runtime.ts"

function importProjectName(path: string): string {
	const stem = basename(path, extname(path))
	const sanitized = stem
		.normalize("NFKD")
		.replace(/[^A-Za-z0-9._-]+/gu, "-")
		.replace(/^[._-]+|[._-]+$/gu, "")
	return sanitized === "" ? "imported-font" : sanitized
}

const maximumGlyphsSourceBytes = 33_554_432

async function readGlyphsSource(path: string): Promise<string> {
	const file = await open(path, "r")
	try {
		if (!(await file.stat()).isFile())
			throw new Error(`Import source must be a file.`)
		const chunks: Uint8Array[] = []
		let size = 0
		for (;;) {
			const chunk = Buffer.allocUnsafe(
				Math.min(65_536, maximumGlyphsSourceBytes + 1 - size),
			)
			const { bytesRead } = await file.read(chunk, 0, chunk.length)
			if (bytesRead === 0) break
			chunks.push(chunk.subarray(0, bytesRead))
			size += bytesRead
			if (size > maximumGlyphsSourceBytes)
				throw new Error(`Glyphs source exceeds the 32 MiB import limit.`)
		}
		return Buffer.concat(chunks, size).toString("utf8")
	} finally {
		await file.close()
	}
}

const createOptions = options(
	`Create a workspace, or add a font to the current workspace.`,
	z.object({
		help: z.boolean().optional(),
		"no-install": z.boolean().optional(),
		"package-manager": z.string().optional(),
		from: z.string().optional(),
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
		from: {
			description: `Import a Glyphs.app .glyphs source into the new font project.`,
			example: `--from=MyFont.glyphs`,
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
	cwd: string = process.cwd(),
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
		const importPath = inputs.opts.from
		if (
			importPath !== undefined &&
			extname(importPath).toLowerCase() !== ".glyphs"
		)
			throw new Error(
				extname(importPath).toLowerCase() === ".glyphspackage"
					? `Glyphs package directories are not supported; save or export a text .glyphs file.`
					: `Import source must have a .glyphs extension.`,
			)
		let imported: ReturnType<typeof importGlyphsSource> | undefined
		if (importPath !== undefined) {
			const sourcePath = resolve(cwd, importPath)
			imported = importGlyphsSource(await readGlyphsSource(sourcePath))
		}
		if (imported !== undefined && !imported.ok) {
			throw new Error(
				imported.errors
					.map((diagnostic) => {
						const location =
							diagnostic.line === undefined
								? diagnostic.path
								: `${diagnostic.line}:${diagnostic.column ?? 1}`
						return `${importPath}:${location}: ${diagnostic.code}: ${diagnostic.message}`
					})
					.join("\n"),
			)
		}
		const requestedName =
			inputs.path[0] ??
			(importPath === undefined ? undefined : importProjectName(importPath))
		const result = await createFontWorkspace({
			cwd,
			...(inputs.opts["no-install"] ? { install: false } : {}),
			...(requestedName === undefined ? {} : { name: requestedName }),
			...(packageManager === undefined ? {} : { packageManager }),
			...(imported?.ok ? { imported: imported.value } : {}),
		})
		for (const diagnostic of imported?.ok ? imported.value.warnings : []) {
			writeLine(
				io.stderr,
				`${importPath}:${diagnostic.path}: warning ${diagnostic.code}: ${diagnostic.message}`,
			)
		}
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
