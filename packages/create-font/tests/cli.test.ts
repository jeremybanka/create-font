import { afterEach, describe, expect, it } from "bun:test"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { runCreateFontCli } from "../src/create-font-cli.ts"
import { createFontWorkspace } from "../src/create.ts"
import { runFontCli } from "../src/font-cli.ts"
import { createFileSystemSourceService } from "../src/source-service.ts"
import { discoverFontProjects } from "../src/workspace.ts"

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
			[`bun`, `create-font`, `--help`],
			captured.io,
		)

		expect(exitCode).toBe(0)
		expect(captured.stdout.join(``)).toContain(`Create a font workspace`)
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
		const packageJson = JSON.parse(
			await readFile(join(result.workspaceRoot, `package.json`), `utf8`),
		) as { devDependencies: Record<string, string> }
		expect(packageJson.devDependencies[`create-font`]).toBe(`0.0.0`)

		const projects = await discoverFontProjects(result.workspaceRoot)
		expect(projects.map((project) => project.name)).toEqual([`my-font`])
		const source = await createFileSystemSourceService(result.fontRoot)
		expect((await source.readManifest()).units.length).toBe(11)
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
})

describe(`font CLI`, () => {
	it(`renders workspace command help`, async () => {
		const captured = captureIo()
		const exitCode = await runFontCli([`bun`, `font`], captured.io)

		expect(exitCode).toBe(0)
		expect(captured.stdout.join(``)).toContain(`font`)
		expect(captured.stdout.join(``)).toContain(`build`)
		expect(captured.stdout.join(``)).toContain(`dev`)
	})

	it(`runs the preliminary build command for a selected font`, async () => {
		const captured = captureIo()
		const exitCode = await runFontCli(
			[`bun`, `font`, `build`, `workbench-sans`, `--root`, `../..`],
			captured.io,
		)

		expect(exitCode).toBe(1)
		expect(captured.stderr.join(``)).toContain(`build.not_implemented`)
		expect(captured.stderr.join(``)).toContain(`fonts/workbench-sans`)
	})
})
