import type { CharacterMapEntry } from "./model.ts"

const MAX_BMP_CODE_POINT = 0xffff

interface Format4Atom {
	readonly start: number
	readonly end: number
	readonly delta: number
}

interface Format4State {
	readonly bytes: number
	readonly glyphWords: number
	readonly segments: number
}

interface GlyphRangeCandidate {
	readonly prefix: Format4State
	readonly start: number
	readonly term: number
}

export type CmapEncodingPlan =
	| {
			readonly format: 4
			readonly platformId: 3
			readonly encodingId: 1
			readonly segmentCount: number
			readonly glyphIdArrayLength: number
			readonly subtableLength: number
			readonly tableLength: number
	  }
	| {
			readonly format: 12
			readonly platformId: 3
			readonly encodingId: 10
			readonly groupCount: number
			readonly subtableLength: number
			readonly tableLength: number
	  }

function betterState(left: Format4State, right: Format4State): Format4State {
	if (left.bytes !== right.bytes) return left.bytes < right.bytes ? left : right
	if (left.segments !== right.segments) {
		return left.segments < right.segments ? left : right
	}
	return left.glyphWords <= right.glyphWords ? left : right
}

function buildFormat4Atoms(
	entries: readonly CharacterMapEntry[],
): readonly Format4Atom[] {
	const atoms: Format4Atom[] = []
	for (const entry of entries) {
		const codePoint = Number(entry.codePoint)
		if (codePoint >= MAX_BMP_CODE_POINT) continue
		const delta = (Number(entry.glyph) - codePoint) & 0xffff
		const previous = atoms[atoms.length - 1]
		if (
			previous !== undefined &&
			codePoint === previous.end + 1 &&
			delta === previous.delta
		) {
			atoms[atoms.length - 1] = { ...previous, end: codePoint }
		} else {
			atoms.push({ start: codePoint, end: codePoint, delta })
		}
	}
	return atoms
}

function betterCandidate(
	left: GlyphRangeCandidate,
	right: GlyphRangeCandidate,
): GlyphRangeCandidate {
	if (left.term !== right.term) return left.term < right.term ? left : right
	if (left.prefix.segments !== right.prefix.segments) {
		return left.prefix.segments < right.prefix.segments ? left : right
	}
	return left.prefix.glyphWords <= right.prefix.glyphWords ? left : right
}

function planFormat4(entries: readonly CharacterMapEntry[]): CmapEncodingPlan {
	const atoms = buildFormat4Atoms(entries)
	let state: Format4State = { bytes: 0, glyphWords: 0, segments: 0 }
	let bestGlyphRange: GlyphRangeCandidate | undefined

	for (const atom of atoms) {
		const candidate = {
			prefix: state,
			start: atom.start,
			term: state.bytes - 2 * atom.start,
		}
		bestGlyphRange =
			bestGlyphRange === undefined
				? candidate
				: betterCandidate(bestGlyphRange, candidate)

		const deltaState: Format4State = {
			bytes: state.bytes + 8,
			glyphWords: state.glyphWords,
			segments: state.segments + 1,
		}
		const span = atom.end - bestGlyphRange.start + 1
		const glyphRangeState: Format4State = {
			bytes: bestGlyphRange.prefix.bytes + 8 + 2 * span,
			glyphWords: bestGlyphRange.prefix.glyphWords + span,
			segments: bestGlyphRange.prefix.segments + 1,
		}
		state = betterState(deltaState, glyphRangeState)
	}

	// The required terminal U+FFFF segment maps to glyph zero and is not a
	// source mapping, so it never needs a glyph-array word.
	const segmentCount = state.segments + 1
	const subtableLength = 16 + state.bytes + 8
	return {
		format: 4,
		platformId: 3,
		encodingId: 1,
		segmentCount,
		glyphIdArrayLength: state.glyphWords,
		subtableLength,
		tableLength: 12 + subtableLength,
	}
}

function planFormat12(entries: readonly CharacterMapEntry[]): CmapEncodingPlan {
	let groupCount = 0
	let previous: CharacterMapEntry | undefined
	for (const entry of entries) {
		if (
			previous === undefined ||
			entry.codePoint !== previous.codePoint + 1 ||
			entry.glyph !== previous.glyph + 1
		) {
			groupCount += 1
		}
		previous = entry
	}
	const subtableLength = 16 + 12 * groupCount
	return {
		format: 12,
		platformId: 3,
		encodingId: 10,
		groupCount,
		subtableLength,
		tableLength: 12 + subtableLength,
	}
}

/** Derives the canonical Windows Unicode cmap encoding used by v1. */
export function createCmapEncodingPlan(
	entries: readonly CharacterMapEntry[],
): CmapEncodingPlan {
	return entries.some((entry) => entry.codePoint >= MAX_BMP_CODE_POINT)
		? planFormat12(entries)
		: planFormat4(entries)
}
