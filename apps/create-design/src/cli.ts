#!/usr/bin/env node

import { access } from "node:fs/promises"
import { pathToFileURL } from "node:url"
import { resolve } from "node:path"

import { SourceValidationError } from "@create-art/source-rpc"

import {
	DesignPdfPreflightError,
	DesignPdfSourceError,
	exportDesignPdf,
	formatExportDiagnostic,
} from "./pdf-export.ts"
import { startCreateDesignServer } from "./server.ts"

export type CreateDesignCliWriter = Readonly<{
	write(value: string): unknown
}>

export type CreateDesignCliIo = Readonly<{
	stderr: CreateDesignCliWriter
	stdout: CreateDesignCliWriter
}>

const defaultIo: CreateDesignCliIo = {
	stderr: process.stderr,
	stdout: process.stdout,
}

type ParsedCli =
	| Readonly<{
			command: "help"
			topic?: "export" | "serve"
	  }>
	| Readonly<{
			command: "serve"
			port: number
			root: string
	  }>
	| Readonly<{
			artboardIds?: readonly string[]
			command: "export"
			force: boolean
			includeBleed: boolean
			output: string
			root: string
	  }>

const HELP = `Usage:
  create-design [serve] [PROJECT] [--port PORT]
  create-design export [PROJECT] --output FILE [options]

Commands:
  serve   Start the interactive workspace server (default).
  export  Export a validated source project as PDF.

Run "create-design export --help" for PDF options.`

const EXPORT_HELP = `Usage:
  create-design export [PROJECT] --output FILE [options]

Options:
  -o, --output FILE       Required .pdf path outside the source project.
      --artboards VALUE   "all" (default) or comma-separated artboard IDs.
      --include-bleed     Include authored bleed in page media boxes.
      --force             Atomically replace an existing output file.
  -h, --help              Show this help.`

function writeLine(writer: CreateDesignCliWriter, value: string): void {
	writer.write(`${value}\n`)
}

function optionValue(
	arguments_: readonly string[],
	index: number,
	inline: string | undefined,
	name: string,
): Readonly<{ nextIndex: number; value: string }> {
	const value = inline ?? arguments_[index + 1]
	if (value === undefined || (inline === undefined && value.startsWith("-")))
		throw new Error(`${name} requires a value.`)
	return { nextIndex: inline === undefined ? index + 1 : index, value }
}

function uniqueOption(
	options: Map<string, string | true>,
	name: string,
	value: string | true,
): void {
	if (options.has(name)) throw new Error(`${name} may only be specified once.`)
	options.set(name, value)
}

function parseOptions(arguments_: readonly string[]): Readonly<{
	options: ReadonlyMap<string, string | true>
	positionals: readonly string[]
}> {
	const options = new Map<string, string | true>()
	const positionals: string[] = []
	let positionalOnly = false
	for (let index = 0; index < arguments_.length; index += 1) {
		const argument = arguments_[index]!
		if (argument === "--") {
			positionalOnly = true
			continue
		}
		if (positionalOnly || !argument.startsWith("-")) {
			positionals.push(argument)
			continue
		}
		const equals = argument.indexOf("=")
		const rawName = equals < 0 ? argument : argument.slice(0, equals)
		const inline = equals < 0 ? undefined : argument.slice(equals + 1)
		const name =
			rawName === "-h"
				? "--help"
				: rawName === "-o"
					? "--output"
					: rawName === "-p"
						? "--port"
						: rawName
		if (["--help", "--include-bleed", "--force"].includes(name)) {
			if (inline !== undefined)
				throw new Error(`${name} does not accept a value.`)
			uniqueOption(options, name, true)
			continue
		}
		if (["--output", "--port", "--artboards"].includes(name)) {
			const parsed = optionValue(arguments_, index, inline, name)
			uniqueOption(options, name, parsed.value)
			index = parsed.nextIndex
			continue
		}
		throw new Error(`Unknown option: ${rawName}`)
	}
	return { options, positionals }
}

function stringOption(
	options: ReadonlyMap<string, string | true>,
	name: string,
): string | undefined {
	const value = options.get(name)
	return typeof value === "string" ? value : undefined
}

