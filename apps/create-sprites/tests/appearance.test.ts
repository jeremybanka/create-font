import assert from "node:assert/strict"
import { describe, it } from "vitest"

import {
	normalizeSpriteAppearance,
	readSpriteAppearance,
	spriteAppearanceIsLight,
} from "../src/appearance.ts"

describe("sprite appearance", () => {
	it("normalizes only supported modes", () => {
		assert.equal(normalizeSpriteAppearance("system"), "system")
		assert.equal(normalizeSpriteAppearance("light"), "light")
		assert.equal(normalizeSpriteAppearance("dark"), "dark")
		assert.equal(normalizeSpriteAppearance("sepia"), null)
	})

	it("defaults unavailable or invalid storage to system", () => {
		assert.equal(readSpriteAppearance(undefined), "system")
		assert.equal(readSpriteAppearance({ getItem: () => "unknown" }), "system")
	})

	it("resolves system, light, and dark independently", () => {
		assert.equal(spriteAppearanceIsLight("system", true), true)
		assert.equal(spriteAppearanceIsLight("system", false), false)
		assert.equal(spriteAppearanceIsLight("light", false), true)
		assert.equal(spriteAppearanceIsLight("dark", true), false)
	})
})
