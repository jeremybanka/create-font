import type { GlyphId, MasterId } from "@create-font/states"
import { useEffect } from "preact/hooks"

import type { EditorIconName } from "./EditorIcon.tsx"
import { deriveOneSidedSoftHandles } from "./curve-editing.ts"
import type {
	EditorCanvasContour,
	EditorCanvasLayer,
	EditorToolId,
	EditorWorkspace,
} from "./editor-workspace.ts"
import {
	boundsOfControls,
	contourSelectionTargets,
	nearestAxisAlignment,
	reverseSelectionHandles,
	resolveSelectionControls,
	type EditorSelectionTarget,
} from "./outline-selection.ts"
import type { TimelineMeta } from "./state-hooks.ts"

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
	readonly activeMasterId: MasterId
	readonly activeTool: EditorToolId
	readonly activeLayer: EditorCanvasLayer | null
	readonly editingTextIndex: number | null
	readonly history: TimelineMeta
	readonly selection: readonly EditorSelectionTarget[]
}

export interface Tool {
	readonly description: string
	readonly id: string
	readonly displayName: string
	readonly hotkey: Hotkey
	readonly icon: EditorIconName
	readonly status: (context: ToolContext) => ToolStatus
	readonly do: (context: ToolContext) => void
}

export function toolDisabledReason(
	tool: Tool,
	context: ToolContext,
): string | undefined {
	if (tool.status(context) !== "disabled") return undefined
	if (
		context.editingTextIndex === null &&
		tool.id !== "undo" &&
		tool.id !== "redo"
	)
		return "Double-click a glyph to enter outline editing."
	switch (tool.id) {
		case "align-selection":
			return "Select at least two nodes or handles to align."
		case "reverse-path":
		case "invert-horizontal":
		case "invert-vertical":
			return "Select controls from exactly one path."
		case "make-node-first":
			return "Select one non-first node on a closed path."
		case "undo":
			return "There are no edits to undo."
		case "redo":
			return "There are no edits to redo."
		default:
			return "This action is unavailable in the current editor state."
	}
}

function selectedContour(context: ToolContext): EditorCanvasContour | null {
	const selectedIds = new Set(context.selection.map((target) => target.pointId))
	const contours = (context.activeLayer?.contours ?? []).filter((contour) =>
		contour.nodes.some((node) => selectedIds.has(node.pointId)),
	)
	return contours.length === 1 ? (contours[0] ?? null) : null
}

const directionChanges = new WeakMap<
	EditorWorkspace,
	Map<GlyphId, Set<number>>
>()

function rememberDirectionChange(context: ToolContext): void {
	let byGlyph = directionChanges.get(context.workspace)
	if (byGlyph === undefined) {
		byGlyph = new Map()
		directionChanges.set(context.workspace, byGlyph)
	}
	let entries = byGlyph.get(context.activeGlyphId)
	if (entries === undefined) {
		entries = new Set()
		byGlyph.set(context.activeGlyphId, entries)
	}
	for (const entry of entries) {
		if (entry > context.history.at) entries.delete(entry)
	}
	entries.add(context.history.at + 1)
}

function remapSelectionHandles(context: ToolContext): void {
	context.workspace.font.silo.setState(
		context.workspace.ui.selection,
		reverseSelectionHandles(context.selection),
	)
}

function inversionCenter(contour: EditorCanvasContour): {
	readonly centerX: number
	readonly centerY: number
} | null {
	const visibleNodes = deriveOneSidedSoftHandles(contour.nodes, contour.closed)
	const bounds = boundsOfControls(
		resolveSelectionControls(
			visibleNodes,
			contourSelectionTargets(visibleNodes),
		),
	)
	return bounds === null
		? null
		: {
				centerX: (bounds.minX + bounds.maxX) / 2,
				centerY: (bounds.minY + bounds.maxY) / 2,
			}
}

function directionChangeAt(context: ToolContext, entry: number): boolean {
	return (
		directionChanges
			.get(context.workspace)
			?.get(context.activeGlyphId)
			?.has(entry) ?? false
	)
}

