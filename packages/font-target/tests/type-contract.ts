import {
	createLoweringPlan,
	instantiateGlyph,
	regionScalar,
	type AdvanceWidth,
	type F2Dot14,
	type FUnit,
	type GlyphId,
	type NameId,
	type NormalizedLocation,
	type UserCoordinate,
	type VariableFont,
	type VariationRegion,
} from "../src/index.ts"
import { makeGeometricOFont } from "./fixtures/geometric-o.ts"

declare const glyphId: GlyphId
declare const nameId: NameId
declare const advance: AdvanceWidth
declare const fUnit: FUnit
declare const userCoordinate: UserCoordinate
declare const normalizedCoordinate: F2Dot14
declare const validatedFont: VariableFont
declare const normalizedLocation: NormalizedLocation
declare const variationRegion: VariationRegion

const preservedGlyphId: GlyphId = glyphId
const preservedNameId: NameId = nameId
const preservedAdvance: AdvanceWidth = advance
const preservedFUnit: FUnit = fUnit
const preservedUserCoordinate: UserCoordinate = userCoordinate
const preservedNormalizedCoordinate: F2Dot14 = normalizedCoordinate

// @ts-expect-error Glyph IDs and name IDs are distinct scalar domains.
const nameFromGlyph: NameId = glyphId
// @ts-expect-error Advance widths and signed font units are distinct domains.
const unitFromAdvance: FUnit = advance
// @ts-expect-error User-space and normalized coordinates are distinct domains.
const normalizedFromUser: F2Dot14 = userCoordinate
// @ts-expect-error Unvalidated source values cannot reach lowering APIs.
createLoweringPlan(makeGeometricOFont())

createLoweringPlan(validatedFont)
instantiateGlyph(validatedFont, glyphId, {})
regionScalar(variationRegion, normalizedLocation)

const spreadFont = { ...validatedFont }
// @ts-expect-error Object spread must drop the nominal ingestion proof.
createLoweringPlan(spreadFont)
// @ts-expect-error Name IDs cannot be used as glyph IDs.
instantiateGlyph(validatedFont, nameId, {})
// @ts-expect-error Region evaluation requires quantized normalized coordinates.
regionScalar(variationRegion, [0])

void [
	preservedGlyphId,
	preservedNameId,
	preservedAdvance,
	preservedFUnit,
	preservedUserCoordinate,
	preservedNormalizedCoordinate,
	nameFromGlyph,
	unitFromAdvance,
	normalizedFromUser,
]
