import { resolve } from "node:path"

import {
	DEFAULT_DEV_PORT,
	optionValue,
	resolveDevPort,
} from "../../../scripts/dev-ports.ts"
import { startCreateDesignServer } from "../src/server.ts"

const argv = process.argv.slice(2)
const root = resolve(
	optionValue(argv, `--root`) ??
		resolve(import.meta.dirname, `../dist/dev/source`),
)
const port = resolveDevPort({
	argv,
	defaultPort: DEFAULT_DEV_PORT + 3,
	portCount: 1,
})
const { url } = await startCreateDesignServer({ port, root })

process.stdout.write(`create-design is serving ${root} at ${url.href}\n`)
