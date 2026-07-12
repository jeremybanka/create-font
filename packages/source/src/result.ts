import type {
	SourceDiagnostic,
	SourceDiagnosticCode,
	SourceResult,
} from "./types.ts"

/** Freeze decoded values so callers cannot mutate a validation proof in place. */
export function deepFreeze<Value>(value: Value): Value {
	if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
		for (const key of Reflect.ownKeys(value)) {
			deepFreeze(Reflect.get(value, key))
		}
		Object.freeze(value)
	}
	return value
}

export function diagnostic(
	code: SourceDiagnosticCode,
	path: string,
	message: string,
): SourceDiagnostic {
	return { severity: "error", code, path, message }
}

export function success<Value>(value: Value): SourceResult<Value> {
	return deepFreeze({ ok: true, value: deepFreeze(value) })
}

export function failure<Value = never>(
	errors: readonly SourceDiagnostic[],
): SourceResult<Value> {
	const first = errors[0]
	if (first === undefined) {
		throw new Error("A source-format failure requires at least one diagnostic.")
	}
	return deepFreeze({
		ok: false,
		errors: [first, ...errors.slice(1)],
	})
}
