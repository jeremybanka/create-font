import { mkdtemp, readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

import { createFoleyWorkspace } from "../src/create.ts"
import { readFoleyProject } from "../src/source-store.ts"

describe("create-foley scaffolder", () => {
	it("creates a runnable source workspace without installing", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "create-foley-create-"))
		const result = await createFoleyWorkspace({ cwd, install: false, name: "laser-zap" })
		expect(result.workspaceCreated).toBe(true)
		expect((await readFoleyProject(result.projectRoot)).title).toBe("Laser Zap")
		const packageJson = JSON.parse(await readFile(join(result.workspaceRoot, "package.json"), "utf8")) as { scripts: Record<string, string> }
		expect(packageJson.scripts.dev).toBe("foley dev")
	})
})
