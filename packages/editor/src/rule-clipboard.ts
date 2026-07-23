import type { EditorRuleSource, RuleId } from "@create-font/states"

export const RULE_CLIPBOARD_MIME = "application/x-create-font-rule+json"
const MAX_RULES = 1_000
const MAX_BYTES = 1_000_000

export interface RuleClipboardPayload {
	readonly format: "create-font.rules"
	readonly version: 1
	readonly rules: readonly Omit<EditorRuleSource, "id">[]
}

export function createRuleClipboardPayload(
	rules: readonly EditorRuleSource[],
): RuleClipboardPayload {
	return {
		format: "create-font.rules",
		version: 1,
		rules: rules.map(({ a, b }) => ({ a, b })),
	}
}

export function parseRuleClipboard(
	serialized: string,
):
	| { readonly ok: true; readonly value: RuleClipboardPayload }
	| { readonly ok: false; readonly error: string } {
	if (serialized.length > MAX_BYTES)
		return { ok: false, error: "The rule clipboard payload is too large." }
	let value: unknown
	try {
		value = JSON.parse(serialized)
	} catch {
		return { ok: false, error: "The rule clipboard payload is malformed." }
	}
	if (typeof value !== "object" || value === null)
		return {
			ok: false,
			error: "The clipboard does not contain create-font rules.",
		}
	const candidate = value as Partial<RuleClipboardPayload>
	if (
		candidate.format !== "create-font.rules" ||
		candidate.version !== 1 ||
		!Array.isArray(candidate.rules)
	)
		return {
			ok: false,
			error: "The clipboard does not contain create-font rules.",
		}
	if (candidate.rules.length === 0 || candidate.rules.length > MAX_RULES)
		return {
			ok: false,
			error: "The clipboard contains an invalid number of rules.",
		}
	for (const rule of candidate.rules) {
		if (
			typeof rule !== "object" ||
			rule === null ||
			typeof rule.a !== "object" ||
			rule.a === null ||
			typeof rule.b !== "object" ||
			rule.b === null ||
			![rule.a.x, rule.a.y, rule.b.x, rule.b.y].every(
				(coordinate) =>
					typeof coordinate === "number" && Number.isFinite(coordinate),
			) ||
			Math.hypot(rule.b.x - rule.a.x, rule.b.y - rule.a.y) <= 1e-6
		)
			return { ok: false, error: "A clipboard rule is malformed." }
	}
	return { ok: true, value: candidate as RuleClipboardPayload }
}

export function pastedRules(
	payload: RuleClipboardPayload,
	id: (index: number) => RuleId,
): readonly EditorRuleSource[] {
	return payload.rules.map((rule, index) => ({
		id: id(index),
		a: { ...rule.a },
		b: { ...rule.b },
	}))
}
