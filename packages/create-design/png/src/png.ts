import { preflightSvgExport } from "@create-design/svg"
import {
	designOutputLayerForEntity,
	projectDesignOutput,
} from "@create-design/model"
import type { DesignArtboard, DesignDocument } from "@create-design/source"
import { designHexColorChannels } from "@create-design/source"

import { referencePngRasterBackend } from "./raster.ts"
import type {
	PngArtifact,
	PngBackground,
	PngDiagnostic,
	PngExportRequest,
	PngExportResult,
	PngPreflightResult,
	PngRasterBackend,
} from "./types.ts"

export const TRANSPARENT_PNG_BACKGROUND: PngBackground = Object.freeze({
	kind: "transparent",
})
export const MAX_PNG_PIXELS = 100_000_000

function projectedPngDocument(document: DesignDocument): Readonly<{
	diagnostics: readonly PngDiagnostic[]
	document: DesignDocument
}> {
	const projection = projectDesignOutput(document)
	return {
		diagnostics: projection.diagnostics.map((source) => {
			const layer = designOutputLayerForEntity(projection, source.blendId)
			return Object.freeze({
				code: `png.${source.code}`,
				entityId: source.blendId,
				message: source.message,
				severity: source.severity,
				...(layer === null ? {} : { layerId: layer.id, layerName: layer.name }),
			})
		}),
		document: {
			...document,
			objects: projection.objects,
			swatches: projection.swatches,
		},
	}
}

function diagnostic(
	code: string,
	message: string,
	severity: PngDiagnostic["severity"],
	artboardId?: string,
): PngDiagnostic {
	return Object.freeze({
		code,
		message,
		severity,
		...(artboardId === undefined ? {} : { artboardId }),
	})
}

export function resolvePngArtboards(
	document: DesignDocument,
	request: PngExportRequest,
): readonly DesignArtboard[] {
	const find = (id: string): DesignArtboard => {
		const artboard = document.artboards.find((candidate) => candidate.id === id)
		if (artboard === undefined)
			throw new Error(`PNG export references unknown artboard ${id}.`)
		return artboard
	}
	const { scope } = request
	if (scope.kind === "all") return document.artboards
	if (scope.kind === "active") return [find(scope.artboardId)]
	if (scope.kind === "selected") {
		const selected = new Set(scope.artboardIds)
		for (const id of selected) find(id)
		return document.artboards.filter(({ id }) => selected.has(id))
	}
	const start = document.artboards.findIndex(
		({ id }) => id === scope.startArtboardId,
	)
	const end = document.artboards.findIndex(
		({ id }) => id === scope.endArtboardId,
	)
	if (start < 0) find(scope.startArtboardId)
	if (end < 0) find(scope.endArtboardId)
	return document.artboards.slice(
		Math.min(start, end),
		Math.max(start, end) + 1,
	)
}

function validBackground(background: PngBackground): boolean {
	if (background.kind === "transparent") return true
	return [background.r, background.g, background.b, background.a ?? 255].every(
		(value) => Number.isFinite(value) && value >= 0 && value <= 255,
	)
}

export function pngDimensions(
	artboard: DesignArtboard,
	scale = 1,
): Readonly<{ width: number; height: number }> {
	return {
		width: Math.max(1, Math.round(artboard.width * scale)),
		height: Math.max(1, Math.round(artboard.height * scale)),
	}
}