export const TOOLS = {
	SELECT: {
		description: "Select and edit outline nodes and Bézier handles.",
		id: "select",
		displayName: "Select",
		hotkey: { key: "v" },
		icon: "CursorArrowIcon",
		status: ({ activeTool }) => (activeTool === "select" ? "active" : "ready"),
		do: ({ workspace }) => workspace.actions.selectTool("select"),
	},
	PEN: {
		description: "Draw a new contour one node at a time.",
		id: "pen",
		displayName: "Pen",
		hotkey: { key: "q" },
		icon: "Pencil1Icon",
		status: ({ activeTool, editingTextIndex }) =>
			editingTextIndex === null
				? "disabled"
				: activeTool === "pen"
					? "active"
					: "ready",
		do: ({ workspace }) => workspace.actions.selectTool("pen"),
	},
	TRANSFORM: {
		description:
			"Move or resize selected nodes and handles with a bounding box.",
		id: "transform",
		displayName: "Transform Selection",
		hotkey: { key: "t" },
		icon: "TransformIcon",
		status: ({ activeTool, editingTextIndex }) =>
			editingTextIndex === null
				? "disabled"
				: activeTool === "transform"
					? "active"
					: "ready",
		do: ({ workspace }) => workspace.actions.selectTool("transform"),
	},
	ALIGN: {
		description: "Align selected nodes and handles along their nearest axis.",
		id: "align-selection",
		displayName: "Align Selection",
		hotkey: { key: "a", shift: true },
		icon: "AlignCenterVerticallyIcon",
		status: ({ activeLayer, editingTextIndex, selection }) =>
			editingTextIndex === null ||
			activeLayer === null ||
			resolveSelectionControls(
				activeLayer.contours.flatMap(({ nodes }) => nodes),
				selection,
			).length < 2
				? "disabled"
				: "ready",
		do: (context) => {
			const nodes =
				context.activeLayer?.contours.flatMap(({ nodes }) => nodes) ?? []
			const plan = nearestAxisAlignment(
				resolveSelectionControls(nodes, context.selection),
			)
			if (plan === null) return
			context.workspace.font.actions.transformControls({
				masterId: context.activeMasterId,
				glyphId: context.activeGlyphId,
				points: plan.points,
				handles: plan.handles,
			})
		},
	},
	REVERSE: {
		description:
			"Reverse the selected path; closed paths keep their first node.",
		id: "reverse-path",
		displayName: "Reverse Path",
		hotkey: { key: "r", shift: true },
		icon: "ShuffleIcon",
		status: (context) =>
			context.editingTextIndex !== null && selectedContour(context) !== null
				? "ready"
				: "disabled",
		do: (context) => {
			const contour = selectedContour(context)
			if (contour === null) return
			context.workspace.font.actions.reverseContour({
				glyphId: context.activeGlyphId,
				contourId: contour.id,
			})
			rememberDirectionChange(context)
			remapSelectionHandles(context)
		},
	},
	INVERT_HORIZONTAL: {
		description:
			"Mirror the selected path horizontally and preserve its direction.",
		id: "invert-horizontal",
		displayName: "Invert Horizontally",
		hotkey: { key: "h", shift: true },
		icon: "TransformIcon",
		status: (context) =>
			context.editingTextIndex !== null && selectedContour(context) !== null
				? "ready"
				: "disabled",
		do: (context) => {
			const contour = selectedContour(context)
			if (contour === null) return
			const center = inversionCenter(contour)
			if (center === null) return
			context.workspace.font.actions.invertContour({
				masterId: context.activeMasterId,
				glyphId: context.activeGlyphId,
				contourId: contour.id,
				axis: "horizontal",
				...center,
			})
			rememberDirectionChange(context)
			remapSelectionHandles(context)
		},
	},
	INVERT_VERTICAL: {
		description:
			"Mirror the selected path vertically and preserve its direction.",
		id: "invert-vertical",
		displayName: "Invert Vertically",
		hotkey: { key: "v", shift: true },
		icon: "TransformIcon",
		status: (context) =>
			context.editingTextIndex !== null && selectedContour(context) !== null
				? "ready"
				: "disabled",
		do: (context) => {
			const contour = selectedContour(context)
			if (contour === null) return
			const center = inversionCenter(contour)
			if (center === null) return
			context.workspace.font.actions.invertContour({
				masterId: context.activeMasterId,
				glyphId: context.activeGlyphId,
				contourId: contour.id,
				axis: "vertical",
				...center,
			})
			rememberDirectionChange(context)
			remapSelectionHandles(context)
		},
	},
	MAKE_FIRST: {
		description: "Make the selected node the first node of its closed path.",
		id: "make-node-first",
		displayName: "Make Node First",
		hotkey: { key: "f", shift: true },
		icon: "StarIcon",
		status: (context) => {
			const nodes = context.selection.filter((target) => target.kind === "node")
			const contour = selectedContour(context)
			return context.editingTextIndex !== null &&
				nodes.length === 1 &&
				contour?.closed &&
				contour.nodes[0]?.pointId !== nodes[0]?.pointId
				? "ready"
				: "disabled"
		},
		do: (context) => {
			const target = context.selection.find(
				(candidate) => candidate.kind === "node",
			)
			const contour = selectedContour(context)
			if (target?.kind !== "node" || contour === null || !contour.closed) return
			context.workspace.font.actions.makeNodeFirst({
				glyphId: context.activeGlyphId,
				contourId: contour.id,
				pointId: target.pointId,
			})
		},
	},
	UNDO: {
		description: "Undo the latest edit to the active glyph.",
		id: "undo",
		displayName: "Undo",
		hotkey: { key: "z", mod: true },
		icon: "DoubleArrowLeftIcon",
		status: ({ history }) => (history.at === 0 ? "disabled" : "ready"),
		do: (context) => {
			const remap = directionChangeAt(context, context.history.at)
			context.history.undo()
			if (remap) remapSelectionHandles(context)
		},
	},
	REDO: {
		description: "Restore the next edit to the active glyph.",
		id: "redo",
		displayName: "Redo",
		hotkey: { key: "z", mod: true, shift: true },
		icon: "DoubleArrowRightIcon",
		status: ({ history }) =>
			history.at === history.length ? "disabled" : "ready",
		do: (context) => {
			const remap = directionChangeAt(context, context.history.at + 1)
			context.history.redo()
			if (remap) remapSelectionHandles(context)
		},
	},
} as const satisfies Record<string, Tool>

