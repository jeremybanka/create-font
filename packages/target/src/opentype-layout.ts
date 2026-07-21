export interface FeatureSubstitution {
	readonly feature: string
	readonly from: readonly number[]
	readonly to: number
}

import type { VariableFont } from "./model.ts"
import { markVariableFontValidated } from "./proof.ts"

/** Returns a validated-font view carrying immutable pre-lowering layout IR. */
export function withVariableFontSubstitutions(
	font: VariableFont,
	substitutions: readonly FeatureSubstitution[],
): VariableFont {
	const value = Object.freeze({
		...font,
		substitutions: Object.freeze(
			substitutions.map((rule) =>
				Object.freeze({ ...rule, from: Object.freeze([...rule.from]) }),
			),
		),
	}) as VariableFont
	markVariableFontValidated(value)
	return value
}

function u16(value: number): readonly number[] {
	return [(value >>> 8) & 0xff, value & 0xff]
}

function tag(value: string): readonly number[] {
	if (!/^[\x20-\x7e]{4}$/u.test(value))
		throw new TypeError(`Feature tag must contain four ASCII bytes: ${value}`)
	return [...value].map((character) => character.charCodeAt(0))
}

function coverage(glyph: number): readonly number[] {
	return [...u16(1), ...u16(1), ...u16(glyph)]
}

function singleSubstitution(rule: FeatureSubstitution): readonly number[] {
	const table = [...u16(2), ...u16(8), ...u16(1), ...u16(rule.to)]
	return [...table, ...coverage(rule.from[0] ?? 0)]
}

function ligatureSubstitution(rule: FeatureSubstitution): readonly number[] {
	const components = rule.from.slice(1)
	const ligature = [
		...u16(rule.to),
		...u16(rule.from.length),
		...components.flatMap(u16),
	]
	const set = [...u16(1), ...u16(4), ...ligature]
	const header = [...u16(1), ...u16(8 + set.length), ...u16(1), ...u16(8)]
	return [...header, ...set, ...coverage(rule.from[0] ?? 0)]
}

function lookup(rule: FeatureSubstitution): readonly number[] {
	const subtable =
		rule.from.length === 1
			? singleSubstitution(rule)
			: ligatureSubstitution(rule)
	return [
		...u16(rule.from.length === 1 ? 1 : 4),
		...u16(0),
		...u16(1),
		...u16(8),
		...subtable,
	]
}

function offsetList(
	items: readonly (readonly number[])[],
	headerSize: number,
): readonly number[] {
	let offset = headerSize + items.length * 2
	const offsets: number[] = []
	for (const item of items) {
		offsets.push(...u16(offset))
		offset += item.length
	}
	return offsets
}

/** Serializes deterministic GSUB 1.0 with DFLT script and single/ligature lookups. */
export function serializeGsub(
	substitutions: readonly FeatureSubstitution[],
): Uint8Array {
	if (substitutions.length === 0)
		throw new TypeError("GSUB requires at least one substitution.")
	for (const rule of substitutions) {
		if (rule.from.length === 0)
			throw new TypeError("A substitution input cannot be empty.")
		for (const glyph of [...rule.from, rule.to])
			if (!Number.isInteger(glyph) || glyph < 0 || glyph > 0xffff)
				throw new RangeError("GSUB glyph IDs must be uint16 values.")
	}
	const lookups = substitutions.map(lookup)
	const lookupList = [
		...u16(lookups.length),
		...offsetList(lookups, 2),
		...lookups.flat(),
	]
	const featureTags = [
		...new Set(substitutions.map(({ feature }) => feature)),
	].toSorted()
	const featureTables = featureTags.map((feature) => {
		const indices = substitutions.flatMap((rule, index) =>
			rule.feature === feature ? [index] : [],
		)
		return [...u16(0), ...u16(indices.length), ...indices.flatMap(u16)]
	})
	let featureOffset = 2 + featureTags.length * 6
	const featureRecords: number[] = []
	for (let index = 0; index < featureTags.length; index += 1) {
		featureRecords.push(
			...tag(featureTags[index] ?? "    "),
			...u16(featureOffset),
		)
		featureOffset += featureTables[index]?.length ?? 0
	}
	const featureList = [
		...u16(featureTags.length),
		...featureRecords,
		...featureTables.flat(),
	]
	const langSys = [
		...u16(0),
		...u16(0xffff),
		...u16(featureTags.length),
		...featureTags.flatMap((_, index) => u16(index)),
	]
	const script = [...u16(4), ...u16(0), ...langSys]
	const scriptList = [...u16(1), ...tag("DFLT"), ...u16(8), ...script]
	const scriptOffset = 10
	const featureListOffset = scriptOffset + scriptList.length
	const lookupListOffset = featureListOffset + featureList.length
	return Uint8Array.from([
		...u16(1),
		...u16(0),
		...u16(scriptOffset),
		...u16(featureListOffset),
		...u16(lookupListOffset),
		...scriptList,
		...featureList,
		...lookupList,
	])
}

/** Applies enabled substitutions left-to-right, preserving source clusters. */
export function applySubstitutions(
	glyphs: readonly {
		readonly glyph: number
		readonly textStart: number
		readonly textEnd: number
	}[],
	substitutions: readonly FeatureSubstitution[],
	enabledFeatures: ReadonlySet<string>,
): readonly {
	readonly glyph: number
	readonly textStart: number
	readonly textEnd: number
}[] {
	const result = glyphs.map((glyph) => ({ ...glyph }))
	for (const rule of substitutions) {
		if (!enabledFeatures.has(rule.feature)) continue
		for (let index = 0; index <= result.length - rule.from.length; index += 1) {
			if (
				!rule.from.every(
					(glyph, offset) => result[index + offset]?.glyph === glyph,
				)
			)
				continue
			const first = result[index]
			const last = result[index + rule.from.length - 1]
			if (first === undefined || last === undefined) continue
			result.splice(index, rule.from.length, {
				glyph: rule.to,
				textStart: first.textStart,
				textEnd: last.textEnd,
			})
		}
	}
	return result
}
