import { describe, expect, it } from "vitest"

import {
	normalizedPresenceSelectionBox,
	parsePresenceSelection,
	participantColor,
	participantInitials,
	presenceGlyphPosition,
} from "../src/collaboration-presence.ts"

describe(`collaboration presence projection`, () => {
	it(`keeps participant presentation stable`, () => {
		expect(participantColor(`device-a`)).toBe(participantColor(`device-a`))
		expect(participantColor(`device-a`)).not.toBe(participantColor(`device-b`))
		expect(participantInitials(`Ada Lovelace`)).toBe(`AL`)
		expect(participantInitials(`Plato`)).toBe(`P`)
		expect(participantInitials(` `)).toBe(`?`)
	})

	it(`normalizes a live marquee in glyph-local coordinates`, () => {
		expect(
			normalizedPresenceSelectionBox({
				startX: 90,
				startY: 120,
				endX: 10,
				endY: -20,
			}),
		).toEqual({ minX: 10, minY: -20, maxX: 90, maxY: 120 })
	})

	it(`accepts only supported outline selection identities`, () => {
		expect(
			parsePresenceSelection([
				JSON.stringify({ kind: `node`, pointId: `point:a` }),
				JSON.stringify({
					kind: `handle`,
					pointId: `point:b`,
					handle: `outgoing`,
				}),
				JSON.stringify({ kind: `handle`, pointId: `point:c`, handle: `side` }),
				`not json`,
			]),
		).toEqual([
			{ kind: `node`, pointId: `point:a` },
			{ kind: `handle`, pointId: `point:b`, handle: `outgoing` },
		])
	})

	it(`projects to the same glyph occurrence and falls back by glyph identity`, () => {
		const positions = [
			{ advance: 500, baseline: 800, glyphId: `glyph:A`, textStart: 0, x: 20 },
			{ advance: 500, baseline: 800, glyphId: `glyph:A`, textStart: 4, x: 620 },
		]
		expect(
			presenceGlyphPosition(
				{ context: { glyph: `glyph:A`, textIndex: `4` } },
				positions,
			)?.x,
		).toBe(620)
		expect(
			presenceGlyphPosition(
				{ context: { glyph: `glyph:A`, textIndex: `99` } },
				positions,
			)?.x,
		).toBe(20)
	})
})
