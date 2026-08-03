import { describe, expect, it } from "vitest"

import {
	isMomentaryPreviewKey,
	shouldStartMomentaryPreview,
} from "../src/momentary-preview.ts"

const keyboard = (
	overrides: Partial<{
		key: string
		metaKey: boolean
		ctrlKey: boolean
		altKey: boolean
		isComposing: boolean
	}> = {},
) => ({
	key: "e",
	metaKey: false,
	ctrlKey: false,
	altKey: false,
	isComposing: false,
	...overrides,
})

describe("momentary preview keyboard state", () => {
	it("starts for an unmodified E key and recognizes its release", () => {
		expect(shouldStartMomentaryPreview(keyboard())).toBe(true)
		expect(isMomentaryPreviewKey({ key: "E" })).toBe(true)
	})

	it("ignores modified, composing, and unrelated keys", () => {
		expect(shouldStartMomentaryPreview(keyboard({ metaKey: true }))).toBe(false)
		expect(shouldStartMomentaryPreview(keyboard({ ctrlKey: true }))).toBe(false)
		expect(shouldStartMomentaryPreview(keyboard({ altKey: true }))).toBe(false)
		expect(shouldStartMomentaryPreview(keyboard({ isComposing: true }))).toBe(
			false,
		)
		expect(shouldStartMomentaryPreview(keyboard({ key: "r" }))).toBe(false)
	})
})
