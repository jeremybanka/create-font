import {
	mkdir,
	mkdtemp,
	readFile,
	readdir,
	rename,
	rm,
	stat,
	writeFile,
} from "node:fs/promises"
import { basename, dirname, join, resolve } from "node:path"

import { formatSourceFea } from "@create-art/source-format"
import {
	CREATE_FONT_SOURCE_FORMAT,
	CREATE_FONT_SOURCE_VERSION,
	formatSourceUnit,
	splitEditorFontSource,
	sourceUnitKindForPath,
	type FontSourceDirectoryFiles,
	type ImportedGlyphsSource,
} from "@create-font/source"
import {
	CREATE_FONT_EDITOR_FORMAT,
	CREATE_FONT_EDITOR_VERSION,
} from "@create-font/states"

import { nodeRuntimeAdapter, type RuntimeAdapter } from "./runtime.ts"

const PACKAGE_NAME = "create-font"
const fontNamePattern = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/u
export const packageManagers = [`npm`, `pnpm`, `yarn`, `bun`] as const
export type PackageManager = (typeof packageManagers)[number]

export function isPackageManager(value: string): value is PackageManager {
	return packageManagers.some((packageManager) => packageManager === value)
}

export type CreateFontWorkspaceOptions = Readonly<{
	cwd?: string
	install?: boolean
	name?: string
	packageManager?: PackageManager
	runtime?: RuntimeAdapter
	/** Validated import payload used instead of the empty starter font. */
	imported?: ImportedGlyphsSource
}>

