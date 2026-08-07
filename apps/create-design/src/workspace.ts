import { readdir, stat } from "node:fs/promises"
import { basename, join, relative, resolve, sep } from "node:path"

export type DesignProject = Readonly<{
	name: string
	path: string
	root: string
}>

export async function discoverDesignProjects(
	workspaceRootInput: string = process.cwd(),
): Promise<readonly DesignProject[]> {
	const workspaceRoot = resolve(workspaceRootInput)
	const designsRoot = join(workspaceRoot, "designs")
	const entries = await readdir(designsRoot, { withFileTypes: true }).catch(
		() => [],
	)
	const projects: DesignProject[] = []
	for (const entry of entries) {
		if (
			!entry.isDirectory() ||
			entry.isSymbolicLink() ||
			!isSafeDesignProjectId(entry.name)
		)
			continue
		const root = join(designsRoot, entry.name)
		const manifest = await stat(join(root, "create-design.json")).catch(
			() => undefined,
		)
		if (!manifest?.isFile()) continue
		projects.push({
			name: entry.name,
			path: relative(workspaceRoot, root).split(sep).join("/"),
			root,
		})
	}
	return projects.toSorted((left, right) => left.name.localeCompare(right.name))
}

export async function selectDesignProject(
	workspaceRootInput: string = process.cwd(),
	designName?: string,
): Promise<DesignProject> {
	const workspaceRoot = resolve(workspaceRootInput)
	const directRoot =
		designName === undefined
			? workspaceRoot
			: resolve(workspaceRoot, designName)
	const directManifest = await stat(
		join(directRoot, "create-design.json"),
	).catch(() => undefined)
	if (directManifest?.isFile())
		return {
			name: basename(directRoot),
			path: relative(workspaceRoot, directRoot).split(sep).join("/") || ".",
			root: directRoot,
		}
	const projects = await discoverDesignProjects(workspaceRootInput)
	if (designName !== undefined) {
		const project = projects.find((candidate) => candidate.name === designName)
		if (project !== undefined) return project
		throw new Error(
			`Design project ${JSON.stringify(designName)} was not found below designs/.`,
		)
	}
	if (projects.length === 1 && projects[0] !== undefined) return projects[0]
	if (projects.length === 0)
		throw new Error("No design projects were found below designs/.")
	throw new Error(
		`Multiple design projects are available; select one by name (${projects.map((project) => project.name).join(", ")}).`,
	)
}

/** Validates an untrusted route identity before it can become a filesystem path. */
export function isSafeDesignProjectId(value: string): boolean {
	return (
		value.length > 0 &&
		value !== "." &&
		value !== ".." &&
		!value.includes("/") &&
		!value.includes("\\") &&
		!value.includes("%")
	)
}
