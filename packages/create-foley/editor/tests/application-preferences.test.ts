import { HOTBAR_KEYS, parseHotbarSlots } from "@create-art/editor"
import { describe, expect, it } from "vitest"

import {
	DEFAULT_FOLEY_HOTBAR_SLOTS,
	FOLEY_APPEARANCE_STORAGE_KEY,
	FOLEY_HOTBAR_STORAGE_KEY,
	parseFoleyAppearance,
	resolveFoleyAppearance,
} from "../src/application-preferences.ts"

describe("create-foley application preferences", () => {
	it("provides a complete sound-authoring hotbar", () => {
		expect(DEFAULT_FOLEY_HOTBAR_SLOTS).toHaveLength(HOTBAR_KEYS.length)
		expect(DEFAULT_FOLEY_HOTBAR_SLOTS.slice(0, 6)).toEqual([
			"play",
			"add-impact",
			"add-whoosh",
			"add-noise",
			"add-tone",
			"add-crackle",
		])
		expect(FOLEY_HOTBAR_STORAGE_KEY).toBe("create-foley:action-hotbar:v1")
		expect(
			parseHotbarSlots(JSON.stringify(DEFAULT_FOLEY_HOTBAR_SLOTS)),
		).toEqual(DEFAULT_FOLEY_HOTBAR_SLOTS)
	})

	it("parses and resolves persisted appearance choices", () => {
		expect(FOLEY_APPEARANCE_STORAGE_KEY).toBe("create-foley:appearance:v1")
		expect(parseFoleyAppearance("light")).toBe("light")
		expect(parseFoleyAppearance("unknown")).toBe("system")
		expect(resolveFoleyAppearance("system", true)).toBe("light")
		expect(resolveFoleyAppearance("system", false)).toBe("dark")
		expect(resolveFoleyAppearance("dark", true)).toBe("dark")
	})
})
