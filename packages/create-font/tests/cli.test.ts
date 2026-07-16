import { describe, expect, it } from "bun:test"

import { runCli } from "../src/cli.ts"

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

describe(`create-font CLI`, () => {
	it(`renders help from the root route`, async () => {
		const captured = captureIo()
		const exitCode = await runCli([`bun`, `create-font`], captured.io)

		expect(exitCode).toBe(0)
		expect(captured.stdout.join(``)).toContain(`create-font`)
		expect(captured.stdout.join(``)).toContain(`build`)
		expect(captured.stdout.join(``)).toContain(`serve`)
	})

	it(`runs the preliminary build command`, async () => {
		const captured = captureIo()
		const exitCode = await runCli(
			[`bun`, `create-font`, `build`, `--root`, import.meta.dir],
			captured.io,
		)

		expect(exitCode).toBe(1)
		expect(captured.stderr.join(``)).toContain(`build.not_implemented`)
	})
})