export function preflightPngExport(
	document: DesignDocument,
	request: PngExportRequest,
): PngPreflightResult {
	const diagnostics: PngDiagnostic[] = []
	const projection = projectedPngDocument(document)
	diagnostics.push(...projection.diagnostics)
	const scale = request.scale ?? 1
	if (!Number.isFinite(scale) || scale <= 0)
		diagnostics.push(
			diagnostic(
				"png.scale.invalid",
				"PNG scale must be a positive finite number.",
				"error",
			),
		)
	if (!validBackground(request.background ?? TRANSPARENT_PNG_BACKGROUND))
		diagnostics.push(
			diagnostic(
				"png.background.invalid",
				"PNG background channels must be between 0 and 255.",
				"error",
			),
		)
	let artboards: readonly DesignArtboard[] = []
	try {
		artboards = resolvePngArtboards(document, request)
	} catch (error) {
		diagnostics.push(
			diagnostic(
				"png.scope.unknown-artboard",
				error instanceof Error ? error.message : String(error),
				"error",
			),
		)
	}
	if (artboards.length === 0)
		diagnostics.push(
			diagnostic(
				"png.scope.empty",
				"PNG export requires at least one artboard.",
				"error",
			),
		)
	if (Number.isFinite(scale) && scale > 0)
		for (const artboard of artboards) {
			const { width, height } = pngDimensions(artboard, scale)
			if (
				!Number.isSafeInteger(width) ||
				!Number.isSafeInteger(height) ||
				width * height > MAX_PNG_PIXELS
			)
				diagnostics.push(
					diagnostic(
						"png.dimensions.too-large",
						`${artboard.name} resolves to ${width} × ${height}; PNG exports are limited to ${MAX_PNG_PIXELS.toLocaleString("en-US")} pixels.`,
						"error",
						artboard.id,
					),
				)
			const svg = preflightSvgExport(document, artboard)
			for (const source of svg.diagnostics) {
				if (source.code.startsWith("svg.blend.")) continue
				diagnostics.push(
					Object.freeze({
						code: source.code.replace(/^svg\./u, "png."),
						message: source.message.replace("SVG output", "PNG output"),
						severity: source.severity,
						artboardId: artboard.id,
						...(source.entityId === undefined
							? {}
							: { entityId: source.entityId }),
						...(source.layerId === undefined
							? {}
							: {
									layerId: source.layerId,
									layerName: source.layerName,
								}),
					}),
				)
			}
		}
	const frozen = Object.freeze(diagnostics)
	const summary = Object.freeze({
		errors: frozen.filter(({ severity }) => severity === "error").length,
		warnings: frozen.filter(({ severity }) => severity === "warning").length,
		infos: frozen.filter(({ severity }) => severity === "info").length,
	})
	return Object.freeze({
		artboards: Object.freeze([...artboards]),
		decision: summary.errors === 0 ? "ready" : "blocked",
		diagnostics: frozen,
		summary,
		target: "png",
	})
}

function slug(value: string): string {
	return (
		value
			.trim()
			.toLowerCase()
			.replaceAll(/[^a-z0-9]+/gu, "-")
			.replaceAll(/^-|-$/gu, "") || "untitled"
	)
}

export function pngArtifactFilename(
	document: DesignDocument,
	artboard: DesignArtboard,
	index: number,
	total: number,
): string {
	const title = slug(document.title)
	return total === 1
		? `${title}.png`
		: `${title}-${String(index + 1).padStart(2, "0")}-${slug(artboard.name)}.png`
}

export interface ExportPngOptions {
	readonly backend?: PngRasterBackend
	readonly signal?: AbortSignal
	readonly yieldControl?: () => Promise<void>
}

const defaultYield = (): Promise<void> =>
	new Promise((resolve) => setTimeout(resolve, 0))

/** Uses one headless path in browsers, workers, Node, Bun, and Deno. */
export async function exportPng(
	document: DesignDocument,
	request: PngExportRequest,
	options: ExportPngOptions = {},
): Promise<PngExportResult> {
	const preflight = preflightPngExport(document, request)
	if (preflight.decision === "blocked")
		throw new Error("PNG export was blocked by preflight errors.")
	const backend = options.backend ?? referencePngRasterBackend
	const scale = request.scale ?? 1
	const backgroundFor = (artboard: DesignArtboard): PngBackground =>
		request.background ??
		(artboard.backgroundColor === undefined
			? TRANSPARENT_PNG_BACKGROUND
			: { kind: "color", ...designHexColorChannels(artboard.backgroundColor) })
	const samples = request.samples ?? 4
	const artifacts: PngArtifact[] = []
	for (const [index, artboard] of preflight.artboards.entries()) {
		const dimensions = pngDimensions(artboard, scale)
		const bytes = await backend.rasterize(
			{ artboard, background: backgroundFor(artboard), ...dimensions, samples },
			{
				document,
				signal: options.signal,
				yieldControl: options.yieldControl ?? defaultYield,
			},
		)
		artifacts.push(
			Object.freeze({
				artboard,
				bytes,
				filename: pngArtifactFilename(
					document,
					artboard,
					index,
					preflight.artboards.length,
				),
				...dimensions,
			}),
		)
	}
	return Object.freeze({ artifacts: Object.freeze(artifacts), preflight })
}
