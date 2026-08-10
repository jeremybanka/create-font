import { mkdtemp, readFile, rm, truncate, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import { MAX_ILLUSTRATOR_FILE_BYTES } from "@create-design/ai"

import { runCreateDesignCli } from "../src/create-design-cli.ts"
import { createDesignWorkspace } from "../src/create.ts"
import { discoverDesignProjects } from "../src/workspace.ts"

const temporaryRoots: string[] = []

async function temporaryRoot(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "create-design-create-cli-"))
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

describe("create-design CLI", () => {
	it("renders initializer help", async () => {
		let stdout = ""
		const exitCode = await runCreateDesignCli(["create-design", "--help"], {
			stderr: { write: () => undefined },
			stdout: { write: (value) => (stdout += value) },
		})
		expect(exitCode).toBe(0)
		expect(stdout).toContain("Create a design workspace")
		expect(stdout).toContain("--package-manager")
	})

	it("rejects an oversized AI file before reading it", async () => {
		const root = await temporaryRoot()
		const input = join(root, "oversized.ai")
		await writeFile(input, "")
		await truncate(input, MAX_ILLUSTRATOR_FILE_BYTES + 1)
		let stderr = ""
		const exitCode = await runCreateDesignCli(
			["create-design", "--from", input, "--no-install"],
			{
				stderr: { write: (value) => (stderr += value) },
				stdout: { write: () => undefined },
			},
		)
		expect(exitCode).toBe(1)
		expect(stderr).toContain(String(MAX_ILLUSTRATOR_FILE_BYTES))
		expect(stderr).toContain("import limit")
	})

	it("creates a workspace with one source project and local tool dependency", async () => {
		const cwd = await temporaryRoot()
		const result = await createDesignWorkspace({
			cwd,
			install: false,
			name: "launch-poster",
		})

		expect(result.workspaceCreated).toBe(true)
		expect(result.designName).toBe("launch-poster")
		const createDesignPackage = JSON.parse(
			await readFile(join(import.meta.dirname, "../package.json"), "utf8"),
		) as { version: string }
		const packageJson = JSON.parse(
			await readFile(join(result.workspaceRoot, "package.json"), "utf8"),
		) as {
			devDependencies: Record<string, string>
			scripts: Record<string, string>
		}
		expect(packageJson.devDependencies["create-design"]).toBe(
			createDesignPackage.version,
		)
		expect(packageJson.scripts).toEqual({
			build: "design build",
			dev: "design dev",
		})
		expect(await discoverDesignProjects(result.workspaceRoot)).toMatchObject([
			{ name: "launch-poster", path: "designs/launch-poster" },
		])
		const metadata = JSON.parse(
			await readFile(join(result.designRoot, "document.json"), "utf8"),
		) as { title: string }
		expect(metadata.title).toBe("Launch Poster")
	})

	it("adds another design to an existing workspace without reinstalling", async () => {
		const cwd = await temporaryRoot()
		const first = await createDesignWorkspace({
			cwd,
			install: false,
			name: "first-design",
		})
		const second = await createDesignWorkspace({
			cwd: first.workspaceRoot,
			name: "second-design",
		})

		expect(second.workspaceCreated).toBe(false)
		expect(second.installed).toBe(false)
		expect(
			(await discoverDesignProjects(first.workspaceRoot)).map(
				(project) => project.name,
			),
		).toEqual(["first-design", "second-design"])
	})

	it("installs a new workspace with the explicitly selected package manager", async () => {
		const cwd = await temporaryRoot()
		const commands: {
			args: readonly string[]
			command: string
			cwd?: string
		}[] = []
		const result = await createDesignWorkspace({
			cwd,
			name: "launch-poster",
			packageManager: "pnpm",
			runtime: {
				async run(command, args, options) {
					commands.push({
						args,
						command,
						...(options?.cwd === undefined ? {} : { cwd: options.cwd }),
					})
					return {
						exitCode: 0,
						stderr: "",
						stdout: new Uint8Array(),
					}
				},
			},
		})

		expect(result.installed).toBe(true)
		expect(commands).toEqual([
			{
				args: ["install"],
				command: "pnpm",
				cwd: result.workspaceRoot,
			},
		])
	})

	it("validates the selected package manager", async () => {
		let stderr = ""
		const exitCode = await runCreateDesignCli(
			["create-design", "project", "--package-manager=unknown"],
			{
				stderr: { write: (value) => (stderr += value) },
				stdout: { write: () => undefined },
			},
		)
		expect(exitCode).toBe(1)
		expect(stderr).toContain("Package manager must be npm, pnpm, yarn, or bun")
	})

	it("imports PDF-compatible Illustrator artwork into staged native source", async () => {
		const cwd = await temporaryRoot()
		const input = join(cwd, "Brand Logo.ai")
		await writeFile(
			input,
			"%PDF-1.4\n% Adobe Illustrator\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/ArtBox[0 0 100 200]/Contents 4 0 R/Resources<<>>>>endobj\n4 0 obj<</Length 26>>stream\n1 0 0 rg 10 20 30 40 re f\nendstream\nendobj\n5 0 obj<</Producer(Adobe Illustrator)/Title(Poster)>>endobj\n%%EOF\n",
		)
		const previous = process.cwd()
		process.chdir(cwd)
		try {
			let stdout = ""
			let stderr = ""
			const exitCode = await runCreateDesignCli(
				["create-design", "--from", input, "--no-install"],
				{
					stderr: { write: (value) => (stderr += value) },
					stdout: { write: (value) => (stdout += value) },
				},
			)
			expect(exitCode).toBe(0)
			expect(stderr).toBe("")
			expect(stdout).toContain("Imported 1 artboards and 1 painted objects")
			const root = join(cwd, "Brand-Logo", "designs", "Brand-Logo")
			const metadata = JSON.parse(
				await readFile(join(root, "document.json"), "utf8"),
			) as { title: string }
			expect(metadata.title).toBe("Poster")
			const artboardIndex = JSON.parse(
				await readFile(join(root, "artboards", "index.json"), "utf8"),
			) as { entries: readonly { path: string }[] }
			const artboard = JSON.parse(
				await readFile(join(root, artboardIndex.entries[0]!.path), "utf8"),
			) as { width: number; height: number }
			expect(artboard).toMatchObject({ width: 100, height: 200 })
		} finally {
			process.chdir(previous)
		}
	})

	it("rejects legacy Illustrator input before creating a project", async () => {
		const cwd = await temporaryRoot()
		const input = join(cwd, "legacy.ai")
		await writeFile(input, "%!PS-Adobe-3.0\n%%Creator: Adobe Illustrator\n")
		const previous = process.cwd()
		process.chdir(cwd)
		try {
			let stderr = ""
			const exitCode = await runCreateDesignCli(
				["create-design", "should-not-exist", "--from", input, "--no-install"],
				{
					stderr: { write: (value) => (stderr += value) },
					stdout: { write: () => undefined },
				},
			)
			expect(exitCode).toBe(1)
			expect(stderr).toContain("ai.import.not-pdf-compatible")
			await expect(
				readFile(join(cwd, "should-not-exist", "package.json")),
			).rejects.toMatchObject({ code: "ENOENT" })
		} finally {
			process.chdir(previous)
		}
	})
})
