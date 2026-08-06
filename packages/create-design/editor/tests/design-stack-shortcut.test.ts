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
	it("maps all four Control shortcuts off macOS", () => {
		expect(
			designStackShortcutCommand(keyboard({ ctrlKey: true, key: "]" }), false),
		).toBe("forward")
		expect(
			designStackShortcutCommand(keyboard({ ctrlKey: true, key: "[" }), false),
		).toBe("backward")
		expect(
			designStackShortcutCommand(
				keyboard({ altKey: true, ctrlKey: true, key: "]" }),
				false,
			),
		).toBe("front")
		expect(
			designStackShortcutCommand(
				keyboard({ altKey: true, ctrlKey: true, key: "[" }),
				false,
			),
		).toBe("back")
	})

	it("maps Option-Command brackets on Mac-like platforms", () => {
		expect(
			designStackShortcutCommand(
				keyboard({ altKey: true, key: "]", metaKey: true }),
				true,
			),
		).toBe("front")
		expect(
			designStackShortcutCommand(
				keyboard({ altKey: true, key: "[", metaKey: true }),
				true,
			),
		).toBe("back")
	})

	it("uses physical bracket codes when Option/Alt produces locale-specific keys", () => {
		expect(
			designStackShortcutCommand(
				keyboard({
					altKey: true,
					code: "BracketRight",
					ctrlKey: true,
					key: "Dead",
				}),
				false,
			),
		).toBe("front")
		expect(
			designStackShortcutCommand(
				keyboard({
					altKey: true,
					code: "BracketLeft",
					key: "«",
					metaKey: true,
				}),
				true,
			),
		).toBe("back")
	})

	it("rejects the non-platform modifier, mixed modifiers, Shift, and other keys", () => {
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
				keyboard({ ctrlKey: true, shiftKey: true }),
				false,
			),
		).toBeNull()
		expect(
			designStackShortcutCommand(keyboard({ ctrlKey: true, key: "p" }), false),
		).toBeNull()
	})
})
