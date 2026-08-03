import type {
	EditorEntityId,
	ProjectionError,
	ProjectionResult,
	ProjectionWarning,
} from "./types.ts"

/** Deeply freezes inert data so cached selector values cannot be changed out of band. */
export function deepFreeze<Value>(value: Value): Value {
	if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
		for (const key of Reflect.ownKeys(value)) {
			deepFreeze(Reflect.get(value, key))
		}
		Object.freeze(value)
	}
	return value
}

export function projectionError(
	code: string,
	path: string,
	message: string,
	entityId?: EditorEntityId,
): ProjectionError {
	return entityId === undefined
		? { severity: "error", code, path, message }
		: { severity: "error", code, path, message, entityId }
}

export function projectionWarning(
	code: string,
	path: string,
	message: string,
	entityId?: EditorEntityId,
): ProjectionWarning {
	return entityId === undefined
		? { severity: "warning", code, path, message }
		: { severity: "warning", code, path, message, entityId }
}

export function projectionSuccess<Value>(
	value: Value,
	warnings: readonly ProjectionWarning[] = [],
): ProjectionResult<Value> {
	return deepFreeze({
		ok: true,
		value: deepFreeze(value),
		warnings: [...warnings],
	})
}

export function projectionFailure<Value = never>(
	errors: readonly ProjectionError[],
	warnings: readonly ProjectionWarning[] = [],
): ProjectionResult<Value> {
	const first = errors[0]
	if (first === undefined) {
		throw new Error("A failed projection requires at least one error.")
	}
	return deepFreeze({
		ok: false,
		errors: [first, ...errors.slice(1)],
		warnings: [...warnings],
	})
}

export function collectProjectionResults<Value>(
	results: readonly ProjectionResult<Value>[],
): ProjectionResult<readonly Value[]> {
	const values: Value[] = []
	const errors: ProjectionError[] = []
	const warnings: ProjectionWarning[] = []
	for (const result of results) {
		warnings.push(...result.warnings)
		if (result.ok) values.push(result.value)
		else errors.push(...result.errors)
	}
	return errors.length === 0
		? projectionSuccess(values, warnings)
		: projectionFailure(errors, warnings)
}

export function duplicateValueErrors<Value extends string | number>(
	values: readonly Value[],
	path: string,
	code = "index.duplicate",
): readonly ProjectionError[] {
	const seen = new Set<Value>()
	const errors: ProjectionError[] = []
	for (let index = 0; index < values.length; index += 1) {
		const value = values[index]
		if (value === undefined) continue
		if (seen.has(value)) {
			errors.push(
				projectionError(
					code,
					`${path}[${index}]`,
					`Duplicate indexed value ${JSON.stringify(value)}.`,
				),
			)
		}
		seen.add(value)
	}
	return errors
}

export function projectRoundedInteger(
	value: number | null,
	minimum: number,
	maximum: number,
	path: string,
	entityId?: EditorEntityId,
): ProjectionResult<number> {
	if (value === null || !Number.isFinite(value)) {
		return projectionFailure([
			projectionError(
				"number.missing_or_nonfinite",
				path,
				"Expected a finite numeric editor value.",
				entityId,
			),
		])
	}
	const rounded = Math.floor(value + 0.5)
	if (rounded < minimum || rounded > maximum) {
		return projectionFailure([
			projectionError(
				"number.range",
				path,
				`Rounded value ${rounded} must be within [${minimum}, ${maximum}].`,
				entityId,
			),
		])
	}
	const warnings =
		rounded === value
			? []
			: [
					projectionWarning(
						"number.rounded",
						path,
						`Editor value ${value} was rounded to ${rounded} for TrueType output.`,
						entityId,
					),
				]
	return projectionSuccess(rounded, warnings)
}
