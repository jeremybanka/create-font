import type { Bounds } from "@create-design/model"
import { visibleObjectBounds } from "@create-design/model"
import type {
	DesignArtboard,
	DesignDocument,
	DesignObject,
} from "@create-design/source"

export type ExportDiagnosticSeverity = "error" | "warning" | "info"

export type ExportDiagnosticAction =
	| Readonly<{
			kind: "select-entity"
			entityKind: string
			entityId: string
	  }>
	| Readonly<{ kind: "activate-artboard"; artboardId: string }>

export interface ExportDiagnostic {
	readonly action?: ExportDiagnosticAction
	readonly artboardId?: string
	readonly capability: string
	readonly code: string
	readonly entityId?: string
	readonly entityKind?: string
	readonly message: string
	readonly layerId?: string
	readonly layerName?: string
	readonly severity: ExportDiagnosticSeverity
	readonly target: string
}

export interface ExportPreflightRegion {
	readonly artboard: DesignArtboard
	readonly bounds: Bounds
}

export interface ExportPreflightTargetResolution {
	readonly diagnostics?: readonly ExportDiagnostic[]
	readonly regions: readonly ExportPreflightRegion[]
}

export interface ExportPreflightObjectContext<Options> {
	readonly document: DesignDocument
	readonly object: DesignObject
	readonly options: Options
	readonly regions: readonly ExportPreflightRegion[]
}

export interface ExportPreflightAdapter<Options> {
	/** Capabilities the exporter preserves with normal authored semantics. */
	readonly capabilities: readonly string[]
	/** Capabilities the exporter can represent only by approximation. */
	readonly approximatedCapabilities?: readonly string[]
	readonly inspectObject?: (
		context: ExportPreflightObjectContext<Options>,
	) => readonly ExportDiagnostic[]
	readonly resolveTarget: (
		document: DesignDocument,
		options: Options,
	) => ExportPreflightTargetResolution
	readonly target: string
}

export interface ExportPreflightSummary {
	readonly errors: number
	readonly infos: number
	readonly warnings: number
}

export interface ExportPreflightResult {
	readonly capabilities: readonly string[]
	readonly decision: "blocked" | "ready"
	readonly diagnostics: readonly ExportDiagnostic[]
	readonly regions: readonly ExportPreflightRegion[]
	readonly summary: ExportPreflightSummary
	readonly target: string
}

export const ARTWORK_OUTSIDE_ARTBOARDS_LINT =
	"common.artwork-outside-requested-artboards"

export interface ExportPreflightPreferences {
	/** Advisory checks are opt-in and never affect whether output is allowed. */
	readonly enabledLints?: readonly string[]
}

const VECTOR_CAPABILITIES = Object.freeze({
	"artboard-link": "workspace.artboard-link",
	ellipse: "vector.ellipse",
	image: "image.placement",
	openPathFill: "vector.open-path-fill",
	openPathStroke: "vector.open-path-stroke",
	path: "vector.path",
	rectangle: "vector.rectangle",
	text: "text.outline-lowering",
})

const EPSILON = 1e-7

function diagnostic(
	input: Omit<ExportDiagnostic, "target">,
	target: string,
): ExportDiagnostic {
	return Object.freeze({ ...input, target })
}

function objectCapabilityDiagnostic(
	target: string,
	object: DesignObject,
	code: string,
	capability: string,
	message: string,
	severity: ExportDiagnosticSeverity,
): ExportDiagnostic {
	return diagnostic(
		{
			action: Object.freeze({
				kind: "select-entity",
				entityKind: "object",
				entityId: object.id,
			}),
			capability,
			code,
			entityId: object.id,
			entityKind: "object",
			message,
			severity,
		},
		target,
	)
}

