import { spawn } from "node:child_process"
import { describe, expect, it } from "vitest"
import { resolve } from "node:path"

function message(value: unknown): string {
	const json = JSON.stringify(value)
	return `Content-Length: ${Buffer.byteLength(json)}\r\n\r\n${json}`
}

describe(`standalone feature language server`, () => {
	it(`speaks initialize and shutdown over clean stdio`, async () => {
		const packageRoot = resolve(import.meta.dirname, `..`)
		const child = spawn(
			process.execPath,
			[`--conditions=development`, `src/fea-lsp.ts`, `--stdio`],
			{
				cwd: packageRoot,
				env: { ...process.env, CREATE_FONT_FEA_LOG_LEVEL: `off` },
				stdio: [`pipe`, `pipe`, `pipe`],
			},
		)
		let buffer = Buffer.alloc(0)
		let stderr = ``
		const responses = new Map<number, unknown>()
		child.stderr.setEncoding(`utf8`)
		child.stderr.on(`data`, (chunk: string) => {
			stderr += chunk
		})
		const completed = new Promise<void>((resolveCompleted, reject) => {
			const timeout = setTimeout(() => {
				child.kill()
				reject(new Error(`Language server smoke test timed out.`))
			}, 5_000)
			child.on(`error`, reject)
			child.on(`close`, (code) => {
				clearTimeout(timeout)
				if (code === 0) resolveCompleted()
				else
					reject(
						new Error(
							`Language server exited ${code}: ${stderr}\n${JSON.stringify([...responses])}`,
						),
					)
			})
			child.stdout.on(`data`, (chunk: Buffer) => {
				buffer = Buffer.concat([buffer, chunk])
				for (;;) {
					const headerEnd = buffer.indexOf(`\r\n\r\n`)
					if (headerEnd < 0) break
					const header = buffer.subarray(0, headerEnd).toString(`ascii`)
					const length = Number(/Content-Length: (\d+)/iu.exec(header)?.[1])
					const bodyStart = headerEnd + 4
					if (!Number.isFinite(length) || buffer.length < bodyStart + length)
						break
					const response = JSON.parse(
						buffer.subarray(bodyStart, bodyStart + length).toString(`utf8`),
					) as { readonly id?: number }
					buffer = buffer.subarray(bodyStart + length)
					if (response.id !== undefined) responses.set(response.id, response)
					if (response.id === 1) {
						child.stdin.write(
							message({
								jsonrpc: `2.0`,
								method: `initialized`,
								params: {},
							}),
						)
						child.stdin.write(
							message({
								id: 2,
								jsonrpc: `2.0`,
								method: `shutdown`,
								params: null,
							}),
						)
					}
					if (response.id === 2) {
						child.stdin.write(
							message({ jsonrpc: `2.0`, method: `exit`, params: null }),
						)
					}
				}
			})
		})
		child.stdin.write(
			message({
				id: 1,
				jsonrpc: `2.0`,
				method: `initialize`,
				params: {
					capabilities: {},
					processId: null,
					rootUri: null,
				},
			}),
		)

		await completed
		expect(stderr).toBe(``)
		expect(responses.get(1)).toMatchObject({
			result: {
				capabilities: {
					completionProvider: {},
					documentSymbolProvider: true,
					hoverProvider: true,
					textDocumentSync: 2,
				},
				serverInfo: { name: `create-font-fea-lsp` },
			},
		})
		expect(responses.get(2)).toMatchObject({ result: null })
	})
})