function parseArtboards(
	value: string | undefined,
): readonly string[] | undefined {
	if (value === undefined || value === "all") return
	const ids = value.split(",").map((id) => id.trim())
	if (ids.some((id) => id.length === 0))
		throw new Error(
			`--artboards must be "all" or comma-separated artboard IDs.`,
		)
	if (ids.includes("all"))
		throw new Error(`--artboards cannot combine "all" with artboard IDs.`)
	return Object.freeze([...new Set(ids)])
}

export function parseCreateDesignCli(arguments_: readonly string[]): ParsedCli {
	const commandArgument = arguments_[0]
	const command =
		commandArgument === "export" || commandArgument === "serve"
			? commandArgument
			: "serve"
	const commandArguments =
		commandArgument === command ? arguments_.slice(1) : arguments_
	const { options, positionals } = parseOptions(commandArguments)
	if (positionals.length > 1)
		throw new Error(`${command} accepts at most one project path.`)
	if (options.has("--help")) return { command: "help", topic: command }
	const root = resolve(positionals[0] ?? process.cwd())
	if (command === "serve") {
		for (const name of [
			"--output",
			"--artboards",
			"--include-bleed",
			"--force",
		])
			if (options.has(name))
				throw new Error(`${name} is only valid for export.`)
		const portValue = stringOption(options, "--port")
		const port = portValue === undefined ? 3010 : Number(portValue)
		if (!Number.isSafeInteger(port) || port < 1 || port > 65_535)
			throw new Error(`--port must be an integer from 1 through 65535.`)
		return { command, port, root }
	}
	if (options.has("--port")) throw new Error(`--port is only valid for serve.`)
	const output = stringOption(options, "--output")
	if (output === undefined)
		throw new Error(`PDF export requires --output FILE.`)
	const artboardIds = parseArtboards(stringOption(options, "--artboards"))
	return {
		...(artboardIds === undefined ? {} : { artboardIds }),
		command,
		force: options.has("--force"),
		includeBleed: options.has("--include-bleed"),
		output: resolve(output),
		root,
	}
}

function sourceIssue(issue: SourceValidationError["issues"][number]): string {
	return `error ${issue.code} [${issue.unitPath ?? issue.path}]: ${issue.message}`
}

export async function runCreateDesignCli(
	arguments_: readonly string[] = process.argv.slice(2),
	io: CreateDesignCliIo = defaultIo,
): Promise<number> {
	try {
		const input = parseCreateDesignCli(arguments_)
		if (input.command === "help") {
			writeLine(io.stdout, input.topic === "export" ? EXPORT_HELP : HELP)
			return 0
		}
		if (input.command === "export") {
			const result = await exportDesignPdf(input)
			for (const diagnostic of result.preflight.diagnostics)
				writeLine(io.stderr, formatExportDiagnostic(diagnostic))
			writeLine(
				io.stdout,
				`Exported ${result.pages} PDF ${result.pages === 1 ? "page" : "pages"} (${result.byteLength} bytes) to ${result.output}.`,
			)
			return 0
		}
		const assets = resolve(import.meta.dirname, `../dist`)
		if (
			!(await access(resolve(assets, `index.html`)).then(
				() => true,
				() => false,
			))
		)
			throw new Error(
				`Build create-design before starting its workspace server.`,
			)
		const { url } = await startCreateDesignServer({
			assets,
			port: input.port,
			root: input.root,
		})
		writeLine(io.stdout, `create-design serving ${input.root} at ${url.href}`)
		return 0
	} catch (error) {
		if (error instanceof DesignPdfPreflightError) {
			for (const diagnostic of error.preflight.diagnostics)
				writeLine(io.stderr, formatExportDiagnostic(diagnostic))
			return 1
		}
		if (error instanceof DesignPdfSourceError) {
			for (const diagnostic of error.diagnostics)
				writeLine(
					io.stderr,
					`error ${diagnostic.code} [${diagnostic.unitPath ?? diagnostic.path}]: ${diagnostic.message}`,
				)
			return 1
		}
		if (error instanceof SourceValidationError) {
			for (const issue of error.issues) writeLine(io.stderr, sourceIssue(issue))
			return 1
		}
		writeLine(io.stderr, error instanceof Error ? error.message : String(error))
		return 1
	}
}

const entrypoint = process.argv[1]
if (
	entrypoint !== undefined &&
	pathToFileURL(entrypoint).href === import.meta.url
)
	process.exitCode = await runCreateDesignCli()
