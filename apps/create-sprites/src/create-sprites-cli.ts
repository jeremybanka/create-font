#!/usr/bin/env node
import { access } from "node:fs/promises"
import { basename, resolve } from "node:path"

import { integerOption, optionValue, positionalArguments } from "./cli.ts"
import { createSpriteSource } from "./source.ts"

const argv = process.argv.slice(2)
if (argv.includes("--help") || argv.includes("-h")) {
	process.stdout.write(`create-sprites [directory] [options]\n\nCreate a source-first indexed sprite project.\n\nOptions:\n  --title <name>   Project title\n  --width <px>     Canvas width (default: 32)\n  --height <px>    Canvas height (default: 32)\n  --help            Show this help\n`)
	process.exit(0)
}

const directory = resolve(positionalArguments(argv)[0] ?? "untitled-sprite")
try {
	await access(resolve(directory, "create-sprites.json"))
	throw new Error(`${directory} is already a create-sprites project.`)
} catch (error) {
	if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
}

const project = await createSpriteSource(directory, {
	title: optionValue(argv, "--title") ?? basename(directory).replaceAll(/[-_]+/g, " ").replace(/^./, (character) => character.toUpperCase()),
	width: integerOption(argv, "--width", 32),
	height: integerOption(argv, "--height", 32),
})
process.stdout.write(`Created ${project.title} (${project.width}×${project.height}) in ${directory}\nRun \`sprites ${directory}\` to edit it.\n`)
