import assert from "node:assert/strict"
import { mkdtemp, readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, it } from "vitest"

import { createSpriteSource, readSpriteSource, writeSpriteSource } from "../src/source.ts"

describe("sprite source", () => {
	it("creates and round-trips a split source project", async () => {
		const root = await mkdtemp(join(tmpdir(), "create-sprites-source-"))
		const created = await createSpriteSource(root, { title: "Tiny hero", width: 8, height: 6 })
		const loaded = await readSpriteSource(root)
		assert.deepEqual(loaded, created)
		assert.match(await readFile(join(root, "create-sprites.json"), "utf8"), /create-sprites\.source/)
		assert.match(await readFile(join(root, "cels", "frame-1", "art.json"), "utf8"), /"rows"/)
	})

	it("publishes renamed metadata and cel indexes", async () => {
		const root = await mkdtemp(join(tmpdir(), "create-sprites-write-"))
		const created = await createSpriteSource(root)
		await writeSpriteSource(root, { ...created, title: "Renamed sprite" })
		assert.equal((await readSpriteSource(root)).title, "Renamed sprite")
	})
})
