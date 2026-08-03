#!/usr/bin/env node

import {
	readFile,
	readdir,
	stat,
	writeFile,
} from "node:fs/promises"
import { extname, relative, resolve } from "node:path"
import { pathToFileURL } from "node:url"

import {
	formatSourceFea,
	formatSourceJson,
	type SourceJsonValue,
} from "./index.ts"

const supportedExtensions = new Set([".fea", ".json"])
const ignoredDirectoryNames = new Set([
	".create-design",
	".create-font",
	".git",
	"node_modules",
])

export type SourceFormatCliIo = Readonly<{
	stdout: Pick<NodeJS.WritableStream, "write">
	stderr: Pick<NodeJS.WritableStream, "write">
}>

const defaultIo: SourceFormatCliIo = {
	stdout: process.stdout,
	stderr: process.stderr,
}

function writeLine(
	stream: Pick<NodeJS.WritableStream, "write">,
	text: string,
): void {
	stream.write(`${text}\n`)
}

function formatSourceText(path: string, text: string): string {
	switch (extname(path).toLowerCase()) {
		case ".json":
			return formatSourceJson(JSON.parse(text) as SourceJsonValue, path)
		case ".fea":
			return formatSourceFea(text, path)
		default:
			throw new Error(`Unsupported source extension: ${path}`)
	}
}

async function collectDirectoryFiles(directory: string): Promise<readonly string[]> {
	const files: string[] = []
	for (
		const entry of (await readdir(directory, { withFileTypes: true })).toSorted(
			(left, right) => left.name.localeCompare(right.name),
		)
	) {
		const path = resolve(directory, entry.name)
		if (entry.isDirectory()) {
			if (!ignoredDirectoryNames.has(entry.name)) {
				files.push(...(await collectDirectoryFiles(path)))
			}
		} else if (entry.isFile() && supportedExtensions.has(extname(entry.name))) {
			files.push(path)
		}
	}
	return files
}

async function collectFiles(
	inputs: readonly string[],
	cwd: string,
): Promise<readonly string[]> {
	const files = new Set<string>()
	for (const input of inputs.length === 0 ? ["."] : inputs) {
		const path = resolve(cwd, input)
		const metadata = await stat(path)
		if (metadata.isDirectory()) {
			for (const file of await collectDirectoryFiles(path)) files.add(file)
		} else if (
			metadata.isFile() &&
			supportedExtensions.has(extname(path).toLowerCase())
		) {
			files.add(path)
		} else {
			throw new Error(`Expected a JSON, FEA, or directory path: ${input}`)
		}
	}
	return [...files].toSorted()
}

const help = `Usage: create-source-format <fmt|check> [path ...]

Canonicalize application-owned JSON and Adobe feature source with the pinned
create-art formatting contract. Directories are searched recursively.

  create-source-format fmt fonts designs
  create-source-format check fonts/my-font designs/my-design`

export async function runSourceFormatCli(
	args: readonly string[] = process.argv.slice(2),
	io: SourceFormatCliIo = defaultIo,
	cwd = process.cwd(),
): Promise<number> {
	const [command, ...inputs] = args
	if (command === "--help" || command === "-h") {
		writeLine(io.stdout, help)
		return 0
	}
	if (command !== "fmt" && command !== "check") {
		writeLine(io.stderr, help)
		return 2
	}

	try {
		const files = await collectFiles(inputs, cwd)
		let changed = 0
		for (const path of files) {
			const before = await readFile(path, "utf8")
			const after = formatSourceText(path, before)
			if (after === before) continue
			changed += 1
			const displayPath = relative(cwd, path) || path
			if (command === "fmt") {
				await writeFile(path, after)
				writeLine(io.stdout, `Formatted ${displayPath}`)
			} else {
				writeLine(io.stderr, `Not canonical: ${displayPath}`)
			}
		}
		if (command === "check" && changed > 0) {
			writeLine(
				io.stderr,
				`${changed} source ${changed === 1 ? "file is" : "files are"} not canonical.`,
			)
			return 1
		}
		return 0
	} catch (error) {
		writeLine(io.stderr, error instanceof Error ? error.message : String(error))
		return 2
	}
}

const entrypoint = process.argv[1]
if (
	entrypoint !== undefined &&
	import.meta.url === pathToFileURL(resolve(entrypoint)).href
) {
	process.exitCode = await runSourceFormatCli()
}