export type CreatedFontWorkspace = Readonly<{
	fontName: string
	fontRoot: string
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

async function isCreateFontWorkspace(root: string): Promise<boolean> {
	if ((await pathType(join(root, "fonts"))) === "directory") return true
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

function validateFontName(name: string): string {
	if (!fontNamePattern.test(name)) {
		throw new Error(
			`Font name ${JSON.stringify(name)} must contain only letters, numbers, dots, hyphens, and underscores.`,
		)
	}
	return name
}

function displayName(name: string): string {
	return name
		.split(/[._-]+/u)
		.filter(Boolean)
		.map((part) => part[0]?.toUpperCase() + part.slice(1))
		.join(" ")
}

function initialFontFiles(name: string): FontSourceDirectoryFiles {
	const family = displayName(name)
	const compactFamily = family.replace(/[^A-Za-z0-9]/gu, "")
	const defaultMasterId = "master:default"
	return {
		"create-font.json": {
			format: CREATE_FONT_SOURCE_FORMAT,
			sourceVersion: CREATE_FONT_SOURCE_VERSION,
			editorFormat: CREATE_FONT_EDITOR_FORMAT,
			editorVersion: CREATE_FONT_EDITOR_VERSION,
		},
		"metadata.json": {
			unitsPerEm: 1000,
			fontRevision: 1,
			vendorId: "NONE",
			lowestPpem: 8,
		},
		"names.json": {
			family,
			subfamily: "Regular",
			uniqueId: `${family}:Regular:1.000`,
			fullName: `${family} Regular`,
			version: "Version 1.000",
			postScriptName: `${compactFamily}-Regular`,
			typographicFamily: family,
			typographicSubfamily: "Regular",
		},
		"metrics.json": {
			ascender: 800,
			descender: -200,
			lineGap: 0,
			winAscent: 800,
			winDescent: 200,
			xHeight: 500,
			capHeight: 700,
			underlinePosition: -100,
			underlineThickness: 50,
			overshoots: {
				baseline: 0,
				ascender: 0,
				descender: 0,
				winAscent: 0,
				winDescent: 0,
				xHeight: 0,
				capHeight: 0,
				underlinePosition: 0,
			},
		},
		"style.json": {
			weightClass: 400,
			widthClass: 5,
			italic: false,
			bold: false,
			oblique: false,
			italicAngle: 0,
		},
		"axes/index.json": [],
		"masters/index.json": {
			defaultMasterId,
			entries: [{ id: defaultMasterId, path: "masters/default.json" }],
		},
		"masters/default.json": {
			id: defaultMasterId,
			kind: "default",
			name: "Default",
		},
		"instances/index.json": [],
		"glyphs/index.json": [],
		"cmap/index.json": [],
		"features/index.json": [],
	}
}

async function packageVersion(): Promise<string> {
	const value = JSON.parse(
		await readFile(resolve(import.meta.dirname, "../package.json"), "utf8"),
	) as { version?: unknown }
	if (typeof value.version !== "string") {
		throw new Error("The create-font package has no valid version.")
	}
	return value.version
}

async function writeJson(path: string, value: unknown): Promise<void> {
	await mkdir(dirname(path), { recursive: true })
	await writeFile(path, `${JSON.stringify(value, null, "\t")}\n`, {
		flag: "wx",
	})
}

async function createWorkspaceFiles(root: string, name: string): Promise<void> {
	await mkdir(root, { recursive: true })
	await writeJson(join(root, "package.json"), {
		name,
		private: true,
		type: "module",
		scripts: { build: "font build", dev: "font dev" },
		devDependencies: { [PACKAGE_NAME]: await packageVersion() },
	})
	await writeFile(join(root, ".gitignore"), "node_modules\ndist\n", {
		flag: "wx",
	})
}

async function createFontFiles(
	root: string,
	name: string,
	imported?: ImportedGlyphsSource,
): Promise<void> {
	const parent = dirname(root)
	const temporaryRoot = await mkdtemp(join(parent, `.${name}-import-`))
	try {
		const files: Record<string, unknown> =
			imported === undefined
				? initialFontFiles(name)
				: (() => {
						const result = splitEditorFontSource(imported.source)
						if (!result.ok)
							throw new Error(
								result.errors
									.map(
										(error) =>
											`${error.unitPath ?? "source"}${error.path}: ${error.message}`,
									)
									.join("\n"),
							)
						return { ...result.value }
					})()
		if (imported !== undefined)
			files["features/index.json"] =
				imported.featureSource === undefined
					? []
					: [{ path: "features/glyphs-import.fea" }]
		for (const [path, value] of Object.entries(files)) {
			const destination = join(temporaryRoot, path)
			const kind = sourceUnitKindForPath(path)
			if (kind === null) throw new Error(`Unknown font source path ${path}.`)
			const formatted = formatSourceUnit(kind, value, path)
			if (!formatted.ok) {
				throw new Error(
					formatted.errors
						.map(
							(error) =>
								`${error.unitPath ?? path}${error.path}: ${error.message}`,
						)
						.join(`\n`),
				)
			}
			await mkdir(dirname(destination), { recursive: true })
			await writeFile(destination, formatted.value, { flag: "wx" })
		}
		if (imported?.featureSource !== undefined) {
			await mkdir(join(temporaryRoot, "features"), { recursive: true })
			await writeFile(
				join(temporaryRoot, "features", "glyphs-import.fea"),
				formatSourceFea(imported.featureSource, "features/glyphs-import.fea"),
				{ flag: "wx" },
			)
		}
		await rename(temporaryRoot, root)
	} catch (error) {
		await rm(temporaryRoot, { force: true, recursive: true })
		throw error
	}
}

async function installWorkspace(
	root: string,
	packageManager: PackageManager,
	runtime: RuntimeAdapter,
): Promise<void> {
	const result = await runtime.run(packageManager, [`install`], {
		cwd: root,
		stderr: `inherit`,
		stdout: `inherit`,
	})
	if (result.exitCode !== 0) {
		throw new Error(
			`${packageManager} install exited with status ${result.exitCode ?? `unknown`}.`,
		)
	}
}

export async function createFontWorkspace(
	options: CreateFontWorkspaceOptions = {},
): Promise<CreatedFontWorkspace> {
	const cwd = resolve(options.cwd ?? process.cwd())
	const workspaceExists = await isCreateFontWorkspace(cwd)
	const requestedName = options.name
	const workspaceRoot = workspaceExists
		? cwd
		: requestedName === undefined
			? cwd
			: resolve(cwd, requestedName)
	const fontName = validateFontName(
		workspaceExists
			? (requestedName ?? basename(cwd))
			: basename(workspaceRoot),
	)
	const workspaceCreated = !workspaceExists
	let targetType: Awaited<ReturnType<typeof pathType>> = null

	if (workspaceCreated) {
		targetType = await pathType(workspaceRoot)
		if (targetType === "file") {
			throw new Error(`${workspaceRoot} already exists and is not a directory.`)
		}
		if (
			targetType === "directory" &&
			(await readdir(workspaceRoot)).length > 0
		) {
			throw new Error(`${workspaceRoot} already exists and is not empty.`)
		}
	}

	const fontRoot = join(workspaceRoot, "fonts", fontName)
	if ((await pathType(fontRoot)) !== null) {
		throw new Error(`Font project ${JSON.stringify(fontName)} already exists.`)
	}
	if (workspaceCreated && targetType === null) {
		const temporaryWorkspaceRoot = await mkdtemp(
			join(dirname(workspaceRoot), `.${basename(workspaceRoot)}-create-`),
		)
		try {
			await createWorkspaceFiles(temporaryWorkspaceRoot, fontName)
			await mkdir(join(temporaryWorkspaceRoot, "fonts"), { recursive: true })
			await createFontFiles(
				join(temporaryWorkspaceRoot, "fonts", fontName),
				fontName,
				options.imported,
			)
			await rename(temporaryWorkspaceRoot, workspaceRoot)
		} catch (error) {
			await rm(temporaryWorkspaceRoot, { force: true, recursive: true })
			throw error
		}
	} else {
		if (workspaceCreated) await createWorkspaceFiles(workspaceRoot, fontName)
		await mkdir(join(workspaceRoot, "fonts"), { recursive: true })
		await createFontFiles(fontRoot, fontName, options.imported)
	}

	const install = options.install ?? workspaceCreated
	if (install) {
		await installWorkspace(
			workspaceRoot,
			options.packageManager ?? `npm`,
			options.runtime ?? nodeRuntimeAdapter,
		)
	}
	return {
		fontName,
		fontRoot,
		installed: install,
		workspaceCreated,
		workspaceRoot,
	}
}
