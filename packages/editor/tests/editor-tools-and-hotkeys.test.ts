import { describe, expect, it } from "vitest"

import {
	ariaKeyShortcut,
	formatHotkey,
	isMacLike,
	TOOLS,
	toolForKeyboardEvent,
} from "../src/editor-tools-and-hotkeys.ts"

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
		key: "z",
		metaKey: false,
		ctrlKey: false,
		shiftKey: false,
		altKey: false,
		...overrides,
	}
}

describe("editor tools and hotkeys", () => {
	it("matches exact platform-specific shortcuts", () => {
		expect(
			toolForKeyboardEvent(keyboardEvent({ metaKey: true }), true)?.id,
		).toBe("undo")
		expect(
			toolForKeyboardEvent(
				keyboardEvent({ metaKey: true, shiftKey: true }),
				true,
			)?.id,
		).toBe("redo")
		expect(
			toolForKeyboardEvent(keyboardEvent({ ctrlKey: true }), false)?.id,
		).toBe("undo")
	})

	it("does not match missing, extra, or foreign-platform modifiers", () => {
		expect(toolForKeyboardEvent(keyboardEvent(), true)).toBeUndefined()
		expect(
			toolForKeyboardEvent(
				keyboardEvent({ metaKey: true, altKey: true }),
				true,
			),
		).toBeUndefined()
		expect(
			toolForKeyboardEvent(keyboardEvent({ ctrlKey: true }), true),
		).toBeUndefined()
		expect(
			toolForKeyboardEvent(keyboardEvent({ metaKey: true }), false),
		).toBeUndefined()
	})

	it("normalizes letter case and presents platform-native labels", () => {
		expect(
			toolForKeyboardEvent(keyboardEvent({ key: "Z", metaKey: true }), true)
				?.id,
		).toBe("undo")
		expect(formatHotkey(TOOLS.REDO.hotkey, true)).toEqual(["⌘", "Shift", "Z"])
		expect(formatHotkey(TOOLS.REDO.hotkey, false)).toEqual([
			"ctrl",
			"Shift",
			"Z",
		])
		expect(ariaKeyShortcut(TOOLS.REDO.hotkey, true)).toBe("Meta+Shift+Z")
	})

	it("prefers user-agent client hints and falls back to navigator.platform", () => {
		expect(
			isMacLike({
				platform: "Linux x86_64",
				userAgentData: { platform: "macOS" },
			}),
		).toBe(true)
		expect(isMacLike({ platform: "iPhone" })).toBe(true)
		expect(isMacLike({ platform: "Win32" })).toBe(false)
	})
})
