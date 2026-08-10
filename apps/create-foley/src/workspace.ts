import { readdir, stat } from "node:fs/promises"
import { basename, join, resolve } from "node:path"

export async function selectFoleyProject(
	rootInput: string,
	name?: string,
): Promise<Readonly<{ name: string; projectRoot: string; workspaceRoot: string }>> {
	const root = resolve(rootInput)
	if ((await stat(join(root, "create-foley.json")).catch(() => undefined))?.isFile())
		return { name: basename(root), projectRoot: root, workspaceRoot: resolve(root, "..", "..") }
	const foleysRoot = join(root, "foleys")
	if (name !== undefined)
		return { name, projectRoot: join(foleysRoot, name), workspaceRoot: root }
	const names = (await readdir(foleysRoot, { withFileTypes: true }))
		.filter((entry) => entry.isDirectory())
		.map((entry) => entry.name)
		.sort()
	if (names.length === 0) throw new Error(`No foley projects found below ${foleysRoot}.`)
	if (names.length > 1) throw new Error(`Choose a project: ${names.join(", ")}.`)
	return { name: names[0]!, projectRoot: join(foleysRoot, names[0]!), workspaceRoot: root }
}
