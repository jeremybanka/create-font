import {
	mkdtemp,
	readFile,
	readdir,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
	createInitialDocument,
	type DesignDocument,
} from "@create-design/source"
import { afterEach, describe, expect, test } from "vitest"

import {
	parseCreateDesignCli,
	runCreateDesignCli,
	type CreateDesignCliIo,
} from "../src/cli.ts"
import { initializeDesignSourceWorkspace } from "../src/source-service.ts"

const temporaryRoots: string[] = []

async function temporaryRoot(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "create-design-cli-"))
	temporaryRoots.push(root)
	return root
}

afterEach(async () => {
	await Promise.all(
		temporaryRoots.splice(0).map((root) => rm(root, { recursive: true })),
	)
})

function captureIo(): Readonly<{
	io: CreateDesignCliIo
	stderr: () => string
	stdout: () => string
}> {
	let stderr = ""
	let stdout = ""
	return {
		io: {
			stderr: { write: (value) => (stderr += value) },
			stdout: { write: (value) => (stdout += value) },
		},
		stderr: () => stderr,
		stdout: () => stdout,
	}
}

async function run(arguments_: readonly string[]) {
	const capture = captureIo()
	const exitCode = await runCreateDesignCli(arguments_, capture.io)
	return { ...capture, exitCode }
}

function multipleArtboards(): DesignDocument {
	const document = createInitialDocument()
	return {
		...document,
		artboards: [
			{
				id: "artboard:first",
				name: "First",
				x: 0,
				y: 0,
				width: 100,
				height: 200,
				bleed: { top: 10, right: 20, bottom: 30, left: 40 },
			},
			{
				id: "artboard:second",
				name: "Second",
				x: 200,
				y: 0,
				width: 300,
				height: 150,
			},
		],
		objects: [],
	}
}

