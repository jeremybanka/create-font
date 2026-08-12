import {
	chmod,
	lstat,
	mkdtemp,
	mkdir,
	readFile,
	readlink,
	symlink,
	writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { describe, expect, it } from "vitest"
import {
	createUiLayoutFileService,
	UiLayoutConflictError,
} from "../src/node.ts"
import { prettyUiLayoutFile } from "../src/schema.ts"
import { designLayout, fontLayout } from "./fixtures.ts"

async function roots() {
	const root = await mkdtemp(join(tmpdir(), "ui-layout-workspace-"))
	const home = await mkdtemp(join(tmpdir(), "ui-layout-home-"))
	return { root, home }
}

describe("allowlisted UI layout files", () => {
	it("loads simultaneous home and project records with origins and diagnostics", async () => {
		const paths = await roots()
		const service = createUiLayoutFileService(paths)
		for (const origin of ["home", "project"] as const) {
			const path = service.pathFor("create-font", origin)
			await mkdir(dirname(path), { recursive: true })
			await writeFile(
				path,
				prettyUiLayoutFile([{ ...fontLayout, name: "Same name" }]),
			)
		}
		const response = await service.load("create-font")
		expect(response.sources.map(({ origin }) => origin)).toEqual([
			"home",
			"project",
		])
		expect(response.sources.flatMap(({ layouts }) => layouts)).toHaveLength(2)
		expect(response.sources.every(({ issues }) => issues.length === 0)).toBe(
			true,
		)
	})

	it("retains valid records and reports file, record, and schema path", async () => {
		const paths = await roots()
		const service = createUiLayoutFileService(paths)
		const path = service.pathFor("create-font", "project")
		await mkdir(dirname(path), { recursive: true })
		await writeFile(
			path,
			JSON.stringify([fontLayout, { version: 99, id: "future" }]),
		)
		const source = await service.readSource("create-font", "project")
		expect(source.layouts).toEqual([fontLayout])
		expect(source.issues[0]).toMatchObject({ file: path, record: 1 })
		expect(source.issues[0]?.path).toContain("1")
	})

	it("upserts atomically, deterministically, and detects revision conflicts", async () => {
		const paths = await roots()
		const service = createUiLayoutFileService(paths)
		await service.save({
			product: "create-font",
			origin: "home",
			expectedRevision: null,
			layout: fontLayout,
		})
		const path = service.pathFor("create-font", "home")
		expect(await readFile(path, "utf8")).toBe(prettyUiLayoutFile([fontLayout]))
		await expect(
			service.save({
				product: "create-font",
				origin: "home",
				expectedRevision: null,
				layout: fontLayout,
			}),
		).rejects.toBeInstanceOf(UiLayoutConflictError)
		const loaded = await service.load("create-font")
		await service.save({
			product: "create-font",
			origin: "home",
			expectedRevision: loaded.sources[0]!.revision,
			layout: { ...fontLayout, name: "Updated" },
		})
		expect(JSON.parse(await readFile(path, "utf8"))).toEqual([
			{ ...fontLayout, name: "Updated" },
		])
	})

	it("loads and saves through a symlinked home .config directory", async () => {
		const paths = await roots()
		const configRepository = await mkdtemp(join(tmpdir(), "ui-layout-config-"))
		const productDirectory = join(configRepository, "create-font")
		await mkdir(productDirectory)
		await writeFile(
			join(productDirectory, "ui.json"),
			prettyUiLayoutFile([fontLayout]),
		)
		await symlink(configRepository, join(paths.home, ".config"))
		const service = createUiLayoutFileService(paths)
		const source = await service.readSource("create-font", "home")
		expect(source.layouts).toEqual([fontLayout])
		expect(source.issues).toEqual([])
		await service.save({
			product: "create-font",
			origin: "home",
			expectedRevision: source.revision,
			layout: { ...fontLayout, name: "Config repository" },
		})
		expect(
			JSON.parse(await readFile(join(productDirectory, "ui.json"), "utf8")),
		).toEqual([{ ...fontLayout, name: "Config repository" }])
		await expect(
			service.save({
				product: "create-font",
				origin: "home",
				expectedRevision: source.revision,
				layout: fontLayout,
			}),
		).rejects.toBeInstanceOf(UiLayoutConflictError)
	})

	it("uses canonical directories behind symlinked product folders", async () => {
		const paths = await roots()
		const homeProductDirectory = await mkdtemp(
			join(tmpdir(), "ui-layout-product-"),
		)
		const projectFontsDirectory = await mkdtemp(
			join(tmpdir(), "ui-layout-project-fonts-"),
		)
		await mkdir(join(paths.home, ".config"), { recursive: true })
		await symlink(
			homeProductDirectory,
			join(paths.home, ".config", "create-font"),
		)
		await symlink(projectFontsDirectory, join(paths.root, "fonts"))
		const service = createUiLayoutFileService(paths)
		await service.save({
			product: "create-font",
			origin: "home",
			expectedRevision: null,
			layout: fontLayout,
		})
		await service.save({
			product: "create-font",
			origin: "project",
			expectedRevision: null,
			layout: fontLayout,
		})
		expect(await readFile(join(homeProductDirectory, "ui.json"), "utf8")).toBe(
			prettyUiLayoutFile([fontLayout]),
		)
		expect(await readFile(join(projectFontsDirectory, "ui.json"), "utf8")).toBe(
			prettyUiLayoutFile([fontLayout]),
		)
	})

	it("preserves a symlinked ui.json while atomically updating its target", async () => {
		const paths = await roots()
		const targetDirectory = await mkdtemp(join(tmpdir(), "ui-layout-target-"))
		const target = join(targetDirectory, "font-layouts.json")
		await writeFile(target, prettyUiLayoutFile([fontLayout]))
		const service = createUiLayoutFileService(paths)
		const logical = service.pathFor("create-font", "home")
		await mkdir(dirname(logical), { recursive: true })
		await symlink(target, logical)
		const beforeLink = await readlink(logical)
		const source = await service.readSource("create-font", "home")
		await service.save({
			product: "create-font",
			origin: "home",
			expectedRevision: source.revision,
			layout: { ...fontLayout, name: "Through file link" },
		})
		expect((await lstat(logical)).isSymbolicLink()).toBe(true)
		expect(await readlink(logical)).toBe(beforeLink)
		expect(JSON.parse(await readFile(target, "utf8"))).toEqual([
			{ ...fontLayout, name: "Through file link" },
		])
	})

	it("reports broken, cyclic, and unreadable linked locations cleanly", async () => {
		const brokenPaths = await roots()
		await symlink(
			join(brokenPaths.home, "missing"),
			join(brokenPaths.home, ".config"),
		)
		await expect(
			createUiLayoutFileService(brokenPaths).readSource("create-font", "home"),
		).rejects.toThrow(/broken symbolic link/)

		const cyclicPaths = await roots()
		await symlink(".config", join(cyclicPaths.home, ".config"))
		await expect(
			createUiLayoutFileService(cyclicPaths).readSource("create-font", "home"),
		).rejects.toThrow(/cyclic symbolic link/)

		const unreadablePaths = await roots()
		const targetDirectory = await mkdtemp(
			join(tmpdir(), "ui-layout-unreadable-"),
		)
		const target = join(targetDirectory, "ui.json")
		await writeFile(target, prettyUiLayoutFile([fontLayout]))
		const logical = createUiLayoutFileService(unreadablePaths).pathFor(
			"create-font",
			"home",
		)
		await mkdir(dirname(logical), { recursive: true })
		await symlink(target, logical)
		await chmod(target, 0o000)
		try {
			await expect(
				createUiLayoutFileService(unreadablePaths).readSource(
					"create-font",
					"home",
				),
			).rejects.toThrow(/unreadable/)
		} finally {
			await chmod(target, 0o600)
		}
	})

	it("keeps product locations isolated", async () => {
		const paths = await roots()
		const service = createUiLayoutFileService(paths)
		await service.save({
			product: "create-design",
			origin: "project",
			expectedRevision: null,
			layout: designLayout,
		})
		expect(service.pathFor("create-design", "project")).toBe(
			join(paths.root, "designs", "ui.json"),
		)
		expect(
			(await service.load("create-font")).sources.flatMap(
				({ layouts }) => layouts,
			),
		).toEqual([])
	})
})
