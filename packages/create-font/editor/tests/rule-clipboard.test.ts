import { describe, expect, it } from "vitest"

import {
	createRuleClipboardPayload,
	parseRuleClipboard,
	pastedRules,
} from "../src/rule-clipboard.ts"

describe("rule clipboard", () => {
	it("round trips rules without identity and allocates fresh IDs", () => {
		const payload = createRuleClipboardPayload([
			{ id: "rule:old", a: { x: 1, y: 2 }, b: { x: 3, y: 4 } },
		])
		const parsed = parseRuleClipboard(JSON.stringify(payload))
		expect(parsed.ok).toBe(true)
		if (!parsed.ok) return
		expect(pastedRules(parsed.value, () => "rule:new")).toEqual([
			{ id: "rule:new", a: { x: 1, y: 2 }, b: { x: 3, y: 4 } },
		])
	})

	it("rejects non-finite, coincident, excessive, and unrelated payloads", () => {
		expect(
			parseRuleClipboard(
				'{"format":"create-font.rules","version":1,"rules":[{"a":{"x":0,"y":0},"b":{"x":0,"y":0}}]}',
			).ok,
		).toBe(false)
		expect(
			parseRuleClipboard('{"format":"other","version":1,"rules":[]}').ok,
		).toBe(false)
		expect(parseRuleClipboard("x".repeat(1_000_001)).ok).toBe(false)
	})
})
