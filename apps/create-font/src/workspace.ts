import { readdir, stat } from "node:fs/promises"
import { join, relative, resolve, sep } from "node:path"

export type FontProject = Readonly<{
	name: string
	path: string
	root: string
}>

export function isSafeFontProjectId(value: string): boolean {
	return (
		value.length > 0 &&
		value !== `.` &&
		value !== `..` &&
		!value.includes(`/`) &&
		!value.includes(`\\`) &&
		!value.includes(`\0`)
	)
}

export async function discoverFontProjects(
	workspaceRootInput: string = process.cwd(),
): Promise<readonly FontProject[]> {
	const workspaceRoot = resolve(workspaceRootInput)
	const fontsRoot = join(workspaceRoot, `fonts`)
	const entries = await readdir(fontsRoot, { withFileTypes: true }).catch(
		() => [],
	)
	const projects: FontProject[] = []
	for (const entry of entries) {
		if (
			!entry.isDirectory() ||
			entry.isSymbolicLink() ||
			!isSafeFontProjectId(entry.name)
		)
			continue
		const root = join(fontsRoot, entry.name)
		const manifest = await stat(join(root, `create-font.json`)).catch(
			() => undefined,
		)
		if (!manifest?.isFile()) continue
		projects.push({
			name: entry.name,
			path: relative(workspaceRoot, root).split(sep).join(`/`),
			root,
		})
	}
	return projects.toSorted((left, right) => left.name.localeCompare(right.name))
}

export async function selectFontProject(
	workspaceRootInput: string = process.cwd(),
	fontName?: string,
): Promise<FontProject> {
	const projects = await discoverFontProjects(workspaceRootInput)
	if (fontName !== undefined) {
		const project = projects.find((candidate) => candidate.name === fontName)
		if (project !== undefined) return project
		throw new Error(
			`Font project ${JSON.stringify(fontName)} was not found below fonts/.`,
		)
	}
	if (projects.length === 1 && projects[0] !== undefined) return projects[0]
	if (projects.length === 0) {
		throw new Error(`No font projects were found below fonts/.`)
	}
	throw new Error(
		`Multiple font projects are available; select one with --font (${projects.map((project) => project.name).join(`, `)}).`,
	)
}