function unsupportedObjectDiagnostics(
	target: string,
	capabilities: ReadonlySet<string>,
	approximatedCapabilities: ReadonlySet<string>,
	document: DesignDocument,
	object: DesignObject,
): readonly ExportDiagnostic[] {
	if (object.hidden || visibleObjectBounds(object) === null) return []
	const diagnostics: ExportDiagnostic[] = []
	const capabilityDiagnostic = (
		capability: string,
		code: string,
		unsupportedMessage: string,
		approximatedMessage: string,
	): ExportDiagnostic | null => {
		if (capabilities.has(capability)) return null
		const approximated = approximatedCapabilities.has(capability)
		return objectCapabilityDiagnostic(
			target,
			object,
			`${target}.${approximated ? "approximated" : "unsupported"}-${code}`,
			capability,
			approximated ? approximatedMessage : unsupportedMessage,
			approximated ? "warning" : "error",
		)
	}
	const geometryCapability = VECTOR_CAPABILITIES[object.geometry.kind]
	const geometryDiagnostic = capabilityDiagnostic(
		geometryCapability,
		object.geometry.kind,
		object.geometry.kind === "artboard-link"
			? `${object.name} references ${object.geometry.projectId}/${object.geometry.artboardId}, which is unavailable. Restore the workspace design before export.`
			: `${object.name} uses ${object.geometry.kind} geometry that ${target.toUpperCase()} cannot export.`,
		`${object.name} uses ${object.geometry.kind} geometry that ${target.toUpperCase()} approximates.`,
	)
	if (geometryDiagnostic !== null) diagnostics.push(geometryDiagnostic)
	const paintCapabilities = [
		["fill", object.appearance.fill, "paint.fill.even-odd"],
		["stroke", object.appearance.stroke, "paint.stroke"],
	] as const
	const checkedColorCapabilities = new Set<string>()
	for (const [kind, paint, capability] of paintCapabilities) {
		if (paint === undefined || (kind === "stroke" && paint.width === 0))
			continue
		const paintDiagnostic = capabilityDiagnostic(
			capability,
			kind,
			`${object.name} has a ${kind} that ${target.toUpperCase()} cannot export.`,
			`${object.name} has a ${kind} that ${target.toUpperCase()} approximates.`,
		)
		if (paintDiagnostic !== null) diagnostics.push(paintDiagnostic)
		const swatch = document.swatches.find(({ id }) => id === paint.swatchId)
		if (swatch === undefined) continue
		const colorCapability = `paint.${swatch.source.space}`
		if (!checkedColorCapabilities.has(colorCapability)) {
			const colorDiagnostic = capabilityDiagnostic(
				colorCapability,
				`${swatch.source.space}-paint`,
				`${object.name} uses ${swatch.source.space.toUpperCase()} paint that ${target.toUpperCase()} cannot export.`,
				`${object.name} uses ${swatch.source.space.toUpperCase()} paint that ${target.toUpperCase()} approximates.`,
			)
			if (colorDiagnostic !== null) diagnostics.push(colorDiagnostic)
		}
		checkedColorCapabilities.add(colorCapability)
	}
	if (object.geometry.kind !== "path") return diagnostics
	const hasOpenContour = object.geometry.contours.some(
		(contour) => !contour.closed && contour.points.length > 0,
	)
	if (!hasOpenContour) return diagnostics
	if (
		object.appearance.fill !== undefined &&
		!capabilities.has(VECTOR_CAPABILITIES.openPathFill)
	)
		diagnostics.push(
			capabilityDiagnostic(
				VECTOR_CAPABILITIES.openPathFill,
				"open-path-fill",
				`${object.name} has a fill on an open path that ${target.toUpperCase()} cannot export.`,
				`${object.name} has a fill on an open path that ${target.toUpperCase()} approximates.`,
			)!,
		)
	if (
		object.appearance.stroke !== undefined &&
		object.appearance.stroke.width > 0 &&
		!capabilities.has(VECTOR_CAPABILITIES.openPathStroke)
	)
		diagnostics.push(
			capabilityDiagnostic(
				VECTOR_CAPABILITIES.openPathStroke,
				"open-path-stroke",
				`${object.name} has an open stroke that ${target.toUpperCase()} cannot export.`,
				`${object.name} has an open stroke that ${target.toUpperCase()} approximates.`,
			)!,
		)
	return diagnostics
}

function clippedBounds(region: Bounds, bounds: Bounds): Bounds | null {
	const clipped = {
		minX: Math.max(region.minX, bounds.minX),
		minY: Math.max(region.minY, bounds.minY),
		maxX: Math.min(region.maxX, bounds.maxX),
		maxY: Math.min(region.maxY, bounds.maxY),
	}
	return clipped.minX <= clipped.maxX && clipped.minY <= clipped.maxY
		? clipped
		: null
}

function intervalsCover(
	start: number,
	end: number,
	intervals: readonly (readonly [number, number])[],
): boolean {
	let coveredTo = start
	for (const [from, to] of intervals.toSorted(
		(left, right) => left[0] - right[0],
	)) {
		if (to < coveredTo - EPSILON) continue
		if (from > coveredTo + EPSILON) return false
		coveredTo = Math.max(coveredTo, to)
		if (coveredTo >= end - EPSILON) return true
	}
	return coveredTo >= end - EPSILON
}

