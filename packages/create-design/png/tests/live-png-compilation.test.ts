import { describe, expect, it, vi } from "vitest"
import { createInitialDocument } from "@create-design/source"
import { createLivePngCompiler, type PngExportResult } from "../src/index.ts"

describe("live PNG compilation", () => {
	it("suppresses stale results and aborts work on stop", async () => {
		const pending: Array<(value: PngExportResult) => void> = []
		const compile = vi.fn(
			() => new Promise<PngExportResult>((resolve) => pending.push(resolve)),
		)
		const compiler = createLivePngCompiler({
			compile,
			schedule(work) {
				work()
				return () => undefined
			},
		})
		compiler.start()
		const request = { scope: { kind: "all" as const } }
		compiler.request(createInitialDocument(), request)
		compiler.request(createInitialDocument(), request)
		const result = {
			artifacts: [],
			preflight: {
				artboards: [],
				decision: "ready" as const,
				diagnostics: [],
				summary: { errors: 0, warnings: 0, infos: 0 },
				target: "png" as const,
			},
		}
		pending[0]!(result)
		await Promise.resolve()
		expect(compiler.getState().status).toBe("compiling")
		pending[1]!(result)
		await Promise.resolve()
		expect(compiler.getState().status).toBe("ready")
		compiler.stop()
	})
})
