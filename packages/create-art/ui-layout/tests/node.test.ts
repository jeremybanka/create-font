import { mkdtemp, mkdir, readFile, symlink, writeFile } from "node:fs/promises"
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

	it("rejects symlink escapes for both read and write", async () => {
		const paths = await roots()
		const outside = await mkdtemp(join(tmpdir(), "ui-layout-outside-"))
		await symlink(outside, join(paths.root, "fonts"))
		const service = createUiLayoutFileService(paths)
		await expect(service.readSource("create-font", "project")).rejects.toThrow(
			/symbolic link/,
		)
		await expect(
			service.save({
				product: "create-font",
				origin: "project",
				expectedRevision: null,
				layout: fontLayout,
			}),
		).rejects.toThrow(/symbolic link/)
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
