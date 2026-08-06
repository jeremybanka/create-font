import { describe, expect, it } from "vitest"

import {
	designStackShortcutCommand,
	type DesignStackShortcutEvent,
} from "../src/design-stack-shortcut.ts"

function keyboard(
	overrides: Partial<DesignStackShortcutEvent> = {},
): DesignStackShortcutEvent {
	return {
		altKey: false,
		code: "",
		ctrlKey: false,
		key: "]",
		metaKey: false,
		shiftKey: false,
		...overrides,
	}
}

describe("design stacking shortcuts", () => {
	it("maps all four conventional Control shortcuts off macOS", () => {
		expect(
			designStackShortcutCommand(keyboard({ ctrlKey: true, key: "]" }), false),
		).toBe("forward")
		expect(
			designStackShortcutCommand(keyboard({ ctrlKey: true, key: "[" }), false),
		).toBe("backward")
		expect(
			designStackShortcutCommand(
				keyboard({ ctrlKey: true, key: "]", shiftKey: true }),
				false,
			),
		).toBe("front")
		expect(
			designStackShortcutCommand(
				keyboard({ ctrlKey: true, key: "[", shiftKey: true }),
				false,
			),
		).toBe("back")
	})

	it("accepts shifted bracket key values on Mac-like platforms", () => {
		expect(
			designStackShortcutCommand(
				keyboard({ key: "}", metaKey: true, shiftKey: true }),
				true,
			),
		).toBe("front")
		expect(
			designStackShortcutCommand(
				keyboard({ key: "{", metaKey: true, shiftKey: true }),
				true,
			),
		).toBe("back")
	})

	it("uses physical bracket codes when Shift produces locale-specific keys", () => {
		expect(
			designStackShortcutCommand(
				keyboard({
					code: "BracketRight",
					ctrlKey: true,
					key: "Dead",
					shiftKey: true,
				}),
				false,
			),
		).toBe("front")
		expect(
			designStackShortcutCommand(
				keyboard({
					code: "BracketLeft",
					key: "«",
					metaKey: true,
					shiftKey: true,
				}),
				true,
			),
		).toBe("back")
	})

	it("rejects the non-platform modifier, mixed modifiers, Alt, and other keys", () => {
		expect(
			designStackShortcutCommand(keyboard({ ctrlKey: true }), true),
		).toBeNull()
		expect(
			designStackShortcutCommand(keyboard({ metaKey: true }), false),
		).toBeNull()
		expect(
			designStackShortcutCommand(
				keyboard({ ctrlKey: true, metaKey: true }),
				false,
			),
		).toBeNull()
		expect(
			designStackShortcutCommand(
				keyboard({ altKey: true, ctrlKey: true }),
				false,
			),
		).toBeNull()
		expect(
			designStackShortcutCommand(keyboard({ ctrlKey: true, key: "p" }), false),
		).toBeNull()
	})
})
