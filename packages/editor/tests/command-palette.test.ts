import { describe, expect, it, vi } from "vitest"

import {
	filterPaletteCommands,
	isCommandPaletteKeyboardEvent,
	nextEnabledCommandId,
	type PaletteCommand,
} from "../src/command-palette.ts"

const commands = [
	{
		id: "add-glyphs",
		displayName: "Add glyphs",
		category: "Glyphs",
		icon: "add",
		keywords: ["new", "create"],
		do: vi.fn(),
	},
	{
		id: "select",
		displayName: "Select tool",
		category: "Tools",
		icon: "select",
		do: vi.fn(),
	},
	{
		id: "pen",
		displayName: "Pen tool",
		category: "Tools",
		icon: "pen",
		disabled: true,
		do: vi.fn(),
	},
] satisfies readonly PaletteCommand[]

function keyboardEvent(
	overrides: Partial<{
		key: string
		metaKey: boolean
		ctrlKey: boolean
		shiftKey: boolean
		altKey: boolean
	}> = {},
) {
	return {
		key: "p",
		metaKey: false,
		ctrlKey: false,
		shiftKey: false,
		altKey: false,
		...overrides,
	}
}

describe("command palette", () => {
	it("recognizes the platform-specific Mod+Shift+P shortcut", () => {
		expect(
			isCommandPaletteKeyboardEvent(
				keyboardEvent({ metaKey: true, shiftKey: true }),
				true,
			),
		).toBe(true)
		expect(
			isCommandPaletteKeyboardEvent(
				keyboardEvent({ ctrlKey: true, shiftKey: true }),
				false,
			),
		).toBe(true)
		expect(
			isCommandPaletteKeyboardEvent(
				keyboardEvent({ ctrlKey: true, shiftKey: true }),
				true,
			),
		).toBe(false)
	})

	it("filters commands with fuzzy typeahead across labels and keywords", () => {
		expect(filterPaletteCommands(commands, "ag").map(({ id }) => id)).toEqual([
			"add-glyphs",
		])
		expect(
			filterPaletteCommands(commands, "create").map(({ id }) => id),
		).toEqual(["add-glyphs"])
		expect(filterPaletteCommands(commands, "tool").map(({ id }) => id)).toEqual(
			["pen", "select"],
		)
	})

	it("cycles through enabled commands and skips unavailable commands", () => {
		expect(nextEnabledCommandId(commands, "select", 1)).toBe("add-glyphs")
		expect(nextEnabledCommandId(commands, "add-glyphs", -1)).toBe("select")
		expect(nextEnabledCommandId([commands[2]!], null, 1)).toBeNull()
	})
})
