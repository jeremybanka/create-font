import { resolve } from "node:path"

import { buildBrowserApplication } from "./build-browser.ts"

const packageRoot = resolve(import.meta.dirname, `..`)
const outdir = resolve(packageRoot, `dist/dev/public`)

await buildBrowserApplication(outdir, { workspaceSources: true })
