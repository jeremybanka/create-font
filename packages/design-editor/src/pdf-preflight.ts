import {
	runExportPreflight,
	type ExportDiagnostic,
	type ExportPreflightAdapter,
	type ExportPreflightPreferences,
	type ExportPreflightResult,
	type ExportPreflightTargetResolution,
} from "./export-preflight.ts"
import {
	resolvePdfArtboards,
	type PdfExportRequest,
	type PdfExportTarget,
} from "./pdf.ts"
import type { Bounds } from "./geometry.ts"
import type { DesignArtboard, DesignDocument } from "./types.ts"

export const PDF_EXPORT_CAPABILITIES = Object.freeze([
	"artboard.bleed",
	"artboard.clip",
	"paint.cmyk",
	"paint.fill.even-odd",
	"paint.rgb",
	"paint.stroke",
	"vector.ellipse",
	"vector.open-path-fill",
	"vector.open-path-stroke",
	"vector.path",
	"vector.rectangle",
])

function isArtboard(target: PdfExportTarget): target is DesignArtboard {
	return "id" in target
}

function requestFor(target: PdfExportTarget): PdfExportRequest | null {
	if (isArtboard(target)) return null
	return target
}

function scopeError(
	code: string,
	message: string,
	artboardId?: string,
): ExportDiagnostic {
	return Object.freeze({
		...(artboardId === undefined ? {} : { artboardId }),
		capability: "artboard.selection",
		code,
		message,
		severity: "error",
		target: "pdf",
	})
}

function invalidScopeDiagnostics(
	document: DesignDocument,
	target: PdfExportTarget,
): readonly ExportDiagnostic[] {
	const request = requestFor(target)
	if (request === null) return []
	const ids = new Set(document.artboards.map(({ id }) => id))
	const scope = request.scope
	if (scope.kind === "selected") {
		if (scope.artboardIds.length === 0)
			return [
				scopeError(
					"pdf.scope.no-selected-artboards",
					"Select at least one existing artboard for PDF export.",
				),
			]
		const unknown = [...new Set(scope.artboardIds.filter((id) => !ids.has(id)))]
		return unknown.map((id) =>
			scopeError(
				"pdf.scope.unknown-artboard",
				`PDF export selection references unknown artboard ${id}.`,
				id,
			),
		)
	}
	if (scope.kind === "range") {
		const unknown = [
			...new Set(
				[scope.startArtboardId, scope.endArtboardId].filter(
					(id) => !ids.has(id),
				),
			),
		]
		return unknown.map((id) =>
			scopeError(
				"pdf.scope.unknown-artboard",
				`PDF export range references unknown artboard ${id}.`,
				id,
			),
		)
	}
	if (scope.kind === "active" && !ids.has(scope.artboardId))
		return [
			scopeError(
				"pdf.scope.unknown-artboard",
				`PDF export references unknown artboard ${scope.artboardId}.`,
				scope.artboardId,
			),
		]
	return []
}

function regionBounds(artboard: DesignArtboard, includeBleed: boolean): Bounds {
	const bleed = includeBleed ? artboard.bleed : undefined
	return {
		minX: artboard.x - (bleed?.left ?? 0),
		minY: artboard.y - (bleed?.top ?? 0),
		maxX: artboard.x + artboard.width + (bleed?.right ?? 0),
		maxY: artboard.y + artboard.height + (bleed?.bottom ?? 0),
	}
}

function resolvePdfPreflightTarget(
	document: DesignDocument,
	target: PdfExportTarget,
): ExportPreflightTargetResolution {
	const diagnostics = invalidScopeDiagnostics(document, target)
	if (diagnostics.length > 0) return { diagnostics, regions: [] }
	const includeBleed = !isArtboard(target) && target.includeBleed === true
	return {
		regions: resolvePdfArtboards(document, target).map((artboard) =>
			Object.freeze({
				artboard,
				bounds: Object.freeze(regionBounds(artboard, includeBleed)),
			}),
		),
	}
}

export const PDF_PREFLIGHT_ADAPTER: ExportPreflightAdapter<PdfExportTarget> =
	Object.freeze({
		capabilities: PDF_EXPORT_CAPABILITIES,
		resolveTarget: resolvePdfPreflightTarget,
		target: "pdf",
	})

export function preflightPdfExport(
	document: DesignDocument,
	target: PdfExportTarget,
	preferences: ExportPreflightPreferences = {},
): ExportPreflightResult {
	return runExportPreflight(
		document,
		target,
		PDF_PREFLIGHT_ADAPTER,
		preferences,
	)
}
