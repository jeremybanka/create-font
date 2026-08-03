import type {
	DesignSourceDiagnostic,
	DesignSourceDiagnosticCode,
	DesignSourceResult,
} from "./types.ts"

export function deepFreeze<Value>(value: Value): Value {
	if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
		for (const key of Reflect.ownKeys(value))
			deepFreeze(Reflect.get(value, key))
		Object.freeze(value)
	}
	return value
}

export function diagnostic(
	code: DesignSourceDiagnosticCode,
	path: string,
	message: string,
	unitPath?: string,
): DesignSourceDiagnostic {
	return {
		severity: "error",
		code,
		path,
		message,
		...(unitPath === undefined ? {} : { unitPath }),
	}
}

export function success<Value>(value: Value): DesignSourceResult<Value> {
	return deepFreeze({ ok: true, value: deepFreeze(value) })
}

export function failure<Value = never>(
	errors: readonly DesignSourceDiagnostic[],
): DesignSourceResult<Value> {
	const first = errors[0]
	if (first === undefined)
		throw new Error("A design-source failure requires one diagnostic.")
	return deepFreeze({
		ok: false,
		errors: [first, ...errors.slice(1)],
	})
}
