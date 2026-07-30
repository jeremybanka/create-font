import {
	mkdtemp,
	readFile,
	rm,
	writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Writable } from "node:stream"

import { describe, expect, it } from "vitest"

import {
	runSourceFormatCli,
	type SourceFormatCliIo,
} from "../src/cli.ts"
import {
	formatSourceFea,
	formatSourceJson,
	sourceFormatJsonConfiguration,
} from "../src/index.ts"

function captureIo(): Readonly<{
	io: SourceFormatCliIo
	stderr: string[]
	stdout: string[]
}> {
	const stderr: string[] = []
	const stdout: string[] = []
	const stream = (output: string[]) =>
		new Writable({
			write(chunk, _encoding, callback) {
				output.push(String(chunk))
				callback()
			},
		})
	return {
		io: { stderr: stream(stderr), stdout: stream(stdout) },
		stderr,
		stdout,
	}
}

describe("create-source-format CLI", () => {
	it("pins input-layout-independent JSON preferences", () => {
		expect(sourceFormatJsonConfiguration).toMatchObject({
			"array.preferSingleLine": true,
			"object.preferSingleLine": true,
		})
	})

	it("converges compact and hand-multiline JSON to application bytes", async () => {
		const root = await mkdtemp(join(tmpdir(), "create-source-format-"))
		try {
			const compactPath = join(root, "compact.json")
			const multilinePath = join(root, "multiline.json")
			const featurePath = join(root, "features.fea")
			const compact = '{"z":1,"a":{"b":2,"a":1}}'
			const multiline =
				'{\r\n\t"z": 1,\r\n\t"a": {\r\n\t\t"b": 2,\r\n\t\t"a": 1\r\n\t}\r\n}\r\n'
			const feature = "feature liga {\r\n sub f i by f_i;\r\n} liga;\r\n"
			await Promise.all([
				writeFile(compactPath, compact),
				writeFile(multilinePath, multiline),
				writeFile(featurePath, feature),
			])

			const before = captureIo()
			expect(await runSourceFormatCli(["check", "."], before.io, root)).toBe(1)
			expect(before.stderr.join("")).toContain("3 source files are")

			const formatted = captureIo()
			expect(await runSourceFormatCli(["fmt", "."], formatted.io, root)).toBe(0)
			expect(formatted.stdout.join("")).toContain("Formatted compact.json")

			const expectedJson = formatSourceJson({
				z: 1,
				a: { b: 2, a: 1 },
			})
			expect(await readFile(compactPath, "utf8")).toBe(expectedJson)
			expect(await readFile(multilinePath, "utf8")).toBe(expectedJson)
			expect(await readFile(featurePath, "utf8")).toBe(
				formatSourceFea(feature),
			)

			const after = captureIo()
			expect(await runSourceFormatCli(["check", "."], after.io, root)).toBe(0)
			expect(after.stderr).toEqual([])
		} finally {
			await rm(root, { force: true, recursive: true })
		}
	})
})
