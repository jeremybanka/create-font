import type { EditorControlHitCandidate } from "./canvas-hit-testing.ts"
import type { PaletteCommand } from "@create-art/editor"
import { selectionKey } from "./outline-selection.ts"

export const VISUAL_DEBUG_TOGGLES = [
	{
		id: "hit-targets",
		displayName: "Show click targets",
		keywords: ["hit", "regions", "nodes", "handles", "edges"],
	},
	{
		id: "compatibility",
		displayName: "Show master compatibility",
		keywords: ["master", "ghost", "mapping", "paths", "interpolation"],
	},
] as const

export type VisualDebugToggleId = (typeof VISUAL_DEBUG_TOGGLES)[number]["id"]
export type VisualDebugState = Readonly<Record<VisualDebugToggleId, boolean>>

export const DEFAULT_VISUAL_DEBUG_STATE: VisualDebugState = Object.freeze({
	"hit-targets": false,
	compatibility: false,
})

export const COMPATIBILITY_GHOST_OFFSET = Object.freeze({ x: -12, y: 12 })

export type CompatibilityGhostOffset = Readonly<{
	x: number
	y: number
}>

const PATH_COLORS = [
	"#8fd3ff",
	"#ffb7d5",
	"#b9e99b",
	"#ffe08a",
	"#cbb8ff",
	"#8fe4dc",
	"#ffc59a",
	"#d6d998",
] as const

export function compatibilityPathColor(pathIndex: number): string {
	const index =
		((pathIndex % PATH_COLORS.length) + PATH_COLORS.length) % PATH_COLORS.length
	return PATH_COLORS[index] ?? PATH_COLORS[0]
}

export function compatibilityNodeTraceStyle(inverseScale: number): Readonly<{
	readonly dash: [number, number]
	readonly haloWidth: number
	readonly strokeWidth: number
}> {
	return {
		dash: [7 * inverseScale, 5 * inverseScale],
		haloWidth: 4 * inverseScale,
		strokeWidth: 1.75 * inverseScale,
	}
}

export function toggleVisualDebug(
	state: VisualDebugState,
	id: VisualDebugToggleId,
): VisualDebugState {
	return Object.freeze({ ...state, [id]: !state[id] })
}

export function visualDebugPaletteCommands(
	state: VisualDebugState,
	onToggle: (id: VisualDebugToggleId) => void,
): readonly PaletteCommand[] {
	return VISUAL_DEBUG_TOGGLES.map((toggle) => ({
		id: `visual-debug:${toggle.id}`,
		displayName: toggle.displayName,
		category: "Visual Debug",
		icon: "DotFilledIcon",
		keywords: toggle.keywords,
		status: state[toggle.id] ? "On" : "Off",
		checked: state[toggle.id],
		do: () => onToggle(toggle.id),
	}))
}

export interface VisualDebugControlRegion {
	readonly key: string
	readonly x: number
	readonly y: number
	readonly radiusPx: number
	readonly coincidentNonOwner: boolean
}

export function visualDebugControlRegions(
	candidates: readonly EditorControlHitCandidate[],
	radii: ReadonlyMap<string, number>,
): readonly VisualDebugControlRegion[] {
	return candidates.map((candidate) => {
		const key = selectionKey(candidate.target)
		const radiusPx = radii.get(key) ?? 0
		return {
			key,
			x: candidate.x,
			y: candidate.y,
			radiusPx,
			coincidentNonOwner: radiusPx === 0,
		}
	})
}
