import type { SourceUnitSnapshot } from "@create-font/server"

import type { SourceSyncState } from "./source-sync.ts"

export type SourceValuePatch = Readonly<
	| {
			path: readonly (number | string)[]
			remove: true
	  }
	| {
			path: readonly (number | string)[]
			value: unknown
	  }
>

export type SourceSyncStatePatch = Readonly<{
	removedPaths: readonly string[]
	revision: string
	units: readonly SourceUnitSnapshot[]
}>

export function sourceValuePatches(
	before: unknown,
	after: unknown,
): readonly SourceValuePatch[] {
	const patches: SourceValuePatch[] = []
	const path: (number | string)[] = []
	const visit = (previous: unknown, next: unknown): void => {
		if (Object.is(previous, next)) return
		if (Array.isArray(previous) && Array.isArray(next)) {
			if (previous.length !== next.length) {
				patches.push({ path: [...path], value: next })
				return
			}
			for (let index = 0; index < next.length; index += 1) {
				path.push(index)
				visit(previous[index], next[index])
				path.pop()
			}
			return
		}
		if (
			typeof previous === `object` &&
			previous !== null &&
			!Array.isArray(previous) &&
			typeof next === `object` &&
			next !== null &&
			!Array.isArray(next)
		) {
			const previousRecord = previous as Readonly<Record<string, unknown>>
			const nextRecord = next as Readonly<Record<string, unknown>>
			const keys = new Set([
				...Object.keys(previousRecord),
				...Object.keys(nextRecord),
			])
			for (const key of keys) {
				path.push(key)
				if (key in nextRecord) visit(previousRecord[key], nextRecord[key])
				else patches.push({ path: [...path], remove: true })
				path.pop()
			}
			return
		}
		patches.push({ path: [...path], value: next })
	}
	visit(before, after)
	return patches
}

function applySourceValuePatch(
	value: unknown,
	patch: SourceValuePatch,
	depth = 0,
): unknown {
	if (depth === patch.path.length) {
		if (`remove` in patch) return undefined
		return patch.value
	}
	const key = patch.path[depth]
	if (key === undefined)
		throw new TypeError(`A source patch path cannot contain undefined.`)
	if (Array.isArray(value)) {
		if (typeof key !== `number`)
			throw new TypeError(`An array source patch key must be numeric.`)
		const next = [...value]
		const child = applySourceValuePatch(next[key], patch, depth + 1)
		if (depth + 1 === patch.path.length && `remove` in patch) {
			next.splice(key, 1)
		} else {
			next[key] = child
		}
		return next
	}
	if (typeof value !== `object` || value === null || typeof key !== `string`) {
		throw new TypeError(`A source patch path does not match its target.`)
	}
	const next = { ...value } as Record<string, unknown>
	const child = applySourceValuePatch(next[key], patch, depth + 1)
	if (depth + 1 === patch.path.length && `remove` in patch) delete next[key]
	else next[key] = child
	return next
}

export function applySourceValuePatches<Value>(
	value: Value,
	patches: readonly SourceValuePatch[],
): Value {
	let next: unknown = value
	for (const patch of patches) next = applySourceValuePatch(next, patch)
	return next as Value
}

export function sourceSyncStatePatch(
	before: SourceSyncState,
	after: SourceSyncState,
): SourceSyncStatePatch {
	return {
		removedPaths: [...before.units.keys()].filter(
			(path) => !after.units.has(path),
		),
		revision: after.revision,
		units: [...after.units].flatMap(([path, unit]) =>
			before.units.get(path) === unit ? [] : [unit],
		),
	}
}

export function applySourceSyncStatePatch(
	state: SourceSyncState,
	patch: SourceSyncStatePatch,
): SourceSyncState {
	const units = new Map(state.units)
	for (const path of patch.removedPaths) units.delete(path)
	for (const unit of patch.units) units.set(unit.path, unit)
	return {
		revision: patch.revision,
		units,
	}
}
