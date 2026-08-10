import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createInitialFoleyProject } from "@create-foley/source"
import { describe, expect, it } from "vitest"

import { readFoleyProject, writeFoleyProject } from "../src/source-store.ts"

describe("foley source store", () => {
	it("persists a source project atomically", async () => {
		const root = await mkdtemp(join(tmpdir(), "create-foley-store-"))
		const project = createInitialFoleyProject("Test hit")
		await writeFoleyProject(root, project)
		expect(await readFoleyProject(root)).toEqual(project)
	})
})