/** True when the complete painted bounds are covered by the union of regions. */
export function exportRegionsCoverBounds(
	bounds: Bounds,
	regions: readonly ExportPreflightRegion[],
): boolean {
	const clipped = regions
		.map(({ bounds: region }) => clippedBounds(region, bounds))
		.filter((region): region is Bounds => region !== null)
	if (clipped.length === 0) return false
	const xBreaks = [
		bounds.minX,
		...clipped.flatMap(({ minX, maxX }) => [minX, maxX]),
		bounds.maxX,
	]
		.filter((value) => value >= bounds.minX && value <= bounds.maxX)
		.toSorted((left, right) => left - right)
	const uniqueX = xBreaks.filter(
		(value, index) =>
			index === 0 || Math.abs(value - xBreaks[index - 1]!) > EPSILON,
	)
	if (uniqueX.length === 1) uniqueX.push(uniqueX[0]!)
	for (let index = 0; index < uniqueX.length - 1; index += 1) {
		const fromX = uniqueX[index]!
		const toX = uniqueX[index + 1]!
		const sampleX = (fromX + toX) / 2
		const yIntervals = clipped
			.filter(
				(region) =>
					region.minX <= sampleX + EPSILON && region.maxX >= sampleX - EPSILON,
			)
			.map(({ minY, maxY }) => [minY, maxY] as const)
		if (!intervalsCover(bounds.minY, bounds.maxY, yIntervals)) return false
	}
	return true
}

function outsideRegionsDiagnostic(
	target: string,
	object: DesignObject,
	bounds: Bounds,
	regions: readonly ExportPreflightRegion[],
): ExportDiagnostic {
	const base = objectCapabilityDiagnostic(
		target,
		object,
		"common.artwork-outside-requested-artboards",
		"artboard.clip",
		`${object.name} extends outside the requested artboards and will be clipped.`,
		"info",
	)
	const intersecting = regions.filter(
		({ bounds: region }) =>
			region.minX < bounds.maxX - EPSILON &&
			region.maxX > bounds.minX + EPSILON &&
			region.minY < bounds.maxY - EPSILON &&
			region.maxY > bounds.minY + EPSILON,
	)
	return intersecting.length === 1
		? Object.freeze({ ...base, artboardId: intersecting[0]!.artboard.id })
		: base
}

function freezeResult(
	target: string,
	capabilities: readonly string[],
	regions: readonly ExportPreflightRegion[],
	diagnostics: readonly ExportDiagnostic[],
): ExportPreflightResult {
	const frozenDiagnostics = Object.freeze(
		diagnostics.map((item) =>
			Object.freeze({
				...item,
				...(item.action === undefined
					? {}
					: { action: Object.freeze({ ...item.action }) }),
			}),
		),
	)
	const frozenRegions = Object.freeze(
		regions.map((region) =>
			Object.freeze({
				...region,
				bounds: Object.freeze({ ...region.bounds }),
			}),
		),
	)
	const summary = Object.freeze({
		errors: frozenDiagnostics.filter(({ severity }) => severity === "error")
			.length,
		warnings: frozenDiagnostics.filter(({ severity }) => severity === "warning")
			.length,
		infos: frozenDiagnostics.filter(({ severity }) => severity === "info")
			.length,
	})
	return Object.freeze({
		capabilities: Object.freeze([...capabilities]),
		decision: summary.errors > 0 ? "blocked" : "ready",
		diagnostics: frozenDiagnostics,
		regions: frozenRegions,
		summary,
		target,
	})
}

export function runExportPreflight<Options>(
	document: DesignDocument,
	options: Options,
	adapter: ExportPreflightAdapter<Options>,
	preferences: ExportPreflightPreferences = {},
): ExportPreflightResult {
	const resolution = adapter.resolveTarget(document, options)
	const diagnostics = [...(resolution.diagnostics ?? [])]
	const capabilities = new Set(adapter.capabilities)
	const approximatedCapabilities = new Set(
		adapter.approximatedCapabilities ?? [],
	)
	const enabledLints = new Set(preferences.enabledLints ?? [])
	if (diagnostics.every(({ severity }) => severity !== "error")) {
		for (const object of document.objects) {
			diagnostics.push(
				...unsupportedObjectDiagnostics(
					adapter.target,
					capabilities,
					approximatedCapabilities,
					document,
					object,
				),
			)
			const bounds = object.hidden ? null : visibleObjectBounds(object)
			if (
				enabledLints.has(ARTWORK_OUTSIDE_ARTBOARDS_LINT) &&
				bounds !== null &&
				!exportRegionsCoverBounds(bounds, resolution.regions)
			)
				diagnostics.push(
					outsideRegionsDiagnostic(
						adapter.target,
						object,
						bounds,
						resolution.regions,
					),
				)
			diagnostics.push(
				...(adapter.inspectObject?.({
					document,
					object,
					options,
					regions: resolution.regions,
				}) ?? []),
			)
		}
	}
	return freezeResult(
		adapter.target,
		adapter.capabilities,
		resolution.regions,
		diagnostics,
	)
}

export function exportPreflightAllowsOutput(
	result: ExportPreflightResult,
): boolean {
	return result.decision === "ready"
}
