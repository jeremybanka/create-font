#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"

import { renderFoleyProject, encodeWav } from "@create-foley/audio"

import { optionValue, positional } from "./cli-options.ts"
import { isMainModule } from "./runtime.ts"
import { startCreateFoleyServer } from "./server.ts"
import { readFoleyProject } from "./source-store.ts"
import { selectFoleyProject } from "./workspace.ts"

const HELP = `foley <command> [project] [options]

Commands:
  dev       Open the interactive sound-effect designer
  check     Validate project source
  render    Render a stereo WAV mixdown

Options:
  --root <path>       Workspace or project root (default: .)
  --output <path>     WAV output path for render
  --port <number>     Server port for dev (default: 3012)
  --hostname <name>   Bind address for dev (default: 127.0.0.1)
  --help              Show this help`

export async function runFoleyCli(args = process.argv.slice(2)): Promise<number> {
	try {
		const words = positional(args)
		if (args.includes("--help") || args.includes("-h") || words.length === 0) { process.stdout.write(`${HELP}\n`); return 0 }
		const command = words[0]
		if (command !== "dev" && command !== "check" && command !== "render") throw new Error(`Unknown command ${command}.`)
		const selected = await selectFoleyProject(optionValue(args, "--root") ?? ".", words[1])
		const project = await readFoleyProject(selected.projectRoot)
		if (command === "check") {
			process.stdout.write(`✓ ${project.title}: ${project.layers.length} layers, ${project.duration}s, ${project.sampleRate} Hz\n`)
			return 0
		}
		if (command === "render") {
			const output = resolve(optionValue(args, "--output") ?? resolve(selected.workspaceRoot, "artifacts", selected.name, `${selected.name}.wav`))
			const audio = renderFoleyProject(project)
			await mkdir(dirname(output), { recursive: true })
			await writeFile(output, encodeWav(audio), { flag: "w" })
			process.stdout.write(`Rendered ${output} (${audio.duration}s, peak ${(20 * Math.log10(audio.peak)).toFixed(1)} dBFS).\n`)
			return 0
		}
		const portText = optionValue(args, "--port")
		const port = portText === undefined ? 3012 : Number(portText)
		if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error("--port must be an integer from 1 through 65535.")
		const assets = resolve(import.meta.dirname, "../dist")
		const hostname = optionValue(args, "--hostname")
		const { app, url } = await startCreateFoleyServer({
			assets,
			root: selected.projectRoot,
			port,
			...(hostname === undefined ? {} : { hostname }),
		})
		process.stdout.write(`create-foley is serving ${selected.projectRoot} at ${url.href}\n`)
		await new Promise<void>((resolveStop) => {
			const keepAlive = setInterval(() => {}, 2_147_483_647)
			const stop = (): void => {
				clearInterval(keepAlive)
				process.off("SIGINT", stop)
				process.off("SIGTERM", stop)
				resolveStop()
			}
			process.once("SIGINT", stop)
			process.once("SIGTERM", stop)
		})
		await app.stop()
		return 0
	} catch (error) {
		process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
		return 1
	}
}

if (isMainModule(import.meta.url)) process.exitCode = await runFoleyCli()
