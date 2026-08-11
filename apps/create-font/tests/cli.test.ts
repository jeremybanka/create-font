import { afterEach, describe, expect, it } from "vitest"
import {
	mkdir,
	mkdtemp,
	readFile,
	readdir,
	rm,
	writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { runCreateFontCli } from "../src/create-font-cli.ts"
import { createFontWorkspace } from "../src/create.ts"
import { runFontCli } from "../src/font-cli.ts"
import { createFileSystemSourceService } from "../src/source-service.ts"
import { discoverFontProjects } from "../src/workspace.ts"
import { assembleEditorFontSource } from "@create-font/source"

function captureIo() {
	const stderr: string[] = []
	const stdout: string[] = []
	return {
		io: {
			stderr: { write: (value: string) => void stderr.push(value) },
			stdout: { write: (value: string) => void stdout.push(value) },
		},
		stderr,
		stdout,
	}
}

const temporaryRoots: string[] = []

async function temporaryRoot(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "create-font-cli-"))
	temporaryRoots.push(root)
	return root
}

afterEach(async () => {
	await Promise.all(
		temporaryRoots
			.splice(0)
			.map((root) => rm(root, { force: true, recursive: true })),
	)
})

describe(`create-font CLI`, () => {
	it(`renders initializer help`, async () => {
		const captured = captureIo()
		const exitCode = await runCreateFontCli(
			[`node`, `create-font`, `--help`],
			captured.io,
		)

		expect(exitCode).toBe(0)
		expect(captured.stdout.join(``)).toContain(`Create a font workspace`)
		expect(captured.stdout.join(``)).toContain(`--package-manager`)
	})

	it(`creates a workspace with one valid font and the local tool dependency`, async () => {
		const cwd = await temporaryRoot()
		const result = await createFontWorkspace({
			cwd,
			install: false,
			name: `my-font`,
		})

		expect(result.workspaceCreated).toBe(true)
		expect(result.fontName).toBe(`my-font`)
		const createFontPackageJson = JSON.parse(
			await readFile(join(import.meta.dirname, `../package.json`), `utf8`),
		) as { version: string }
		const packageJson = JSON.parse(
			await readFile(join(result.workspaceRoot, `package.json`), `utf8`),
		) as { devDependencies: Record<string, string> }
		expect(packageJson.devDependencies[`create-font`]).toBe(
			createFontPackageJson.version,
		)
		expect(result.installed).toBe(false)

		const projects = await discoverFontProjects(result.workspaceRoot)
		expect(projects.map((project) => project.name)).toEqual([`my-font`])
		const source = await createFileSystemSourceService(result.fontRoot)
		expect((await source.readManifest()).units.length).toBe(12)
		expect(
			JSON.parse(
				await readFile(join(result.fontRoot, `features/index.json`), `utf8`),
			),
		).toEqual([])
	})

	it(`imports a Glyphs source into an atomically created native project`, async () => {
		const cwd = await temporaryRoot()
		await writeFile(
			join(cwd, `imported-font.glyphs`),
			`{
			familyName = Imported;
			fontMaster = ({ ascender = 800; capHeight = 700; descender = -200; id = regular; xHeight = 500; });
			glyphs = (
			{ glyphname = .notdef; layers = ({ layerId = regular; width = 500; }); },
			{ glyphname = A; layers = ({ layerId = regular; paths = ({ closed = 1; nodes = ("0 0 LINE", "50 100 LINE", "100 0 LINE"); }); width = 120; }); unicode = 0041; }
			);
			features = ({ code = "sub A by .notdef;"; name = salt; });
			unitsPerEm = 1000;
			}`,
		)
		const captured = captureIo()
		const exitCode = await runCreateFontCli(
			[`node`, `create-font`, `--from`, `imported-font.glyphs`, `--no-install`],
			captured.io,
			cwd,
		)

		expect(exitCode).toBe(0)
		expect(captured.stderr).toEqual([])
		const projects = await discoverFontProjects(join(cwd, `imported-font`))
		expect(projects).toHaveLength(1)
		const service = await createFileSystemSourceService(projects[0]?.root ?? ``)
		const files = Object.fromEntries(
			await Promise.all(
				(await service.readManifest()).units.map(
					async ({ path }: { path: string }) => [
						path,
						(await service.readUnit(path)).value,
					],
				),
			),
		)
		const assembled = assembleEditorFontSource(files)
		expect(assembled.ok).toBe(true)
		if (assembled.ok) {
			expect(assembled.value.names.family).toBe(`Imported`)
			const glyph = assembled.value.glyphs.find((item) => item.name === `A`)
			expect(glyph?.layers[0]?.contours[0]?.points).toHaveLength(3)
			expect(assembled.value.cmap).toEqual([
				{ codePoint: 0x41, glyphId: `glyph:A` },
			])
		}
		expect(
			JSON.parse(
				await readFile(
					join(projects[0]?.root ?? ``, `features/index.json`),
					`utf8`,
				),
			),
		).toEqual([{ path: `features/glyphs-import.fea` }])
		expect(
			await readFile(
				join(projects[0]?.root ?? ``, `features/glyphs-import.fea`),
				`utf8`,
			),
		).toContain(`feature salt {`)
	})

	it(`reports Glyphs syntax locations without creating a partial workspace`, async () => {
		const cwd = await temporaryRoot()
		await writeFile(join(cwd, `broken.glyphs`), `{ familyName = Broken }`)
		const captured = captureIo()
		const exitCode = await runCreateFontCli(
			[`node`, `create-font`, `--from`, `broken.glyphs`, `--no-install`],
			captured.io,
			cwd,
		)

		expect(exitCode).toBe(1)
		expect(captured.stderr.join(``)).toContain(`broken.glyphs:1:`)
		expect(captured.stderr.join(``)).toContain(`glyphs.parse`)
		expect(await readdir(cwd)).toEqual([`broken.glyphs`])
	})

	it(`adds another font without replacing the workspace`, async () => {
		const cwd = await temporaryRoot()
		const first = await createFontWorkspace({
			cwd,
			install: false,
			name: `my-font`,
		})
		const second = await createFontWorkspace({
			cwd: first.workspaceRoot,
			install: false,
			name: `display-font`,
		})

		expect(second.workspaceCreated).toBe(false)
		expect(
			(await discoverFontProjects(first.workspaceRoot)).map(
				(project) => project.name,
			),
		).toEqual([`display-font`, `my-font`])
	})

	it(`installs with the explicitly selected package manager`, async () => {
		const cwd = await temporaryRoot()
		const commands: {
			args: readonly string[]
			command: string
			cwd?: string
		}[] = []
		const result = await createFontWorkspace({
			cwd,
			install: true,
			name: `my-font`,
			packageManager: `pnpm`,
			runtime: {
				async run(command, args, options) {
					commands.push({
						args,
						command,
						...(options?.cwd === undefined ? {} : { cwd: options.cwd }),
					})
					return {
						exitCode: 0,
						stderr: ``,
						stdout: new Uint8Array(),
					}
				},
			},
		})

		expect(commands).toEqual([
			{
				args: [`install`],
				command: `pnpm`,
				cwd: result.workspaceRoot,
			},
		])
		expect(result.installed).toBe(true)
	})
})

