import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises"
import { basename, join, resolve } from "node:path"

import { createInitialFoleyProject } from "@create-foley/source"

import { nodeRuntimeAdapter, type RuntimeAdapter } from "./runtime.ts"
import { writeFoleyProject } from "./source-store.ts"

export const packageManagers = ["npm", "pnpm", "yarn", "bun"] as const
export type PackageManager = (typeof packageManagers)[number]
const namePattern = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/u

export function isPackageManager(value: string): value is PackageManager {
	return packageManagers.some((manager) => manager === value)
}

async function exists(path: string): Promise<boolean> {
	return (await stat(path).catch(() => undefined)) !== undefined
}

async function isWorkspace(root: string): Promise<boolean> {
	if ((await stat(join(root, "foleys")).catch(() => undefined))?.isDirectory()) return true
	const text = await readFile(join(root, "package.json"), "utf8").catch(() => undefined)
	if (text === undefined) return false
	try {
		const packageJson = JSON.parse(text) as Record<string, unknown>
		return ["dependencies", "devDependencies"].some((key) => {
			const dependencies = packageJson[key]
			return typeof dependencies === "object" && dependencies !== null && Object.hasOwn(dependencies, "create-foley")
		})
	} catch { return false }
}

async function packageVersion(): Promise<string> {
	const value = JSON.parse(await readFile(resolve(import.meta.dirname, "../package.json"), "utf8")) as { version?: unknown }
	if (typeof value.version !== "string") throw new Error("create-foley has no valid package version.")
	return value.version
}

export async function createFoleyWorkspace(options: Readonly<{
	cwd?: string
	install?: boolean
	name?: string
	packageManager?: PackageManager
	runtime?: RuntimeAdapter
}> = {}) {
	const cwd = resolve(options.cwd ?? process.cwd())
	const workspaceExists = await isWorkspace(cwd)
	const workspaceRoot = workspaceExists ? cwd : options.name === undefined ? cwd : resolve(cwd, options.name)
	const name = options.name ?? basename(workspaceRoot)
	if (!namePattern.test(name)) throw new Error(`Invalid foley project name ${JSON.stringify(name)}.`)
	if (!workspaceExists) {
		if (await exists(workspaceRoot)) {
			const entries = await readdir(workspaceRoot)
			if (entries.length > 0) throw new Error(`${workspaceRoot} already exists and is not empty.`)
		}
		await mkdir(workspaceRoot, { recursive: true })
		await writeFile(join(workspaceRoot, "package.json"), `${JSON.stringify({
			name,
			private: true,
			type: "module",
			scripts: { build: "foley render", check: "foley check", dev: "foley dev" },
			devDependencies: { "create-foley": await packageVersion() },
		}, null, "\t")}\n`, { flag: "wx" })
		await writeFile(join(workspaceRoot, ".gitignore"), "node_modules\nartifacts\n", { flag: "wx" })
	}
	const projectRoot = join(workspaceRoot, "foleys", name)
	if (await exists(projectRoot)) throw new Error(`Foley project ${name} already exists.`)
	await writeFoleyProject(projectRoot, createInitialFoleyProject(name.split(/[._-]+/u).map((part) => part[0]?.toUpperCase() + part.slice(1)).join(" ")))
	const install = options.install ?? !workspaceExists
	if (install) {
		const manager = options.packageManager ?? "npm"
		const exitCode = await (options.runtime ?? nodeRuntimeAdapter).run(manager, ["install"], workspaceRoot)
		if (exitCode !== 0) throw new Error(`${manager} install exited with status ${exitCode ?? "unknown"}.`)
	}
	return { installed: install, name, projectRoot, workspaceCreated: !workspaceExists, workspaceRoot }
}
