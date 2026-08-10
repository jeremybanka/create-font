import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"

import {
	assembleFoleyProject,
	splitFoleyProject,
	type FoleyProject,
} from "@create-foley/source"

type LayerIndex = Readonly<{ layers: readonly { path: string }[] }>

export async function readFoleyProject(rootInput: string): Promise<FoleyProject> {
	const root = resolve(rootInput)
	const files = new Map<string, string>()
	files.set("create-foley.json", await readFile(join(root, "create-foley.json"), "utf8"))
	const indexText = await readFile(join(root, "layers/index.json"), "utf8")
	files.set("layers/index.json", indexText)
	const index = JSON.parse(indexText) as LayerIndex
	if (!Array.isArray(index.layers)) throw new Error("Invalid layers/index.json.")
	for (const entry of index.layers) {
		if (typeof entry.path !== "string" || !/^layers\/.+\.json$/u.test(entry.path))
			throw new Error("Invalid layer path in layers/index.json.")
		files.set(entry.path, await readFile(join(root, entry.path), "utf8"))
	}
	return assembleFoleyProject(files)
}

export async function writeFoleyProject(
	rootInput: string,
	project: FoleyProject,
): Promise<void> {
	const root = resolve(rootInput)
	for (const [path, text] of splitFoleyProject(project)) {
		const output = join(root, path)
		await mkdir(dirname(output), { recursive: true })
		const temporary = `${output}.tmp-${process.pid}-${Date.now()}`
		await writeFile(temporary, text, { flag: "wx" })
		await rename(temporary, output)
	}
}