export const TOOLBAR_LAYOUT = [
	[TOOLS.SELECT, TOOLS.PEN, TOOLS.TRANSFORM],
	[TOOLS.UNDO, TOOLS.REDO],
	[
		TOOLS.ALIGN,
		TOOLS.REVERSE,
		TOOLS.MAKE_FIRST,
		TOOLS.INVERT_HORIZONTAL,
		TOOLS.INVERT_VERTICAL,
	],
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
	readonly defaultPrevented?: boolean
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
	if (event.defaultPrevented) return undefined
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

export function useHotkeys(context: ToolContext, enabled = true): void {
	const {
		activeGlyphId,
		activeLayer,
		activeMasterId,
		activeTool,
		editingTextIndex,
		history,
		selection,
		workspace,
	} = context
	useEffect(() => {
		if (!enabled) return
		const currentContext = {
			activeGlyphId,
			activeLayer,
			activeMasterId,
			activeTool,
			editingTextIndex,
			history,
			selection,
			workspace,
		}
		const handleKeyDown = (event: KeyboardEvent): void => {
			if (isEditableTarget(event.target)) return
			const tool = toolForKeyboardEvent(event)
			if (tool === undefined) return
			event.preventDefault()
			if (tool.status(currentContext) !== "disabled") tool.do(currentContext)
		}
		window.addEventListener("keydown", handleKeyDown)
		return () => window.removeEventListener("keydown", handleKeyDown)
	}, [
		activeGlyphId,
		activeLayer,
		activeMasterId,
		activeTool,
		editingTextIndex,
		history.at,
		history.length,
		selection,
		enabled,
		workspace,
	])
}
