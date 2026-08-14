import type { CollaborationPresence } from "@create-art/realtime"
import type { PointId } from "@create-font/states"

import type {
	EditorSelectionTarget,
	SelectionBounds,
} from "./outline-selection.ts"

export interface PresenceGlyphPosition {
	readonly advance: number
	readonly baseline: number
	readonly glyphId: string | null
	readonly textStart: number
	readonly x: number
}

export function participantColor(deviceId: string): string {
	let hash = 0
	for (const character of deviceId) {
		hash = (hash * 31 + character.codePointAt(0)!) >>> 0
	}
	return `hsl(${hash % 360} 58% 46%)`
}

export function participantInitials(name: string): string {
	const words = name.trim().split(/\s+/).filter(Boolean)
	if (words.length === 0) return `?`
	return `${words[0]![0] ?? ``}${words.length === 1 ? `` : (words.at(-1)?.[0] ?? ``)}`.toLocaleUpperCase()
}

export function normalizedPresenceSelectionBox(
	box: Readonly<{
		startX: number
		startY: number
		endX: number
		endY: number
	}> | null,
): SelectionBounds | null {
	if (box === null) return null
	return {
		minX: Math.min(box.startX, box.endX),
		minY: Math.min(box.startY, box.endY),
		maxX: Math.max(box.startX, box.endX),
		maxY: Math.max(box.startY, box.endY),
	}
}

export function parsePresenceSelection(
	selection: readonly string[],
): readonly EditorSelectionTarget[] {
	return selection.flatMap((value): readonly EditorSelectionTarget[] => {
		try {
			const parsed = JSON.parse(value) as unknown
			if (typeof parsed !== `object` || parsed === null) return []
			const record = parsed as Record<string, unknown>
			if (typeof record.pointId !== `string`) return []
			if (record.kind === `node`) {
				return [{ kind: `node`, pointId: record.pointId as PointId }]
			}
			if (
				record.kind === `handle` &&
				(record.handle === `incoming` || record.handle === `outgoing`)
			) {
				return [
					{
						handle: record.handle,
						kind: `handle`,
						pointId: record.pointId as PointId,
					},
				]
			}
			return []
		} catch {
			return []
		}
	})
}

export function presenceGlyphPosition(
	presence: Pick<CollaborationPresence, "context">,
	positions: readonly PresenceGlyphPosition[],
): PresenceGlyphPosition | null {
	const glyphId = presence.context.glyph
	if (glyphId === null || glyphId === undefined) return null
	const textIndex = Number(presence.context.textIndex)
	if (Number.isSafeInteger(textIndex)) {
		const exact = positions.find(
			(position) =>
				position.textStart === textIndex && position.glyphId === glyphId,
		)
		if (exact !== undefined) return exact
	}
	return positions.find((position) => position.glyphId === glyphId) ?? null
}
