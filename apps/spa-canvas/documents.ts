import { readdir, readFile } from "node:fs/promises"
import { resolve } from "node:path"

import { assembleDesignDocument } from "@create-design/source"
import { assembleEditorFontSource } from "@create-font/source"

/** Read and validate repository fixtures without starting a server or writing source. */
export async function readPrototypeDocuments() {
	const repository = resolve(import.meta.dirname, "../..")
	async function readUnits(relativeRoot: string) {
		const root = resolve(repository, relativeRoot)
		const paths = (await readdir(root, { recursive: true }))
			.filter((path) => /\.(json|fea)$/.test(path))
			.toSorted()
		const entries = await Promise.all(
			paths.map(async (path) => {
				const text = await readFile(resolve(root, path), "utf8")
				return [
					path,
					path.endsWith(".json") ? (JSON.parse(text) as unknown) : text,
				] as const
			}),
		)
		return {
			files: Object.fromEntries(entries),
			paths: paths.map((path) => resolve(root, path)),
		}
	}
	const [fontUnits, designUnits] = await Promise.all([
		readUnits("fonts/workbench-sans"),
		readUnits("designs/create-design-logo"),
	])
	const font = assembleEditorFontSource(fontUnits.files)
	const design = assembleDesignDocument(designUnits.files)
	if (!font.ok)
		throw new Error(`Invalid font fixture: ${JSON.stringify(font.errors)}`)
	if (!design.ok)
		throw new Error(`Invalid design fixture: ${JSON.stringify(design.errors)}`)
	return {
		font: font.value,
		design: design.value,
		paths: [...fontUnits.paths, ...designUnits.paths],
	}
}
