export * from "./remote.ts"
export * from "./curve-geometry.ts"
export * from "./state.ts"
export * from "./types.ts"
export {
	buildMasterScalarMatrix,
	invertScalarMatrix,
	normalizeAxisCoordinate,
	normalizeEditorLocation,
	quantizeF2Dot14,
	quantizeFixed16Dot16,
	regionScalar,
	solveMasterDeltaVector,
	solveMasterDeltaVectors,
	type AxisIdLocation,
	type MasterScalarMatrix,
	type NormalizedTagLocation,
	type ScalarMatrix,
} from "./variation-model.ts"
