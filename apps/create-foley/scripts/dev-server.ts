import { resolve } from "node:path"

import { startCreateFoleyServer } from "../src/server.ts"

function value(name: string, fallback: string): string {
	const prefix = `${name}=`
	return process.argv.slice(2).find((argument) => argument.startsWith(prefix))?.slice(prefix.length) ?? fallback
}

const root = resolve(value("--root", resolve(import.meta.dirname, "../../../foleys/workbench-impact")))
const port = Number(value("--port", "16389"))
const { url } = await startCreateFoleyServer({ root, port })
process.stdout.write(`create-foley is serving ${root} at ${url.href}\n`)