describe(`font CLI`, () => {
	it(`renders workspace command help`, async () => {
		const captured = captureIo()
		const exitCode = await runFontCli([`node`, `font`], captured.io)

		expect(exitCode).toBe(0)
		expect(captured.stdout.join(``)).toContain(`font`)
		expect(captured.stdout.join(``)).toContain(`build`)
		expect(captured.stdout.join(``)).toContain(`dev`)
	})

	it(`documents the distinctive development server port`, async () => {
		const captured = captureIo()
		const exitCode = await runFontCli(
			[`node`, `font`, `dev`, `--help`],
			captured.io,
		)

		expect(exitCode).toBe(0)
		expect(captured.stdout.join(``)).toContain(`Defaults to 16384`)
		expect(captured.stdout.join(``)).toContain(`--port=16384`)
	})

	it(`builds a selected font and prints its artifact path`, async () => {
		const captured = captureIo()
		const exitCode = await runFontCli(
			[`node`, `font`, `build`, `workbench-sans`, `--root`, `../..`],
			captured.io,
		)

		expect(exitCode).toBe(0)
		expect(captured.stderr).toEqual([])
		expect(captured.stdout.join(``)).toContain(
			`artifacts/workbench-sans/WorkbenchSans-Text.ttf`,
		)
	})

	it(`checks feature sources as deterministic JSON without writing artifacts`, async () => {
		const cwd = await temporaryRoot()
		const created = await createFontWorkspace({
			cwd,
			install: false,
			name: `check-font`,
		})
		await mkdir(join(created.fontRoot, `features`), { recursive: true })
		await writeFile(
			join(created.fontRoot, `features`, `layout.fea`),
			`feature liga { sub missing by .notdef; } liga;\n`,
		)
		await writeFile(
			join(created.fontRoot, `features`, `index.json`),
			`${JSON.stringify([{ path: `features/layout.fea` }], null, `\t`)}\n`,
		)
		const before = await readFile(
			join(created.fontRoot, `features`, `layout.fea`),
			`utf8`,
		)
		const captured = captureIo()
		const exitCode = await runFontCli(
			[
				`node`,
				`font`,
				`check`,
				`check-font`,
				`--root`,
				created.workspaceRoot,
				`--format=json`,
			],
			captured.io,
		)

		expect(exitCode).toBe(1)
		expect(captured.stderr).toEqual([])
		expect(JSON.parse(captured.stdout.join(``))).toMatchObject([
			{
				code: `fea.unknown_glyph`,
				path: `features/layout.fea`,
				severity: `error`,
			},
		])
		expect(
			await readFile(join(created.fontRoot, `features`, `layout.fea`), `utf8`),
		).toBe(before)
	})
})
