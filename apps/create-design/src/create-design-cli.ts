#!/usr/bin/env node

import { open } from "node:fs/promises"
import { basename, extname, resolve } from "node:path"

import {
	importAdobeIllustrator,
	MAX_ILLUSTRATOR_FILE_BYTES,
} from "@create-design/ai"
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
import { createDesignWorkspace, isPackageManager } from "./create.ts"
import { isMainModule } from "./runtime.ts"

const createOptions = options(
	"Create a workspace, or add a design to the current workspace.",
	z.object({
		from: z.string().optional(),
		help: z.boolean().optional(),
		"no-install": z.boolean().optional(),
		"package-manager": z.string().optional(),
	}),
	{
		from: {
			description: "Import native Adobe Illustrator .ai source.",
			example: "--from=poster.ai",
			parse: parseStringOption,
			required: false,
		},
		help: {
			description: "Show command help.",
			example: "--help",
			flag: "h",
			parse: parseBooleanOption,
			required: false,
		},
		"no-install": {
			description: "Do not install workspace dependencies.",
			example: "--no-install",
			parse: parseBooleanOption,
			required: false,
		},
		"package-manager": {
			description: "Package manager used to install a new workspace.",
			example: "--package-manager=pnpm",
			parse: parseStringOption,
			required: false,
		},
	},
)

export const createDesignCli = cli({
	cliName: "create-design",
	cliDescription: "Create a design workspace or add a design to one.",
	routes: optional({ $name: null }),
	routeOptions: { "": createOptions, $name: createOptions },
})

function inferredDesignName(path: string): string {
	const name = basename(path, extname(path))
		.replace(/[^A-Za-z0-9._-]+/gu, "-")
		.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/gu, "")
	return name || "imported-design"
}

async function readIllustratorFile(path: string): Promise<Uint8Array> {
	const file = await open(path, "r")
	try {
		const metadata = await file.stat()
		if (!metadata.isFile()) throw new Error("--from must reference a file.")
		if (metadata.size > MAX_ILLUSTRATOR_FILE_BYTES)
			throw new Error(
				`The Illustrator file exceeds the ${MAX_ILLUSTRATOR_FILE_BYTES}-byte import limit.`,
			)
		const bytes = new Uint8Array(metadata.size)
		let offset = 0
		while (offset < bytes.byteLength) {
			const { bytesRead } = await file.read(
				bytes,
				offset,
				bytes.byteLength - offset,
				offset,
			)
			if (bytesRead === 0) break
			offset += bytesRead
		}
		return offset === bytes.byteLength ? bytes : bytes.slice(0, offset)
	} finally {
		await file.close()
	}
}

export async function runCreateDesignCli(
	args: string[] = ["create-design", ...process.argv.slice(2)],
	io: CliIo = defaultIo,
): Promise<number> {
	try {
		const { inputs } = createDesignCli(args)
		if (inputs.opts.help) {
			writeLine(io.stdout, help(createDesignCli.definition))
			return 0
		}
		const packageManager = inputs.opts["package-manager"]
		if (packageManager !== undefined && !isPackageManager(packageManager))
			throw new Error("Package manager must be npm, pnpm, yarn, or bun.")
		const from = inputs.opts.from
		let imported: ReturnType<typeof importAdobeIllustrator> | undefined
		if (from !== undefined) {
			const input = resolve(from)
			if (extname(input).toLowerCase() !== ".ai")
				throw new Error("--from must reference an Adobe Illustrator .ai file.")
			imported = importAdobeIllustrator(await readIllustratorFile(input), {
				title: basename(input, extname(input)),
			})
			for (const diagnostic of imported.diagnostics)
				writeLine(
					io.stderr,
					`${diagnostic.severity} ${diagnostic.code}${diagnostic.sourceSpan === undefined ? "" : ` [line ${diagnostic.sourceSpan.line}, column ${diagnostic.sourceSpan.column}]`}: ${diagnostic.message}`,
				)
			if (!imported.ok || imported.document === null) return 1
		}
		const requestedName =
			inputs.path[0] ??
			(from === undefined ? undefined : inferredDesignName(from))
		const result = await createDesignWorkspace({
			...(inputs.opts["no-install"] ? { install: false } : {}),
			...(requestedName === undefined ? {} : { name: requestedName }),
			...(packageManager === undefined ? {} : { packageManager }),
			...(imported?.document === undefined || imported.document === null
				? {}
				: { document: imported.document }),
		})
		writeLine(
			io.stdout,
			result.workspaceCreated
				? `Created design workspace ${result.workspaceRoot}.`
				: `Added design ${result.designName} to ${result.workspaceRoot}.`,
		)
		if (imported !== undefined)
			writeLine(
				io.stdout,
				`Imported ${imported.summary.artboards} artboards and ${imported.summary.objects} objects from ${resolve(from!)}.`,
			)
		writeLine(
			io.stdout,
			`Run: cd ${result.workspaceRoot} && ${packageManager ?? "npm"} run dev`,
		)
		return 0
	} catch (error) {
		writeLine(io.stderr, error instanceof Error ? error.message : String(error))
		return 1
	}
}

if (isMainModule(import.meta.url)) process.exitCode = await runCreateDesignCli()
