import type { SourceDiagnostic } from "./types.ts"
import { diagnostic } from "./result.ts"

const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"])

interface PathNode {
	readonly parent: PathNode | null
	readonly segment:
		| { readonly kind: "index"; readonly index: number }
		| { readonly kind: "property"; readonly key: string }
}

interface ObjectFrame {
	readonly kind: "object"
	readonly path: PathNode | null
	readonly keys: Set<string>
	state: "colon" | "comma-or-end" | "key-or-end" | "value"
	pendingKey?: string
}

interface ArrayFrame {
	readonly kind: "array"
	readonly path: PathNode | null
	state: "comma-or-end" | "value-or-end"
	index: number
}

type JsonFrame = ArrayFrame | ObjectFrame

function renderPath(path: PathNode | null): string {
	const nodes: PathNode[] = []
	for (let node = path; node !== null; node = node.parent) nodes.push(node)
	const fragments = ["$"]
	for (let index = nodes.length - 1; index >= 0; index -= 1) {
		const segment = nodes[index]?.segment
		if (segment?.kind === "index") {
			fragments.push(`[${segment.index}]`)
		} else if (segment?.kind === "property") {
			fragments.push(
				!UNSAFE_KEYS.has(segment.key) &&
					/^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(segment.key)
					? `.${segment.key}`
					: `[${JSON.stringify(segment.key)}]`,
			)
		}
	}
	return fragments.join("")
}

/**
 * JSON.parse deliberately accepts duplicate object names with last-one-wins
 * semantics. This lexical pass runs after syntax validation and rejects that
 * ambiguity, as well as keys that are dangerous when data reaches ordinary
 * JavaScript assignment code.
 */
export function inspectJsonObjectKeys(
	text: string,
): readonly SourceDiagnostic[] {
	let offset = 0
	let rootConsumed = false
	const diagnostics: SourceDiagnostic[] = []
	const frames: JsonFrame[] = []

	const skipWhitespace = (): void => {
		while (
			text[offset] === " " ||
			text[offset] === "\t" ||
			text[offset] === "\n" ||
			text[offset] === "\r"
		) {
			offset += 1
		}
	}

	const readString = (): string => {
		const start = offset
		offset += 1
		while (offset < text.length) {
			const character = text[offset]
			if (character === "\\") {
				offset += text[offset + 1] === "u" ? 6 : 2
				continue
			}
			offset += 1
			if (character === '"') break
		}
		return JSON.parse(text.slice(start, offset)) as string
	}

	const consumeValuePath = (): PathNode | null => {
		const frame = frames.at(-1)
		if (frame === undefined) {
			rootConsumed = true
			return null
		}
		if (frame.kind === "array") {
			const path: PathNode = {
				parent: frame.path,
				segment: { kind: "index", index: frame.index },
			}
			frame.index += 1
			frame.state = "comma-or-end"
			return path
		}
		const key = frame.pendingKey
		if (key === undefined) throw new Error("Missing parsed JSON object key.")
		const path: PathNode = {
			parent: frame.path,
			segment: { kind: "property", key },
		}
		delete frame.pendingKey
		frame.state = "comma-or-end"
		return path
	}

	while (offset < text.length) {
		skipWhitespace()
		if (offset >= text.length) break
		const frame = frames.at(-1)
		if (frame?.kind === "object") {
			if (frame.state === "key-or-end") {
				if (text[offset] === "}") {
					offset += 1
					frames.pop()
					continue
				}
				const key = readString()
				const keyPath: PathNode = {
					parent: frame.path,
					segment: { kind: "property", key },
				}
				if (frame.keys.has(key)) {
					diagnostics.push(
						diagnostic(
							"json.duplicate_key",
							renderPath(keyPath),
							`Duplicate object property ${JSON.stringify(key)} is ambiguous.`,
						),
					)
				}
				frame.keys.add(key)
				if (UNSAFE_KEYS.has(key)) {
					diagnostics.push(
						diagnostic(
							"json.unsafe_key",
							renderPath(keyPath),
							`Object property ${JSON.stringify(key)} is not safe source data.`,
						),
					)
				}
				frame.pendingKey = key
				frame.state = "colon"
				continue
			}
			if (frame.state === "colon") {
				offset += 1
				frame.state = "value"
				continue
			}
			if (frame.state === "comma-or-end") {
				if (text[offset] === "}") {
					offset += 1
					frames.pop()
				} else {
					offset += 1
					frame.state = "key-or-end"
				}
				continue
			}
		} else if (frame?.kind === "array") {
			if (frame.state === "value-or-end" && text[offset] === "]") {
				offset += 1
				frames.pop()
				continue
			}
			if (frame.state === "comma-or-end") {
				if (text[offset] === "]") {
					offset += 1
					frames.pop()
				} else {
					offset += 1
					frame.state = "value-or-end"
				}
				continue
			}
		} else if (rootConsumed) {
			break
		}

		const path = consumeValuePath()
		const character = text[offset]
		if (character === "{") {
			offset += 1
			frames.push({
				kind: "object",
				path,
				keys: new Set(),
				state: "key-or-end",
			})
			continue
		}
		if (character === "[") {
			offset += 1
			frames.push({
				kind: "array",
				path,
				state: "value-or-end",
				index: 0,
			})
			continue
		}
		if (character === '"') {
			readString()
			continue
		}
		while (
			offset < text.length &&
			text[offset] !== " " &&
			text[offset] !== "\t" &&
			text[offset] !== "\n" &&
			text[offset] !== "\r" &&
			text[offset] !== "," &&
			text[offset] !== "]" &&
			text[offset] !== "}"
		) {
			offset += 1
		}
	}
	return diagnostics
}

export type JsonValue =
	| null
	| boolean
	| number
	| string
	| readonly JsonValue[]
	| { readonly [key: string]: JsonValue }

/** Stable key ordering and no insignificant whitespace; arrays retain order. */
export function stringifyCanonicalJson(value: JsonValue): string {
	if (value === null) return "null"
	if (typeof value === "boolean") return value ? "true" : "false"
	if (typeof value === "number") {
		return Object.is(value, -0) ? "-0" : JSON.stringify(value)
	}
	if (typeof value === "string") return JSON.stringify(value)
	if (Array.isArray(value)) {
		return `[${value.map((item) => stringifyCanonicalJson(item)).join(",")}]`
	}
	const record = value as { readonly [key: string]: JsonValue }
	return `{${Object.keys(record)
		.sort()
		.map(
			(key) =>
				`${JSON.stringify(key)}:${stringifyCanonicalJson(record[key] ?? null)}`,
		)
		.join(",")}}`
}
