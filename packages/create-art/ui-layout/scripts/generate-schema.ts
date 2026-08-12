import { writeFile } from "node:fs/promises"
import { resolve } from "node:path"

import { uiLayoutJsonSchema } from "../src/schema.ts"

await writeFile(
	resolve(import.meta.dirname, "../ui-layout.schema.json"),
	`${JSON.stringify(uiLayoutJsonSchema, null, "\t")}\n`,
)
