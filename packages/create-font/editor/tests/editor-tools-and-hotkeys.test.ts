import { describe, expect, it, vi } from "vitest"

import {
	ariaKeyShortcut,
	formatHotkey,
	isMacLike,
	TOOLS,
	toolDisabledReason,
	toolForKeyboardEvent,
} from "../src/editor-tools-and-hotkeys.ts"

function keyboardEvent(
	overrides: Partial<{
		key: string
		metaKey: boolean
		ctrlKey: boolean
		shiftKey: boolean
		altKey: boolean
		defaultPrevented: boolean
	}> = {},
) {
	return {
		key: "z",
		metaKey: false,
		ctrlKey: false,
		shiftKey: false,
		altKey: false,
		defaultPrevented: false,
		...overrides,
	}
}

describe("editor tools and hotkeys", () => {
	it("explains disabled tool states with an actionable remedy", () => {
		const context = {
			editingTextIndex: null,
			activeTool: "select",
			history: { at: 0, length: 0 },
			selection: [],
			activeLayer: null,
		} as unknown as Parameters<typeof toolDisabledReason>[1]
		expect(toolDisabledReason(TOOLS.PEN, context)).toBe(
			"Double-click a glyph to enter outline editing.",
		)
		expect(toolDisabledReason(TOOLS.UNDO, context)).toBe(
			"There are no edits to undo.",
		)
	})
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

	it("maps Q to pen, K to knife, and V to select", () => {
		expect(toolForKeyboardEvent(keyboardEvent({ key: "q" }), true)?.id).toBe(
			"pen",
		)
		expect(toolForKeyboardEvent(keyboardEvent({ key: "v" }), true)?.id).toBe(
			"select",
		)
		expect(toolForKeyboardEvent(keyboardEvent({ key: "k" }), true)?.id).toBe(
			"knife",
		)
		expect(TOOLS.PEN.hotkey).toEqual({ key: "q" })
		expect(TOOLS.KNIFE.hotkey).toEqual({ key: "k" })
		expect(TOOLS.KNIFE.icon).toBe("HobbyKnifeIcon")
		expect(TOOLS.SELECT.hotkey).toEqual({ key: "v" })
	})

	it("maps R to Rect and O to Ellipse without breaking Shift+R", () => {
		expect(toolForKeyboardEvent(keyboardEvent({ key: "r" }), true)?.id).toBe(
			"rect",
		)
		expect(toolForKeyboardEvent(keyboardEvent({ key: "o" }), true)?.id).toBe(
			"ellipse",
		)
		expect(
			toolForKeyboardEvent(keyboardEvent({ key: "r", shiftKey: true }), true)
				?.id,
		).toBe("reverse-path")
		expect(TOOLS.RECT.hotkey).toEqual({ key: "r" })
		expect(TOOLS.ELLIPSE.hotkey).toEqual({ key: "o" })
	})

	it("ignores shortcuts already consumed by an interaction mode", () => {
		expect(
			toolForKeyboardEvent(
				keyboardEvent({ key: "q", defaultPrevented: true }),
				true,
			),
		).toBeUndefined()
		expect(
			toolForKeyboardEvent(
				keyboardEvent({ metaKey: true, defaultPrevented: true }),
				true,
			),
		).toBeUndefined()
	})

	it("maps transform and path commands to exact shortcuts", () => {
		expect(toolForKeyboardEvent(keyboardEvent({ key: "t" }), true)?.id).toBe(
			"transform",
		)
		expect(
			toolForKeyboardEvent(keyboardEvent({ key: "a", shiftKey: true }), true)
				?.id,
		).toBe("align-selection")
		expect(
			toolForKeyboardEvent(keyboardEvent({ key: "r", shiftKey: true }), true)
				?.id,
		).toBe("reverse-path")
		expect(
			toolForKeyboardEvent(keyboardEvent({ key: "f", shiftKey: true }), true)
				?.id,
		).toBe("make-node-first")
		expect(
			toolForKeyboardEvent(keyboardEvent({ key: "h", shiftKey: true }), true)
				?.id,
		).toBe("invert-horizontal")
		expect(
			toolForKeyboardEvent(keyboardEvent({ key: "v", shiftKey: true }), true)
				?.id,
		).toBe("invert-vertical")
	})

	it("reverses open paths and remaps handle selection through history", () => {
		const reverseContour = vi.fn()
		const markDocumentChanged = vi.fn()
		const setState = vi.fn()
		const selectionToken = Symbol("selection")
		const context = {
			activeGlyphId: "glyph:test",
			activeMasterId: "master:test",
			activeTool: "select",
			editingTextIndex: 0,
			history: { at: 0, length: 0 },
			selection: [{ kind: "handle", pointId: "point:a", handle: "incoming" }],
			activeLayer: {
				contours: [
					{
						id: "contour:test",
						closed: false,
						nodes: [
							{
								pointId: "point:a",
								mode: "soft",
								x: 10,
								y: 0,
								incoming: { x: 0, y: -20 },
							},
							{ pointId: "point:b", mode: "hard", x: 10, y: 100 },
						],
					},
				],
			},
			workspace: {
				font: {
					actions: { markDocumentChanged, reverseContour },
					silo: { setState },
				},
				ui: { selection: selectionToken },
			},
		} as unknown as Parameters<(typeof TOOLS)["REVERSE"]["do"]>[0]

		expect(TOOLS.REVERSE.status(context)).toBe("ready")
		TOOLS.REVERSE.do(context)

		expect(reverseContour).toHaveBeenCalledWith({
			masterId: "master:test",
			glyphId: "glyph:test",
			contourId: "contour:test",
		})
		expect(setState).toHaveBeenCalledOnce()
		expect(setState).toHaveBeenLastCalledWith(selectionToken, [
			{ kind: "handle", pointId: "point:a", handle: "outgoing" },
		])

		const undo = vi.fn()
		const redo = vi.fn()
		const clear = vi.fn()
		TOOLS.UNDO.do({
			...context,
			history: { at: 1, length: 1, undo, redo, clear },
			selection: [{ kind: "handle", pointId: "point:a", handle: "outgoing" }],
		})
		expect(undo).toHaveBeenCalledOnce()
		expect(setState).toHaveBeenLastCalledWith(selectionToken, [
			{ kind: "handle", pointId: "point:a", handle: "incoming" },
		])
		TOOLS.REDO.do({
			...context,
			history: { at: 0, length: 1, undo, redo, clear },
			selection: [{ kind: "handle", pointId: "point:a", handle: "incoming" }],
		})
		expect(redo).toHaveBeenCalledOnce()
		expect(markDocumentChanged).toHaveBeenCalledTimes(2)
		expect(setState).toHaveBeenLastCalledWith(selectionToken, [
			{ kind: "handle", pointId: "point:a", handle: "outgoing" },
		])
	})

	it("inverts exactly the resolved mixed selection across contours", () => {
		const transformControls = vi.fn()
		const selection = [
			{ kind: "node", pointId: "point:a" },
			{ kind: "handle", pointId: "point:b", handle: "incoming" },
			{ kind: "node", pointId: "point:c" },
		] as const
		const context = {
			activeGlyphId: "glyph:test",
			activeMasterId: "master:test",
			activeTool: "select",
			editingTextIndex: 0,
			history: { at: 0, length: 0 },
			selection,
			activeLayer: {
				contours: [
					{
						id: "contour:first",
						closed: false,
						nodes: [
							{
								pointId: "point:a",
								mode: "hard",
								x: 10,
								y: 20,
								outgoing: { x: 7, y: 9 },
							},
							{
								pointId: "point:b",
								mode: "soft",
								x: 40,
								y: 50,
								incoming: { x: -20, y: -10 },
								outgoing: { x: 20, y: 10 },
							},
						],
					},
					{
						id: "contour:second",
						closed: true,
						nodes: [
							{ pointId: "point:c", mode: "hard", x: 90, y: 80 },
							{ pointId: "point:d", mode: "hard", x: 120, y: 140 },
						],
					},
				],
			},
			workspace: { font: { actions: { transformControls } } },
		} as unknown as Parameters<(typeof TOOLS)["INVERT_HORIZONTAL"]["do"]>[0]

		expect(TOOLS.INVERT_HORIZONTAL.status(context)).toBe("ready")
		expect(TOOLS.INVERT_VERTICAL.status(context)).toBe("ready")
		TOOLS.INVERT_HORIZONTAL.do(context)
		TOOLS.INVERT_VERTICAL.do(context)

		expect(transformControls).toHaveBeenNthCalledWith(1, {
			masterId: "master:test",
			glyphId: "glyph:test",
			points: [
				{ pointId: "point:a", x: 90, y: 20 },
				{ pointId: "point:c", x: 10, y: 80 },
			],
			handles: [{ pointId: "point:b", handle: "incoming", x: 80, y: 40 }],
		})
		expect(transformControls).toHaveBeenNthCalledWith(2, {
			masterId: "master:test",
			glyphId: "glyph:test",
			points: [
				{ pointId: "point:a", x: 10, y: 80 },
				{ pointId: "point:c", x: 90, y: 20 },
			],
			handles: [{ pointId: "point:b", handle: "incoming", x: 20, y: 60 }],
		})
		expect(context.selection).toBe(selection)
	})

	it("keeps inversion disabled without a resolvable selection", () => {
		const context = {
			activeGlyphId: "glyph:test",
			editingTextIndex: 0,
			selection: [{ kind: "node", pointId: "point:missing" }],
			activeLayer: { contours: [] },
		} as unknown as Parameters<(typeof TOOLS)["INVERT_HORIZONTAL"]["status"]>[0]
		expect(TOOLS.INVERT_HORIZONTAL.status(context)).toBe("disabled")
		expect(toolDisabledReason(TOOLS.INVERT_HORIZONTAL, context)).toBe(
			"Select at least one node or handle to invert.",
		)
	})

	it("keeps a single-control inversion finite and deterministic", () => {
		const transformControls = vi.fn()
		const context = {
			activeGlyphId: "glyph:test",
			activeMasterId: "master:test",
			editingTextIndex: 0,
			selection: [{ kind: "node", pointId: "point:only" }],
			activeLayer: {
				contours: [
					{
						id: "contour:only",
						nodes: [{ pointId: "point:only", mode: "hard", x: 23, y: -47 }],
					},
				],
			},
			workspace: { font: { actions: { transformControls } } },
		} as unknown as Parameters<(typeof TOOLS)["INVERT_HORIZONTAL"]["do"]>[0]

		TOOLS.INVERT_HORIZONTAL.do(context)
		expect(transformControls).toHaveBeenCalledWith({
			masterId: "master:test",
			glyphId: "glyph:test",
			points: [{ pointId: "point:only", x: 23, y: -47 }],
			handles: [],
		})
	})

	it("dispatches alignment as one mixed-control state action", () => {
		const transformControls = vi.fn()
		const context = {
			activeGlyphId: "glyph:test",
			activeMasterId: "master:test",
			activeTool: "select",
			editingTextIndex: 0,
			selection: [
				{ kind: "node", pointId: "point:a" },
				{ kind: "node", pointId: "point:b" },
			],
			activeLayer: {
				contours: [
					{
						id: "contour:test",
						closed: true,
						nodes: [
							{ pointId: "point:a", mode: "hard", x: 10, y: 0 },
							{ pointId: "point:b", mode: "hard", x: 12, y: 100 },
						],
					},
				],
			},
			workspace: { font: { actions: { transformControls } } },
		} as unknown as Parameters<(typeof TOOLS)["ALIGN"]["do"]>[0]

		expect(TOOLS.ALIGN.status(context)).toBe("ready")
		TOOLS.ALIGN.do(context)
		expect(transformControls).toHaveBeenCalledWith({
			masterId: "master:test",
			glyphId: "glyph:test",
			points: [
				{ pointId: "point:a", x: 11, y: 0 },
				{ pointId: "point:b", x: 11, y: 100 },
			],
			handles: [],
		})
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

	it("delegates history commands to the controls returned by useTL", () => {
		const undo = vi.fn()
		const redo = vi.fn()
		const markDocumentChanged = vi.fn()
		const context = {
			activeGlyphId: "unused",
			workspace: { font: { actions: { markDocumentChanged } } },
			history: { at: 1, length: 2, undo, redo, clear: vi.fn() },
		} as unknown as Parameters<(typeof TOOLS)["UNDO"]["do"]>[0]

		TOOLS.UNDO.do(context)
		TOOLS.REDO.do(context)

		expect(undo).toHaveBeenCalledOnce()
		expect(redo).toHaveBeenCalledOnce()
		expect(markDocumentChanged).toHaveBeenCalledTimes(2)
	})

	it("delegates kerning history through the registered document actions", () => {
		const undo = vi.fn()
		const redo = vi.fn()
		const undoKerning = vi.fn()
		const redoKerning = vi.fn()
		const context = {
			activeGlyphId: "unused",
			kerningActive: true,
			workspace: { font: { actions: { redoKerning, undoKerning } } },
			history: { at: 1, length: 2, undo, redo, clear: vi.fn() },
		} as unknown as Parameters<(typeof TOOLS)["UNDO"]["do"]>[0]

		TOOLS.UNDO.do(context)
		TOOLS.REDO.do(context)

		expect(undoKerning).toHaveBeenCalledOnce()
		expect(redoKerning).toHaveBeenCalledOnce()
		expect(undo).not.toHaveBeenCalled()
		expect(redo).not.toHaveBeenCalled()
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
