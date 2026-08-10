import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createInitialFoleyProject } from "@create-foley/source"
import { describe, expect, it } from "vitest"

import { createFoleyServerApp } from "../src/server.ts"
import { readFoleyProject, writeFoleyProject } from "../src/source-store.ts"

describe("create-foley server", () => {
	it("loads and saves validated project source", async () => {
		const root = await mkdtemp(join(tmpdir(), "create-foley-server-"))
		await writeFoleyProject(root, createInitialFoleyProject("Server test"))
		const app = await createFoleyServerApp({ root })
		const loaded = await app.handle(new Request("http://localhost/api/project"))
		expect(loaded.status).toBe(200)
		const project = await loaded.json() as ReturnType<typeof createInitialFoleyProject>
		expect(project.title).toBe("Server test")

		const saved = await app.handle(new Request("http://localhost/api/project", {
			method: "PUT",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ ...project, title: "Saved test" }),
		}))
		expect(saved.status).toBe(200)
		expect((await readFoleyProject(root)).title).toBe("Saved test")
	})
})
