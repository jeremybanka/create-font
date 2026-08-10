#!/usr/bin/env node
import { access } from "node:fs/promises"
import { resolve } from "node:path"

import { integerOption, optionValue, positionalArguments } from "./cli.ts"
import { startSpriteServer } from "./server.ts"

const argv = process.argv.slice(2)
if (argv.includes("--help") || argv.includes("-h")) {
	process.stdout.write(`sprites [directory] [options]\n\nOpen a create-sprites project in the browser editor.\n\nOptions:\n  --port <port>    Server port (default: 16388)\n  --host <host>    Bind address (default: 127.0.0.1)\n  --help           Show this help\n`)
	process.exit(0)
}

const projectRoot = resolve(positionalArguments(argv)[0] ?? ".")
const packageRoot = resolve(import.meta.dirname, "..")
const assets = resolve(packageRoot, "dist", "browser")
await access(resolve(projectRoot, "create-sprites.json"))
await access(resolve(assets, "index.html"))
const port = integerOption(argv, "--port", 16_388)
const host = optionValue(argv, "--host") ?? "127.0.0.1"
await startSpriteServer({ root: projectRoot, port, hostname: host, assets })
process.stdout.write(`create-sprites editing ${projectRoot}\nhttp://${host}:${port}/\n`)
