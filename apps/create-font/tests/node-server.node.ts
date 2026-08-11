import assert from "node:assert/strict"
import { spawn, type ChildProcess } from "node:child_process"
import { once } from "node:events"
import { resolve } from "node:path"
import { test } from "node:test"

import { availablePort, verifyRuntimeServer } from "./runtime-server-smoke.ts"

test(`serves HTTP, assets, and source events with the Node adapter`, () =>
	verifyRuntimeServer())

async function waitForServer(
	url: URL,
	child: ChildProcess,
	readOutput: () => string,
): Promise<Response> {
	const deadline = performance.now() + 5_000
	for (;;) {
		if (child.exitCode !== null) {
			throw new Error(
				`font dev exited with code ${child.exitCode}.\n${readOutput()}`,
			)
		}
		try {
			return await fetch(url)
		} catch (error) {
			if (performance.now() >= deadline) {
				throw new Error(`Timed out waiting for font dev.\n${readOutput()}`, {
					cause: error,
				})
			}
			await new Promise((resolve) => setTimeout(resolve, 10))
		}
	}
}

test(`font dev keeps its CLI process alive and serves the browser application`, async () => {
	const packageRoot = resolve(import.meta.dirname, `..`)
	const workspaceRoot = resolve(packageRoot, `../..`)
	const port = await availablePort()
	const child = spawn(
		process.execPath,
		[
			`--conditions=development`,
			resolve(packageRoot, `src/font-cli.ts`),
			`dev`,
			`workbench-sans`,
			`--root=${workspaceRoot}`,
			`--port=${port}`,
		],
		{ cwd: packageRoot, stdio: [`ignore`, `pipe`, `pipe`] },
	)
	let stderr = ``
	let stdout = ``
	child.stderr?.setEncoding(`utf8`).on(`data`, (chunk: string) => {
		stderr += chunk
	})
	child.stdout?.setEncoding(`utf8`).on(`data`, (chunk: string) => {
		stdout += chunk
	})
	try {
		const response = await waitForServer(
			new URL(`http://127.0.0.1:${port}/`),
			child,
			() => `${stdout}${stderr}`,
		)
		assert.equal(response.status, 200)
		assert.match(response.headers.get(`content-type`) ?? ``, /text\/html/u)
		assert.match(await response.text(), /create-font-root/u)
		assert.equal(child.exitCode, null)
		assert.match(stdout, /font is serving fonts\/workbench-sans/u)
	} finally {
		if (child.exitCode === null) {
			child.kill()
			await once(child, `exit`)
		}
	}
})
