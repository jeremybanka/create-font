import { resolve } from "node:path"

import { integerOption, optionValue } from "../src/cli.ts"
import { startSpriteServer } from "../src/server.ts"

const argv = process.argv.slice(2)
const root = resolve(optionValue(argv, "--root") ?? ".")
const port = integerOption(argv, "--port", 16_389)
await startSpriteServer({ root, port })
process.stdout.write(`create-sprites source API http://127.0.0.1:${port}/api/project\n`)
