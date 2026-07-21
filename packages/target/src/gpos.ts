import type { KerningPair } from "./model.ts"

/** Canonical GPOS 1.0 PairPos-format-1 table length for explicit glyph pairs. */
export function getGposLength(pairs: readonly KerningPair[]): number {
	const leftCount = new Set(pairs.map((pair) => Number(pair.left))).size
	// Header + ScriptList + FeatureList + LookupList/Lookup + PairPos/Coverage/pairs.
	return 70 + 6 * leftCount + pairs.length * 4
}
