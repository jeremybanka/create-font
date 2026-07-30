#!/usr/bin/env node

import { access } from "node:fs/promises"
import { resolve } from "node:path"

import { startCreateDesignServer } from "./server.ts"

function option(name: string): string | undefined {
	const index = process.argv.indexOf(name)
	return index === -1 ? undefined : process.argv[index + 1]
}

const positional = process.argv
	.slice(2)
	.filter(
		(value, index, values) =>
			!value.startsWith(`--`) &&
			(index === 0 || !values[index - 1]?.startsWith(`--`)),
	)
const root = resolve(positional[0] ?? process.cwd())
const assets = resolve(import.meta.dirname, `../dist`)
if (
	!(await access(resolve(assets, `index.html`)).then(
		() => true,
		() => false,
	))
) {
	throw new Error(`Build create-design before starting its workspace server.`)
}
const portValue = option(`--port`)
const port = portValue === undefined ? 3010 : Number.parseInt(portValue, 10)
if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
	throw new Error(`--port must be an integer from 1 through 65535.`)
}
const { url } = await startCreateDesignServer({
	assets,
	port,
	root,
})
process.stdout.write(`create-design serving ${root} at ${url.href}\n`)
