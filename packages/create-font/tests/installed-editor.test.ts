import { afterAll, beforeAll, describe, expect, it } from "bun:test"
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

const workspaceRoot = resolve(import.meta.dir, `../../..`)
const packageDirectories = [`packages/create-font`, `packages/editor`] as const

let fixtureRoot = ``

async function run(
	command: readonly string[],
	cwd: string,
): Promise<Readonly<{ stderr: string; stdout: string }>> {
	const process = Bun.spawn(command, {
		cwd,
		env: { ...Bun.env, CI: `true` },
		stderr: `pipe`,
		stdout: `pipe`,
	})
	const [exitCode, stderr, stdout] = await Promise.all([
		process.exited,
		new Response(process.stderr).text(),
		new Response(process.stdout).text(),
	])
	if (exitCode !== 0) {
		throw new Error(
			`${command.join(` `)} failed with exit code ${exitCode}:\n${stderr}\n${stdout}`,
		)
	}
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
			`import { readdir, readFile } from "node:fs/promises"
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
	const applicationScripts = (await readdir(publicRoot)).filter(
		(file) => file.endsWith(".js") && file !== "source-session.worker.js",
	)
	const main = (await Promise.all(
		applicationScripts.map(async (file) => (await request("/" + file)).text()),
	)).join("\\n")
	const editorJavaScriptResponse = await request("/editor/editor.js")
	const editorJavaScript = await editorJavaScriptResponse.text()
	const editorStylesResponse = await request("/editor/editor.css")
	const editorStyles = await editorStylesResponse.text()
	await Bun.write(Bun.stdout, "RESULT " + JSON.stringify({
		dependency: createFontPackage.dependencies["@create-font/editor"],
		editorContentType: editorJavaScriptResponse.headers.get("content-type"),
		editorHasImplementation: editorJavaScript.includes("editor-application-root"),
		editorSize: editorJavaScript.length,
		mainHasEditorImplementation: main.includes("editor-application-root"),
		mainLoadsEditorArtifact: main.includes("/editor/editor.js"),
		mountType: typeof editorModule.mountEditor,
		stylesContentType: editorStylesResponse.headers.get("content-type"),
		stylesHaveEditorRoot: editorStyles.includes("editor-application-root"),
	}) + "\\n")
	process.exit(0)
`,
		)

		const { stdout } = await run(
			[process.execPath, basename(runnerPath)],
			fixtureRoot,
		)
		const resultLine = stdout
			.split(`\n`)
			.find((line) => line.startsWith(`RESULT `))
		expect(resultLine).toBeDefined()
		const result = JSON.parse(resultLine?.slice(`RESULT `.length) ?? `{}`) as {
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
		expect(result.editorContentType).toStartWith(`text/javascript`)
		expect(result.editorHasImplementation).toBe(true)
		expect(result.editorSize).toBeGreaterThan(100_000)
		expect(result.stylesContentType).toStartWith(`text/css`)
		expect(result.stylesHaveEditorRoot).toBe(true)
		expect(result.mountType).toBe(`function`)
	}, 60_000)
})