describe("create-design CLI", () => {
	test("parses server and PDF export commands without changing server defaults", () => {
		expect(parseCreateDesignCli([])).toMatchObject({
			command: "serve",
			port: 3010,
		})
		expect(
			parseCreateDesignCli([
				"export",
				"./project",
				"--output=./result.pdf",
				"--artboards=artboard:one,artboard:two,artboard:one",
				"--include-bleed",
				"--force",
			]),
		).toMatchObject({
			artboardIds: ["artboard:one", "artboard:two"],
			command: "export",
			force: true,
			includeBleed: true,
		})
		expect(() =>
			parseCreateDesignCli([
				"export",
				"--output",
				"result.pdf",
				"--port",
				"80",
			]),
		).toThrow("--port is only valid for serve")
		expect(() => parseCreateDesignCli(["export"])).toThrow(
			"Export requires --output FILE",
		)
	})

	test("exports one artboard through the shared headless SVG pipeline", async () => {
		const root = await temporaryRoot()
		const outputRoot = await temporaryRoot()
		await initializeDesignSourceWorkspace(root, multipleArtboards())
		const output = join(outputRoot, "second.svg")

		const result = await run([
			"export",
			root,
			"--output",
			output,
			"--artboards",
			"artboard:second",
		])

		expect(result.exitCode).toBe(0)
		expect(result.stdout()).toContain(
			"Exported artboard artboard:second as SVG",
		)
		const svg = await readFile(output, "utf8")
		expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"')
		expect(svg).toContain('viewBox="200 0 300 150"')
	})

	test("exports deterministic exact-size PNG batches through the headless pipeline", async () => {
		const root = await temporaryRoot()
		const outputRoot = await temporaryRoot()
		await initializeDesignSourceWorkspace(root, multipleArtboards())
		const output = join(outputRoot, "design.png")

		const result = await run([
			"export",
			root,
			"--output",
			output,
			"--scale",
			"2",
			"--background",
			"#ffffff",
		])

		expect(result.exitCode).toBe(0)
		expect(result.stdout()).toContain("Exported 2 PNG images")
		expect((await readdir(outputRoot)).sort()).toEqual([
			"design-01-first.png",
			"design-02-second.png",
		])
		const bytes = await readFile(join(outputRoot, "design-01-first.png"))
		expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
		const header = new DataView(bytes.buffer, bytes.byteOffset + 16, 8)
		expect([header.getUint32(0), header.getUint32(4)]).toEqual([200, 400])
	})

	test("exports every artboard as a validated PDF by default", async () => {
		const root = await temporaryRoot()
		const outputRoot = await temporaryRoot()
		await initializeDesignSourceWorkspace(root, multipleArtboards())
		const output = join(outputRoot, "output", "design.pdf")

		const result = await run(["export", root, "--output", output])

		expect(result.exitCode).toBe(0)
		expect(result.stderr()).toBe("")
		expect(result.stdout()).toContain("Exported 2 PDF pages")
		const bytes = await readFile(output)
		expect(bytes.subarray(0, 8).toString()).toBe("%PDF-1.7")
		expect(bytes.subarray(-6).toString()).toBe("%%EOF\n")
	})

	test("selects artboards, includes bleed, and publishes no temporary files", async () => {
		const root = await temporaryRoot()
		const outputRoot = await temporaryRoot()
		await initializeDesignSourceWorkspace(root, multipleArtboards())
		const outputDirectory = join(outputRoot, "exports")
		const output = join(outputDirectory, "first.pdf")

		const result = await run([
			"export",
			root,
			"--output",
			output,
			"--artboards",
			"artboard:first",
			"--include-bleed",
		])

		expect(result.exitCode).toBe(0)
		expect(result.stdout()).toContain("Exported 1 PDF page")
		const pdf = await readFile(output, "latin1")
		expect(pdf).toContain("/MediaBox [0 0 160 240]")
		expect(pdf).toContain("/Count 1")
		expect(await readdir(outputDirectory)).toEqual(["first.pdf"])
	})

	test("refuses to clobber output unless force is explicit", async () => {
		const root = await temporaryRoot()
		const outputRoot = await temporaryRoot()
		await initializeDesignSourceWorkspace(root)
		const output = join(outputRoot, "result.pdf")
		await writeFile(output, "keep me")

		const refused = await run(["export", root, "--output", output])

		expect(refused.exitCode).toBe(1)
		expect(refused.stderr()).toContain("Pass --force to replace it")
		expect(await readFile(output, "utf8")).toBe("keep me")
		expect(
			(await readdir(outputRoot)).filter((path) => path.endsWith(".tmp")),
		).toEqual([])

		const replaced = await run(["export", root, "--output", output, "--force"])
		expect(replaced.exitCode).toBe(0)
		expect((await readFile(output)).subarray(0, 8).toString()).toBe("%PDF-1.7")
	})

	test("reports blocking preflight diagnostics without publishing output", async () => {
		const root = await temporaryRoot()
		const outputRoot = await temporaryRoot()
		await initializeDesignSourceWorkspace(root)
		const output = join(outputRoot, "missing.pdf")

		const result = await run([
			"export",
			root,
			"--output",
			output,
			"--artboards",
			"artboard:missing",
		])

		expect(result.exitCode).toBe(1)
		expect(result.stderr()).toContain("error pdf.scope.unknown-artboard")
		expect(result.stderr()).toContain("[artboard:missing]")
		await expect(readFile(output)).rejects.toMatchObject({ code: "ENOENT" })
	})

	test("reports invalid source and command input as stable CLI errors", async () => {
		const root = await temporaryRoot()
		const outputRoot = await temporaryRoot()
		await initializeDesignSourceWorkspace(root)
		await writeFile(join(root, "document.json"), "not json\n")

		const invalidSource = await run([
			"export",
			root,
			"--output",
			join(outputRoot, "result.pdf"),
		])
		expect(invalidSource.exitCode).toBe(1)
		expect(invalidSource.stderr()).toMatch(/^error .+ \[document\.json/u)

		const invalidOutput = await run([
			"export",
			root,
			"--output",
			join(outputRoot, "result.txt"),
		])
		expect(invalidOutput.exitCode).toBe(1)
		expect(invalidOutput.stderr()).toContain("must end in .pdf")
	})

	test("does not allow generated output to invalidate the source directory", async () => {
		const root = await temporaryRoot()
		await initializeDesignSourceWorkspace(root)

		const result = await run([
			"export",
			root,
			"--output",
			join(root, "result.pdf"),
		])

		expect(result.exitCode).toBe(1)
		expect(result.stderr()).toContain("must be outside the source project")
		await expect(readFile(join(root, "result.pdf"))).rejects.toMatchObject({
			code: "ENOENT",
		})
	})

	test("rejects an external output path that resolves into the source", async () => {
		const root = await temporaryRoot()
		const outputRoot = await temporaryRoot()
		await initializeDesignSourceWorkspace(root)
		const sourceAlias = join(outputRoot, "source-alias")
		await symlink(root, sourceAlias, "dir")

		const result = await run([
			"export",
			root,
			"--output",
			join(sourceAlias, "result.pdf"),
		])

		expect(result.exitCode).toBe(1)
		expect(result.stderr()).toContain("must be outside the source project")
		await expect(readFile(join(root, "result.pdf"))).rejects.toMatchObject({
			code: "ENOENT",
		})
	})
})
