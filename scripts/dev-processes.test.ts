import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { once } from "node:events"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { describe, it } from "node:test"
import { tmpdir } from "node:os"
import { resolve } from "node:path"

const fixture = resolve(import.meta.dirname, `dev-process-fixture.ts`)

async function waitForPid(path: string): Promise<number> {
	const deadline = Date.now() + 5_000
	while (Date.now() < deadline) {
		const value = await readFile(path, `utf8`).catch(() => undefined)
		if (value !== undefined) return Number(value)
		await new Promise((resolveWait) => setTimeout(resolveWait, 25))
	}
	throw new Error(`Timed out waiting for ${path}.`)
}

describe(`development process supervision`, () => {
	it(
		`closes a detached descendant after one interrupt`,
		{ skip: process.platform === `win32`, timeout: 10_000 },
		async () => {
			const temporaryRoot = await mkdtemp(resolve(tmpdir(), `dev-processes-`))
			const pidFile = resolve(temporaryRoot, `child.pid`)
			try {
				const supervisor = spawn(process.execPath, [fixture, pidFile], {
					stdio: `ignore`,
				})
				const nestedPid = await waitForPid(pidFile)
				assert.ok(Number.isInteger(nestedPid) && nestedPid > 0)

				supervisor.kill(`SIGINT`)
				const [exitCode, signal] = (await once(supervisor, `exit`)) as [
					number | null,
					NodeJS.Signals | null,
				]
				assert.equal(signal, null)
				assert.equal(exitCode, 130)
				assert.throws(() => process.kill(nestedPid, 0), { code: `ESRCH` })
			} finally {
				await rm(temporaryRoot, { force: true, recursive: true })
			}
		},
	)
})
