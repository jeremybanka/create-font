import type { GlyphId } from "@trigraph/states"
import { useEffect } from "preact/hooks"

import type { EditorWorkspace } from "./editor-workspace.ts"
import type { TimelinePosition } from "./state-hooks.ts"

type Alphabetical =
	| "a"
	| "b"
	| "c"
	| "d"
	| "e"
	| "f"
	| "g"
	| "h"
	| "i"
	| "j"
	| "k"
	| "l"
	| "m"
	| "n"
	| "o"
	| "p"
	| "q"
	| "r"
	| "s"
	| "t"
	| "u"
	| "v"
	| "w"
	| "x"
	| "y"
	| "z"
type Numerical = "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9"
type PlusMinus = "-" | "="

export interface Hotkey {
	readonly key: Alphabetical | Numerical | PlusMinus
	readonly shift?: boolean
	readonly alt?: boolean
	readonly mod?: boolean
}

export type ToolStatus = "active" | "disabled" | "ready"

export interface ToolContext {
	readonly workspace: EditorWorkspace
	readonly activeGlyphId: GlyphId
	readonly history: TimelinePosition
}

export interface Tool {
	readonly id: string
	readonly displayName: string
	readonly hotkey: Hotkey
	readonly icon: string
	readonly status: (context: ToolContext) => ToolStatus
	readonly do: (context: ToolContext) => void
}

export const TOOLS = {
	UNDO: {
		id: "undo",
		displayName: "Undo",
		hotkey: { key: "z", mod: true },
		icon: "↶",
		status: ({ history }) => (history.at === 0 ? "disabled" : "ready"),
		do: ({ activeGlyphId, workspace }) => workspace.font.undo(activeGlyphId),
	},
	REDO: {
		id: "redo",
		displayName: "Redo",
		hotkey: { key: "z", mod: true, shift: true },
		icon: "↷",
		status: ({ history }) =>
			history.at === history.length ? "disabled" : "ready",
		do: ({ activeGlyphId, workspace }) => workspace.font.redo(activeGlyphId),
	},
} as const satisfies Record<string, Tool>

export const TOOLBAR_LAYOUT = [
	[TOOLS.UNDO, TOOLS.REDO],
] as const satisfies readonly (readonly Tool[])[]

type ToolsThatExist = (typeof TOOLS)[keyof typeof TOOLS]["id"]
type ToolsInToolbar = (typeof TOOLBAR_LAYOUT)[number][number]["id"]
true satisfies ToolsThatExist extends ToolsInToolbar ? true : false

interface NavigatorWithUserAgentData {
	readonly platform: string
	readonly userAgentData?: {
		readonly platform?: string
	}
}

export function isMacLike(navigatorValue: NavigatorWithUserAgentData): boolean {
	const platform = navigatorValue.userAgentData?.platform
	return /mac|iphone|ipad|ipod/i.test(platform ?? navigatorValue.platform)
}

export const IS_MAC_LIKE =
	typeof navigator === "undefined" ? false : isMacLike(navigator)
export const MOD_KEY_LABEL = IS_MAC_LIKE ? "⌘" : "ctrl"
export const ALT_KEY_LABEL = IS_MAC_LIKE ? "⌥" : "alt"

function quickLookupKey(hotkey: Hotkey): string {
	const modifier = hotkey.mod ? "m" : "_"
	const shift = hotkey.shift ? "s" : "_"
	const alt = hotkey.alt ? "a" : "_"
	return `${hotkey.key}${modifier}${shift}${alt}`
}

function buildQuickLookup(
	tools: Readonly<Record<string, Tool>>,
): Readonly<Record<string, Tool>> {
	return Object.fromEntries(
		Object.values(tools).map((tool) => [quickLookupKey(tool.hotkey), tool]),
	)
}

const HOTKEY_QUICK_LOOKUP = buildQuickLookup(TOOLS)

interface KeyboardShortcutEvent {
	readonly key: string
	readonly metaKey: boolean
	readonly ctrlKey: boolean
	readonly shiftKey: boolean
	readonly altKey: boolean
}

export function toolForKeyboardEvent(
	event: KeyboardShortcutEvent,
	macLike = IS_MAC_LIKE,
): Tool | undefined {
	// Treat the non-platform modifier as an extra modifier, not as Mod.
	if (macLike ? event.ctrlKey : event.metaKey) return undefined
	return HOTKEY_QUICK_LOOKUP[
		quickLookupKey({
			key: event.key.toLowerCase() as Hotkey["key"],
			mod: macLike ? event.metaKey : event.ctrlKey,
			shift: event.shiftKey,
			alt: event.altKey,
		})
	]
}

export function formatHotkey(
	hotkey: Hotkey,
	macLike = IS_MAC_LIKE,
): readonly string[] {
	const parts: string[] = []
	if (hotkey.mod) parts.push(macLike ? "⌘" : "ctrl")
	if (hotkey.shift) parts.push("Shift")
	if (hotkey.alt) parts.push(macLike ? "Option" : "Alt")
	parts.push(hotkey.key.toUpperCase())
	return parts
}

export function ariaKeyShortcut(hotkey: Hotkey, macLike = IS_MAC_LIKE): string {
	const parts: string[] = []
	if (hotkey.mod) parts.push(macLike ? "Meta" : "Control")
	if (hotkey.shift) parts.push("Shift")
	if (hotkey.alt) parts.push("Alt")
	parts.push(hotkey.key.toUpperCase())
	return parts.join("+")
}

function isEditableTarget(target: EventTarget | null): boolean {
	return (
		target instanceof HTMLInputElement ||
		target instanceof HTMLTextAreaElement ||
		target instanceof HTMLSelectElement ||
		(target instanceof HTMLElement && target.isContentEditable)
	)
}

export function useHotkeys(context: ToolContext): void {
	const { activeGlyphId, history, workspace } = context
	useEffect(() => {
		const currentContext = { activeGlyphId, history, workspace }
		const handleKeyDown = (event: KeyboardEvent): void => {
			if (isEditableTarget(event.target)) return
			const tool = toolForKeyboardEvent(event)
			if (tool === undefined) return
			event.preventDefault()
			if (tool.status(currentContext) !== "disabled") tool.do(currentContext)
		}
		window.addEventListener("keydown", handleKeyDown)
		return () => window.removeEventListener("keydown", handleKeyDown)
	}, [activeGlyphId, history.at, history.length, workspace])
}
