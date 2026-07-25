import { spawn } from "node:child_process"
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { builtinModules } from "node:module"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { rolldown } from "rolldown"

import { createFontFeaVscodeManifest } from "./fea-vscode-manifest.ts"

const localRequire = createRequire(import.meta.url)

export interface FeaVsixResult {
	readonly buildRoot: string
	readonly vsixPath: string
}

export interface FeaVsixOptions {
	readonly outdir: string
	readonly packageRoot?: string
}

function packageRootFromModule(): string {
	const directory = dirname(fileURLToPath(import.meta.url))
	return directory.endsWith(`${join(`src`)}`)
		? resolve(directory, `..`)
		: resolve(directory, `..`)
}

async function bundle(
	input: string,
	file: string,
	format: `cjs` | `esm`,
	external: (id: string) => boolean,
): Promise<void> {
	const build = await rolldown({ external, input, platform: `node` })
	try {
		await build.write({ file, format, sourcemap: true })
	} finally {
		await build.close()
	}
}

async function copyWasmRuntime(destination: string): Promise<void> {
	const packageJson = localRequire.resolve(
		`@create-font/fea-rs-wasm/package.json`,
	)
	const root = dirname(packageJson)
	await mkdir(destination, { recursive: true })
	await cp(packageJson, join(destination, `package.json`))
	await cp(join(root, `dist`, `node`), join(destination, `dist`, `node`), {
		recursive: true,
	})
}

function resolveVsce(): string {
	const packageJson = localRequire.resolve(`@vscode/vsce/package.json`)
	const manifest = localRequire(packageJson) as {
		readonly bin?: Readonly<Record<string, string>>
	}
	return resolve(dirname(packageJson), manifest.bin?.vsce ?? `vsce`)
}

async function run(command: string, args: readonly string[], cwd: string) {
	const child = spawn(command, args, { cwd, stdio: `inherit` })
	const exitCode = await new Promise<number>((resolveExit, reject) => {
		child.on(`error`, reject)
		child.on(`close`, (code) => resolveExit(code ?? 1))
	})
	if (exitCode !== 0)
		throw new Error(`${command} exited with code ${exitCode}.`)
}

export async function buildFeaVsix(
	options: FeaVsixOptions,
): Promise<FeaVsixResult> {
	const packageRoot = options.packageRoot ?? packageRootFromModule()
	const outdir = resolve(options.outdir)
	const buildRoot = join(outdir, `.create-font-fea-vsix`)
	const dist = join(buildRoot, `dist`)
	const vsixPath = join(outdir, `CreateFontFeatures.vsix`)
	const packageManifest = JSON.parse(
		await readFile(join(packageRoot, `package.json`), `utf8`),
	) as { readonly version: string }
	const builtins = new Set([
		...builtinModules,
		...builtinModules.map((module) => `node:${module}`),
	])
	await rm(buildRoot, { force: true, recursive: true })
	await mkdir(dist, { recursive: true })
	await bundle(
		join(packageRoot, `src`, `fea-vscode-extension.ts`),
		join(dist, `extension.cjs`),
		`cjs`,
		(id) => id === `vscode` || builtins.has(id),
	)
	await bundle(
		join(packageRoot, `src`, `fea-lsp.ts`),
		join(dist, `server.mjs`),
		`esm`,
		(id) => id === `@create-font/fea-rs-wasm/node` || builtins.has(id),
	)
	await copyWasmRuntime(
		join(dist, `node_modules`, `@create-font`, `fea-rs-wasm`),
	)
	await mkdir(join(buildRoot, `syntaxes`), { recursive: true })
	await writeFile(
		join(buildRoot, `package.json`),
		`${JSON.stringify(createFontFeaVscodeManifest(packageManifest.version), null, `\t`)}\n`,
	)
	await writeFile(
		join(buildRoot, `language-configuration.json`),
		`${JSON.stringify(
			{
				brackets: [
					[`{`, `}`],
					[`[`, `]`],
					[`(`, `)`],
				],
				comments: { lineComment: `#` },
			},
			null,
			`\t`,
		)}\n`,
	)
	await writeFile(
		join(buildRoot, `syntaxes`, `fea.tmLanguage.json`),
		`${JSON.stringify(
			{
				name: `Adobe Feature File`,
				patterns: [
					{ match: `#.*$`, name: `comment.line.number-sign.fea` },
					{
						match: `\\b(feature|lookup|sub|by|from|pos|script|language|languagesystem|include|table)\\b`,
						name: `keyword.control.fea`,
					},
					{ match: `@[A-Za-z0-9_.]+`, name: `variable.other.fea` },
					{ match: `\\b[A-Za-z0-9_.]+\\b`, name: `entity.name.fea` },
				],
				scopeName: `source.fea`,
			},
			null,
			`\t`,
		)}\n`,
	)
	await writeFile(
		join(buildRoot, `README.md`),
		`# Create Font Features\n\nProject-aware Adobe Feature File diagnostics, completion, symbols, and hover for create-font workspaces.\n`,
	)
	await mkdir(outdir, { recursive: true })
	await run(
		process.execPath,
		[
			resolveVsce(),
			`package`,
			`--no-dependencies`,
			`--skip-license`,
			`--out`,
			vsixPath,
		],
		buildRoot,
	)
	return { buildRoot, vsixPath }
}

export async function installFeaVsix(
	vsixPath: string,
	editorCommand: string,
	cwd: string,
): Promise<void> {
	await run(editorCommand, [`--install-extension`, vsixPath, `--force`], cwd)
}
