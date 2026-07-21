import {
	createCanonicalEncodingPlan,
	getCanonicalTableTags,
	getNumberOfHMetrics,
	type CanonicalEncodingPlan,
	type TableTag,
} from "./encoding.ts"
import type { GlyphId, SimpleGlyph, VariableFont } from "./model.ts"
import { assertVariableFontValidated } from "./proof.ts"

export { REQUIRED_TABLE_TAGS } from "./encoding.ts"
export type {
	CanonicalEncodingPlan,
	CmapEncodingPlan,
	RequiredTableTag,
	TableLengthPlan,
	TableTag,
} from "./encoding.ts"

const TRUE_TYPE_SFNT_VERSION = 0x0001_0000 as const
const GVAR_PHANTOM_POINT_COUNT = 4 as const

export interface Bounds {
	readonly xMin: number
	readonly yMin: number
	readonly xMax: number
	readonly yMax: number
}

export interface GlyphLoweringPlan {
	readonly glyphId: GlyphId
	readonly contourCount: number
	readonly pointCount: number
	/** Number of outline and phantom points addressable by each gvar tuple. */
	readonly gvarTargetPointCount: number
	readonly bounds: Bounds
}

export interface HheaLoweringPlan {
	readonly advanceWidthMax: number
	readonly minLeftSideBearing: number
	readonly minRightSideBearing: number
	readonly xMaxExtent: number
	/** Minimal legal long-metric prefix in hmtx. */
	readonly numberOfHMetrics: number
}

export interface MaxpLoweringPlan {
	readonly version: typeof TRUE_TYPE_SFNT_VERSION
	readonly numGlyphs: number
	readonly maxPoints: number
	readonly maxContours: number
	readonly maxCompositePoints: 0
	readonly maxCompositeContours: 0
	readonly maxZones: 1
	readonly maxTwilightPoints: 0
	readonly maxStorage: 0
	readonly maxFunctionDefs: 0
	readonly maxInstructionDefs: 0
	readonly maxStackElements: 0
	readonly maxSizeOfInstructions: 0
	readonly maxComponentElements: 0
	readonly maxComponentDepth: 0
}

export interface LoweringPlan {
	readonly sfntVersion: typeof TRUE_TYPE_SFNT_VERSION
	readonly tableTags: readonly TableTag[]
	readonly glyphCount: number
	readonly glyphs: readonly GlyphLoweringPlan[]
	readonly encoding: CanonicalEncodingPlan
	readonly head: Bounds
	readonly hhea: HheaLoweringPlan
	readonly maxp: MaxpLoweringPlan
}

const EMPTY_BOUNDS: Bounds = Object.freeze({
	xMin: 0,
	yMin: 0,
	xMax: 0,
	yMax: 0,
})

function freezeBounds(
	xMin: number,
	yMin: number,
	xMax: number,
	yMax: number,
): Bounds {
	return Object.freeze({ xMin, yMin, xMax, yMax })
}

function deepFreeze<Value>(value: Value): Value {
	if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
		return value
	}
	for (const child of Object.values(value)) {
		deepFreeze(child)
	}
	return Object.freeze(value)
}

/** Returns the number of real outline points in a simple glyph. */
export function getGlyphPointCount(glyph: SimpleGlyph): number {
	let pointCount = 0
	for (const contour of glyph.contours) pointCount += contour.length
	return pointCount
}

/** Returns the default-instance glyf bounding box, or zeroes for an empty glyph. */
export function getGlyphBounds(glyph: SimpleGlyph): Bounds {
	let xMin = Number.POSITIVE_INFINITY
	let yMin = Number.POSITIVE_INFINITY
	let xMax = Number.NEGATIVE_INFINITY
	let yMax = Number.NEGATIVE_INFINITY

	for (const contour of glyph.contours) {
		for (const point of contour) {
			xMin = Math.min(xMin, point.x)
			yMin = Math.min(yMin, point.y)
			xMax = Math.max(xMax, point.x)
			yMax = Math.max(yMax, point.y)
		}
	}

	return xMin === Number.POSITIVE_INFINITY
		? EMPTY_BOUNDS
		: freezeBounds(xMin, yMin, xMax, yMax)
}

/**
 * Returns the default-instance head bounding box. Empty glyphs do not widen
 * the box; an entirely empty font uses the required all-zero box.
 */
