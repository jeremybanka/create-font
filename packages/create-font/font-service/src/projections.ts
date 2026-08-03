import type {
	FontResult,
	FontService,
	ShapeTextRequest,
	TextProjection,
} from "./types.ts"

/** Browser canvases consume canonical positioned runs, never DOM measurement. */
export function projectTextForBrowser(
	service: FontService,
	request: ShapeTextRequest,
): FontResult<TextProjection> {
	return service.shape(request)
}

/** Non-interactive PDF/export code consumes the same immutable run contract. */
export function projectTextForExport(
	service: FontService,
	request: ShapeTextRequest,
): FontResult<TextProjection> {
	return service.shape(request)
}
