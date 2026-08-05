import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises"
import { basename, join, resolve } from "node:path"

import { createInitialDocument } from "@create-design/source"

import { type RuntimeAdapter, nodeRuntimeAdapter } from "./runtime.ts"
import { initializeDesignSourceWorkspace } from "./source-service.ts"

const PACKAGE_NAME = "create-design"
const designNamePattern = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/u
export const packageManagers = ["npm", "pnpm", "yarn", "bun"] as const
export type PackageManager = (typeof packageManagers)[number]

export function isPackageManager(value: string): value is PackageManager {
	return packageManagers.some((packageManager) => packageManager === value)
}

export type CreateDesignWorkspaceOptions = Readonly<{
	cwd?: string
	install?: boolean
	name?: string
	packageManager?: PackageManager
	runtime?: RuntimeAdapter
}>

export type CreatedDesignWorkspace = Readonly<{
	designName: string
	designRoot: string
	installed: boolean
	workspaceCreated: boolean
	workspaceRoot: string
}>

async function pathType(path: string): Promise<"directory" | "file" | null> {
	const value = await stat(path).catch(() => undefined)
	if (value?.isDirectory()) return "directory"
	if (value?.isFile()) return "file"
	return null
}

async function isCreateDesignWorkspace(root: string): Promise<boolean> {
	if ((await pathType(join(root, "designs"))) === "directory") return true
	const packageJson = await readFile(join(root, "package.json"), "utf8").catch(
		() => undefined,
	)
	if (packageJson === undefined) return false
	try {
		const value = JSON.parse(packageJson) as Record<string, unknown>
		for (const key of ["dependencies", "devDependencies"]) {
			const dependencies = value[key]
			if (
				typeof dependencies === "object" &&
				dependencies !== null &&
				Object.hasOwn(dependencies, PACKAGE_NAME)
			)
				return true
		}
	} catch {
		return false
	}
	return false
}

function validateDesignName(name: string): string {
	if (!designNamePattern.test(name))
		throw new Error(
			`Design name ${JSON.stringify(name)} must contain only letters, numbers, dots, hyphens, and underscores.`,
		)
	return name
}

function displayName(name: string): string {
	return name
		.split(/[._-]+/u)
		.filter(Boolean)
		.map((part) => part[0]?.toUpperCase() + part.slice(1))
		.join(" ")
}

async function packageVersion(): Promise<string> {
	const value = JSON.parse(
		await readFile(resolve(import.meta.dirname, "../package.json"), "utf8"),
	) as { version?: unknown }
	if (typeof value.version !== "string")
		throw new Error("The create-design package has no valid version.")
	return value.version
}

async function createWorkspaceFiles(root: string, name: string): Promise<void> {
	await mkdir(root, { recursive: true })
	await writeFile(
		join(root, "package.json"),
		`${JSON.stringify(
			{
				name,
				private: true,
				type: "module",
				scripts: { build: "design build", dev: "design dev" },
				devDependencies: { [PACKAGE_NAME]: await packageVersion() },
			},
			null,
			"\t",
		)}\n`,
		{ flag: "wx" },
	)
	await writeFile(join(root, ".gitignore"), "node_modules\nartifacts\n", {
		flag: "wx",
	})
}

async function installWorkspace(
	root: string,
	packageManager: PackageManager,
	runtime: RuntimeAdapter,
): Promise<void> {
	const result = await runtime.run(packageManager, ["install"], {
		cwd: root,
		stderr: "inherit",
		stdout: "inherit",
	})
	if (result.exitCode !== 0)
		throw new Error(
			`${packageManager} install exited with status ${result.exitCode ?? "unknown"}.`,
		)
}

export async function createDesignWorkspace(
	options: CreateDesignWorkspaceOptions = {},
): Promise<CreatedDesignWorkspace> {
	const cwd = resolve(options.cwd ?? process.cwd())
	const workspaceExists = await isCreateDesignWorkspace(cwd)
	const requestedName = options.name
	const workspaceRoot = workspaceExists
		? cwd
		: requestedName === undefined
			? cwd
			: resolve(cwd, requestedName)
	const designName = validateDesignName(
		workspaceExists
			? (requestedName ?? basename(cwd))
			: basename(workspaceRoot),
	)
	const workspaceCreated = !workspaceExists

	if (workspaceCreated) {
		const targetType = await pathType(workspaceRoot)
		if (targetType === "file")
			throw new Error(`${workspaceRoot} already exists and is not a directory.`)
		if (targetType === "directory" && (await readdir(workspaceRoot)).length > 0)
			throw new Error(`${workspaceRoot} already exists and is not empty.`)
		await createWorkspaceFiles(workspaceRoot, designName)
	}

	const designRoot = join(workspaceRoot, "designs", designName)
	if ((await pathType(designRoot)) !== null)
		throw new Error(
			`Design project ${JSON.stringify(designName)} already exists.`,
		)
	await mkdir(join(workspaceRoot, "designs"), { recursive: true })
	const document = {
		...createInitialDocument(),
		title: displayName(designName),
	}
	await initializeDesignSourceWorkspace(designRoot, document)

	const install = options.install ?? workspaceCreated
	if (install)
		await installWorkspace(
			workspaceRoot,
			options.packageManager ?? "npm",
			options.runtime ?? nodeRuntimeAdapter,
		)
	return {
		designName,
		designRoot,
		installed: install,
		workspaceCreated,
		workspaceRoot,
	}
}