export function getFontBounds(font: VariableFont): Bounds {
	assertVariableFontValidated(font)
	let xMin = Number.POSITIVE_INFINITY
	let yMin = Number.POSITIVE_INFINITY
	let xMax = Number.NEGATIVE_INFINITY
	let yMax = Number.NEGATIVE_INFINITY

	for (const glyph of font.glyphs) {
		if (getGlyphPointCount(glyph) === 0) continue
		const bounds = getGlyphBounds(glyph)
		xMin = Math.min(xMin, bounds.xMin)
		yMin = Math.min(yMin, bounds.yMin)
		xMax = Math.max(xMax, bounds.xMax)
		yMax = Math.max(yMax, bounds.yMax)
	}

	return xMin === Number.POSITIVE_INFINITY
		? EMPTY_BOUNDS
		: freezeBounds(xMin, yMin, xMax, yMax)
}

/** Returns the complete, directory-sorted set of tables for a font. */
export function getTableTags(font: VariableFont): readonly TableTag[] {
	assertVariableFontValidated(font)
	return getCanonicalTableTags(font.axes, font.kerning)
}

function createHheaPlan(
	font: VariableFont,
	glyphs: readonly GlyphLoweringPlan[],
): HheaLoweringPlan {
	let advanceWidthMax = 0
	let minLeftSideBearing = 0
	let minRightSideBearing = 0
	let xMaxExtent = 0
	let hasContourGlyph = false

	for (let index = 0; index < font.glyphs.length; index += 1) {
		const glyph = font.glyphs[index]
		const glyphPlan = glyphs[index]
		if (glyph === undefined || glyphPlan === undefined) continue
		advanceWidthMax = Math.max(advanceWidthMax, glyph.advanceWidth)
		if (glyphPlan.pointCount === 0) continue
		const width = glyphPlan.bounds.xMax - glyphPlan.bounds.xMin
		const rightSideBearing = glyph.advanceWidth - glyph.leftSideBearing - width
		const extent = glyph.leftSideBearing + width
		if (!hasContourGlyph) {
			minLeftSideBearing = glyph.leftSideBearing
			minRightSideBearing = rightSideBearing
			xMaxExtent = extent
			hasContourGlyph = true
		} else {
			minLeftSideBearing = Math.min(minLeftSideBearing, glyph.leftSideBearing)
			minRightSideBearing = Math.min(minRightSideBearing, rightSideBearing)
			xMaxExtent = Math.max(xMaxExtent, extent)
		}
	}

	return {
		advanceWidthMax,
		minLeftSideBearing,
		minRightSideBearing,
		xMaxExtent,
		numberOfHMetrics: getNumberOfHMetrics(font.glyphs),
	}
}

function createMaxpPlan(
	glyphs: readonly GlyphLoweringPlan[],
): MaxpLoweringPlan {
	let maxPoints = 0
	let maxContours = 0
	for (const glyph of glyphs) {
		maxPoints = Math.max(maxPoints, glyph.pointCount)
		maxContours = Math.max(maxContours, glyph.contourCount)
	}

	return {
		version: TRUE_TYPE_SFNT_VERSION,
		numGlyphs: glyphs.length,
		maxPoints,
		maxContours,
		maxCompositePoints: 0,
		maxCompositeContours: 0,
		maxZones: 1,
		maxTwilightPoints: 0,
		maxStorage: 0,
		maxFunctionDefs: 0,
		maxInstructionDefs: 0,
		maxStackElements: 0,
		maxSizeOfInstructions: 0,
		maxComponentElements: 0,
		maxComponentDepth: 0,
	}
}

/**
 * Derives the logical sfnt values that are not stated directly by the IR.
 * The returned graph is deterministic and deeply frozen.
 */
export function createLoweringPlan(font: VariableFont): LoweringPlan {
	assertVariableFontValidated(font)
	const encoding = createCanonicalEncodingPlan(font)
	const glyphs = font.glyphs.map((glyph, glyphId): GlyphLoweringPlan => {
		const pointCount = getGlyphPointCount(glyph)
		return {
			glyphId: glyphId as GlyphId,
			contourCount: glyph.contours.length,
			pointCount,
			gvarTargetPointCount: pointCount + GVAR_PHANTOM_POINT_COUNT,
			bounds: getGlyphBounds(glyph),
		}
	})

	return deepFreeze({
		sfntVersion: TRUE_TYPE_SFNT_VERSION,
		tableTags: getTableTags(font),
		glyphCount: glyphs.length,
		glyphs,
		encoding,
		head: getFontBounds(font),
		hhea: createHheaPlan(font, glyphs),
		maxp: createMaxpPlan(glyphs),
	})
}
