import { execFile } from "node:child_process"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import {
	cp,
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { basename, resolve } from "node:path"
import { promisify } from "node:util"

const workspaceRoot = resolve(import.meta.dirname, `../../..`)
const packageDirectories = [`packages/create-font`, `packages/editor`] as const

let fixtureRoot = ``
const execFileAsync = promisify(execFile)

async function run(
	command: readonly string[],
	cwd: string,
): Promise<Readonly<{ stderr: string; stdout: string }>> {
	const [executable, ...args] = command
	if (executable === undefined) throw new Error(`A command is required.`)
	const { stderr, stdout } = await execFileAsync(executable, args, {
		cwd,
		env: { ...process.env, CI: `true` },
		encoding: `utf8`,
	})
	return { stderr, stdout }
}

beforeAll(async () => {
	fixtureRoot = await mkdtemp(resolve(tmpdir(), `create-font-installed-`))
	const tarballRoot = resolve(fixtureRoot, `tarballs`)
	await mkdir(tarballRoot, { recursive: true })

	const packedPackages = new Map<string, string>()
	for (const packageDirectory of packageDirectories) {
		const absolutePackageDirectory = resolve(workspaceRoot, packageDirectory)
		const packageJson = JSON.parse(
			await readFile(resolve(absolutePackageDirectory, `package.json`), `utf8`),
		) as { name: string }
		await run(
			[`pnpm`, `pack`, `--pack-destination`, tarballRoot],
			absolutePackageDirectory,
		)
		const tarball = (await readdir(tarballRoot)).find((entry) =>
			entry.startsWith(
				`${packageJson.name.replace(`@`, ``).replace(`/`, `-`)}-`,
			),
		)
		if (tarball === undefined) {
			throw new Error(`pnpm did not pack ${packageJson.name}.`)
		}
		packedPackages.set(packageJson.name, resolve(tarballRoot, tarball))
	}

	const fixtureNodeModules = resolve(fixtureRoot, `node_modules`)
	for (const [packageName, tarball] of packedPackages) {
		const extractionRoot = resolve(
			fixtureRoot,
			`extract-${packageName.replaceAll(`/`, `-`)}`,
		)
		await mkdir(extractionRoot, { recursive: true })
		await run([`tar`, `-xzf`, tarball, `-C`, extractionRoot], workspaceRoot)
		const target = resolve(fixtureNodeModules, packageName)
		await mkdir(resolve(target, `..`), { recursive: true })
		await cp(resolve(extractionRoot, `package`), target, { recursive: true })
	}

	const createFontPackage = JSON.parse(
		await readFile(
			resolve(fixtureNodeModules, `create-font/package.json`),
			`utf8`,
		),
	) as { dependencies: Record<string, string> }
	for (const dependency of Object.keys(createFontPackage.dependencies)) {
		if (dependency === `@create-font/editor`) continue
		const target = resolve(fixtureNodeModules, dependency)
		await mkdir(resolve(target, `..`), { recursive: true })
		await symlink(
			resolve(workspaceRoot, `packages/create-font/node_modules`, dependency),
			target,
			`junction`,
		)
	}
})

afterAll(async () => {
	if (fixtureRoot !== ``) {
		await rm(fixtureRoot, { force: true, recursive: true })
	}
})

describe(`installed create-font editor boundary`, () => {
	it(`serves and loads the editor artifact from the production dependency`, async () => {
		const runnerPath = resolve(fixtureRoot, `verify-install.ts`)
		await writeFile(
			runnerPath,
			`import { readdir, readFile, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { createFontServerApp } from "create-font"

const createFontPackagePath = fileURLToPath(import.meta.resolve("create-font/package.json"))
const editorPackagePath = fileURLToPath(import.meta.resolve("@create-font/editor/package.json"))
const createFontPackage = JSON.parse(await readFile(createFontPackagePath, "utf8"))
const editorArtifactPath = resolve(dirname(editorPackagePath), "dist/browser/editor.js")
const editorModule = await import(pathToFileURL(editorArtifactPath).href)
const app = createFontServerApp()
const request = (path: string) => app.handle(new Request(new URL(path, "http://installed.test")))
	const html = await (await request("/")) .text()
	const scriptSource = html.match(/<script[^>]+src="([^"]+)"/)?.[1]
	if (scriptSource === undefined) throw new Error("The installed app has no browser script.")
	const publicRoot = resolve(dirname(createFontPackagePath), "dist/public")
	const applicationScripts = (await readdir(publicRoot, { recursive: true })).filter((file) =>
		file.endsWith(".js"),
	)
	const main = (await Promise.all(
		applicationScripts.map(async (file) => (await request("/" + file)).text()),
	)).join("\\n")
	const editorJavaScriptResponse = await request("/editor/editor.js")
	const editorJavaScript = await editorJavaScriptResponse.text()
	const editorStylesResponse = await request("/editor/editor.css")
	const editorStyles = await editorStylesResponse.text()
	await writeFile("result.json", JSON.stringify({
		dependency: createFontPackage.dependencies["@create-font/editor"],
		editorContentType: editorJavaScriptResponse.headers.get("content-type"),
		editorHasImplementation: editorJavaScript.includes("editor-application-root"),
		editorSize: editorJavaScript.length,
		mainHasEditorImplementation: main.includes("editor-application-root"),
		mainLoadsEditorArtifact: main.includes("/editor/editor.js"),
		mountType: typeof editorModule.mountEditor,
		stylesContentType: editorStylesResponse.headers.get("content-type"),
		stylesHaveEditorRoot: editorStyles.includes("editor-application-root"),
	}))
	await app.stop()
	process.exit(0)
`,
		)

		await run([process.execPath, basename(runnerPath)], fixtureRoot)
		const result = JSON.parse(
			await readFile(resolve(fixtureRoot, `result.json`), `utf8`),
		) as {
			dependency?: string
			editorContentType?: string
			editorHasImplementation?: boolean
			editorSize?: number
			mainHasEditorImplementation?: boolean
			mainLoadsEditorArtifact?: boolean
			mountType?: string
			stylesContentType?: string
			stylesHaveEditorRoot?: boolean
		}
		const editorPackage = JSON.parse(
			await readFile(
				resolve(workspaceRoot, `packages/editor/package.json`),
				`utf8`,
			),
		) as { version: string }
		expect(result.dependency).toBe(editorPackage.version)
		expect(result.mainHasEditorImplementation).toBe(false)
		expect(result.mainLoadsEditorArtifact).toBe(true)
		expect(result.editorContentType).toMatch(/^text\/javascript/u)
		expect(result.editorHasImplementation).toBe(true)
		expect(result.editorSize).toBeGreaterThan(100_000)
		expect(result.stylesContentType).toMatch(/^text\/css/u)
		expect(result.stylesHaveEditorRoot).toBe(true)
		expect(result.mountType).toBe(`function`)
	}, 60_000)
})
