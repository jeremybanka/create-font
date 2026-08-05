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
import {
	designOutputLayerForEntity,
	projectDesignOutput,
	type Bounds,
} from "@create-design/model"
import type { DesignArtboard, DesignDocument } from "@create-design/source"
import type { DesignTextService } from "@create-design/text"

export const PDF_EXPORT_CAPABILITIES = Object.freeze([
	"artboard.bleed",
	"artboard.clip",
	"paint.cmyk",
	"paint.fill.even-odd",
	"paint.rgb",
	"paint.stroke",
	"text.outline-lowering",
	"vector.ellipse",
	"vector.live-blend",
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
	textService?: DesignTextService,
): ExportPreflightResult {
	const output = projectDesignOutput(document)
	const result = runExportPreflight(
		{
			...document,
			objects: output.objects,
			swatches: output.swatches,
		},
		target,
		Object.freeze({
			...PDF_PREFLIGHT_ADAPTER,
			inspectObject({ object }) {
				if (object.hidden || object.geometry.kind !== "text") return []
				const action = Object.freeze({
					kind: "select-entity" as const,
					entityKind: "object",
					entityId: object.id,
				})
				if (textService === undefined)
					return [
						Object.freeze({
							action,
							capability: "text.outline-lowering",
							code: "pdf.text-service-missing",
							entityId: object.id,
							entityKind: "object",
							message: `${object.name} needs its source font loaded before PDF export.`,
							severity: "error" as const,
							target: "pdf",
						}),
					]
				const layout = textService.layout(object)
				if (layout === null) return []
				const seen = new Set<string>()
				return layout.diagnostics.flatMap((diagnostic) => {
					if (seen.has(diagnostic.code)) return []
					seen.add(diagnostic.code)
					const blocking =
						diagnostic.severity === "error" ||
						diagnostic.code === "glyph.missing" ||
						diagnostic.code === "font.unsupported-table"
					return [
						Object.freeze({
							action,
							capability: "text.outline-lowering",
							code: `pdf.${diagnostic.code}`,
							entityId: object.id,
							entityKind: "object",
							message: diagnostic.message,
							severity: blocking ? ("error" as const) : ("warning" as const),
							target: "pdf",
						}),
					]
				})
			},
		}) satisfies ExportPreflightAdapter<PdfExportTarget>,
		preferences,
	)
	const blendDiagnostics = output.diagnostics.map((item) =>
		Object.freeze({
			action: Object.freeze({
				kind: "select-entity" as const,
				entityKind: "blend",
				entityId: item.blendId,
			}),
			capability: "vector.live-blend",
			code: `pdf.${item.code}`,
			entityId: item.blendId,
			entityKind: "blend",
			message: item.message,
			severity: item.severity,
			target: "pdf",
		}),
	)
	const diagnostics = Object.freeze(
		[...result.diagnostics, ...blendDiagnostics].map((diagnostic) => {
			const layer =
				diagnostic.entityId === undefined
					? null
					: designOutputLayerForEntity(output, diagnostic.entityId)
			return layer === null
				? diagnostic
				: Object.freeze({
						...diagnostic,
						layerId: layer.id,
						layerName: layer.name,
					})
		}),
	)
	const summary = Object.freeze({
		errors: diagnostics.filter(({ severity }) => severity === "error").length,
		warnings: diagnostics.filter(({ severity }) => severity === "warning")
			.length,
		infos: diagnostics.filter(({ severity }) => severity === "info").length,
	})
	return Object.freeze({
		...result,
		decision: summary.errors > 0 ? "blocked" : "ready",
		diagnostics,
		summary,
	})
}
