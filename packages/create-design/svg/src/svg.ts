import { contourSvgPath, resolvedRgb } from "@create-design/model"
import type {
	DesignArtboard,
	DesignDocument,
	DesignGroup,
	DesignObject,
	DesignSceneChild,
	DesignSwatch,
} from "@create-design/source"

import type {
	SvgDiagnostic,
	SvgDocumentProjection,
	SvgExportTarget,
	SvgGroupProjection,
	SvgObjectProjection,
	SvgPreflightResult,
	SvgProjectionGraph,
	SvgProjectionNode,
} from "./types.ts"

const number = (value: number): string => Number(value.toFixed(4)).toString()
const escapeXml = (value: string): string =>
	value
		.replaceAll("&", "&amp;")
		.replaceAll('"', "&quot;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")

function resolveArtboard(
	document: DesignDocument,
	target?: SvgExportTarget,
): DesignArtboard {
	if (target !== undefined && "width" in target) return target
	const id = target?.artboardId ?? document.artboards[0]?.id
	const artboard = document.artboards.find((candidate) => candidate.id === id)
	if (artboard === undefined)
		throw new Error(`SVG export references unknown artboard ${id ?? "(none)"}.`)
	return artboard
}

const diagnostic = (
	code: string,
	message: string,
	severity: SvgDiagnostic["severity"],
	entityId?: string,
): SvgDiagnostic =>
	Object.freeze({
		code,
		message,
		severity,
		stage: "preflight",
		...(entityId === undefined ? {} : { entityId }),
	})

export function preflightSvgExport(
	document: DesignDocument,
	target?: SvgExportTarget,
): SvgPreflightResult {
	let artboard: DesignArtboard | null = null
	const diagnostics: SvgDiagnostic[] = []
	try {
		artboard = resolveArtboard(document, target)
	} catch (error) {
		diagnostics.push(
			diagnostic(
				"svg.scope.unknown-artboard",
				error instanceof Error ? error.message : String(error),
				"error",
			),
		)
	}
	for (const object of document.objects) {
		for (const paint of [object.appearance.fill, object.appearance.stroke]) {
			if (paint === undefined) continue
			const swatch = document.swatches.find(({ id }) => id === paint.swatchId)
			if (swatch === undefined) {
				diagnostics.push(
					diagnostic(
						"svg.paint.missing-swatch",
						`${object.name} references missing swatch ${paint.swatchId}.`,
						"error",
						object.id,
					),
				)
			} else if (swatch.source.space === "cmyk") {
				diagnostics.push(
					diagnostic(
						"svg.paint.cmyk-converted",
						`${object.name} uses CMYK paint; SVG output uses its deterministic RGB alternate.`,
						"warning",
						object.id,
					),
				)
			}
		}
	}
	const frozen = Object.freeze(diagnostics)
	const summary = Object.freeze({
		errors: frozen.filter(({ severity }) => severity === "error").length,
		warnings: frozen.filter(({ severity }) => severity === "warning").length,
		infos: frozen.filter(({ severity }) => severity === "info").length,
	})
	return Object.freeze({
		artboard,
		decision: summary.errors > 0 ? "blocked" : "ready",
		diagnostics: frozen,
		summary,
		target: "svg",
	})
}

export function svgPreflightAllowsOutput(result: SvgPreflightResult): boolean {
	return result.decision === "ready"
}

function sceneFor(document: DesignDocument): readonly DesignSceneChild[] {
	return (
		document.scene ??
		document.objects.map(({ id }) => ({ kind: "object" as const, id }))
	)
}

function projectionNodes(
	document: DesignDocument,
): readonly SvgProjectionNode[] {
	const objects = new Map(document.objects.map((object) => [object.id, object]))
	const groups = new Map(
		(document.groups ?? []).map((group) => [group.id, group]),
	)
	const swatches = new Map(
		document.swatches.map((swatch) => [swatch.id, swatch]),
	)
	const activeGroups = new Set<string>()
	const projectChild = (child: DesignSceneChild): SvgProjectionNode | null => {
		if (child.kind === "object") {
			const object = objects.get(child.id)
			if (object === undefined || object.hidden) return null
			const fill =
				object.appearance.fill === undefined
					? undefined
					: swatches.get(object.appearance.fill.swatchId)
			const stroke =
				object.appearance.stroke === undefined
					? undefined
					: swatches.get(object.appearance.stroke.swatchId)
			return Object.freeze({
				kind: "object",
				object,
				swatches: Object.freeze({
					...(fill === undefined ? {} : { fill }),
					...(stroke === undefined ? {} : { stroke }),
				}),
			}) satisfies SvgObjectProjection
		}
		const group = groups.get(child.id)
		if (group === undefined || activeGroups.has(group.id)) return null
		activeGroups.add(group.id)
		const children = group.children
			.map(projectChild)
			.filter((node): node is SvgProjectionNode => node !== null)
		activeGroups.delete(group.id)
		return Object.freeze({
			kind: "group",
			group,
			children: Object.freeze(children),
		}) satisfies SvgGroupProjection
	}
	return Object.freeze(
		sceneFor(document)
			.map(projectChild)
			.filter((node): node is SvgProjectionNode => node !== null),
	)
}

export function createSvgProjectionGraph(): SvgProjectionGraph {
	let previousDocument: DesignDocument | null = null
	let previousArtboard: DesignArtboard | null = null
	let previous: SvgDocumentProjection | null = null
	return {
		project(document, target) {
			const artboard = resolveArtboard(document, target)
			if (
				document === previousDocument &&
				artboard === previousArtboard &&
				previous
			)
				return previous
			const projection = Object.freeze({
				artboard,
				children: projectionNodes(document),
				title: document.title,
			}) satisfies SvgDocumentProjection
			previousDocument = document
			previousArtboard = artboard
			previous = projection
			return projection
		},
	}
}

function rgbHex(swatch: DesignSwatch): string {
	const { r, g, b } = resolvedRgb(swatch)
	return `#${[r, g, b]
		.map((component) => Math.round(component).toString(16).padStart(2, "0"))
		.join("")}`
}

function transform(object: DesignObject): string | undefined {
	const { a, b, c, d, e, f } = object.transform
	return a === 1 && b === 0 && c === 0 && d === 1 && e === 0 && f === 0
		? undefined
		: `matrix(${[a, b, c, d, e, f].map(number).join(" ")})`
}

function objectAttributes(projection: SvgObjectProjection): string {
	const { object, swatches } = projection
	const stroke = object.appearance.stroke
	const attributes: [string, string | undefined][] = [
		["fill", swatches.fill === undefined ? "none" : rgbHex(swatches.fill)],
		[
			"fill-rule",
			object.geometry.kind === "path"
				? (object.geometry.fillRule ?? "evenodd")
				: undefined,
		],
		[
			"stroke",
			swatches.stroke === undefined ? undefined : rgbHex(swatches.stroke),
		],
		["stroke-width", stroke === undefined ? undefined : number(stroke.width)],
		["stroke-linecap", stroke?.cap],
		["stroke-linejoin", stroke?.join],
		[
			"stroke-miterlimit",
			stroke === undefined ? undefined : number(stroke.miterLimit),
		],
		[
			"stroke-dasharray",
			stroke === undefined || stroke.dashArray.length === 0
				? undefined
				: stroke.dashArray.map(number).join(" "),
		],
		[
			"stroke-dashoffset",
			stroke === undefined || stroke.dashOffset === 0
				? undefined
				: number(stroke.dashOffset),
		],
		["transform", transform(object)],
	]
	return attributes
		.filter(
			(attribute): attribute is [string, string] => attribute[1] !== undefined,
		)
		.map(([name, value]) => ` ${name}="${escapeXml(value)}"`)
		.join("")
}

function serializeObject(
	projection: SvgObjectProjection,
	indent: string,
): string {
	const { object } = projection
	const attributes = ` id="${escapeXml(object.id)}"${objectAttributes(projection)}`
	const title = `${indent}  <title>${escapeXml(object.name)}</title>`
	if (object.geometry.kind === "rectangle") {
		const { x, y, width, height } = object.geometry
		return `${indent}<rect${attributes} x="${number(x)}" y="${number(y)}" width="${number(width)}" height="${number(height)}">\n${title}\n${indent}</rect>`
	}
	if (object.geometry.kind === "ellipse") {
		const { centerX, centerY, radiusX, radiusY } = object.geometry
		return `${indent}<ellipse${attributes} cx="${number(centerX)}" cy="${number(centerY)}" rx="${number(radiusX)}" ry="${number(radiusY)}">\n${title}\n${indent}</ellipse>`
	}
	const d = object.geometry.contours
		.map(contourSvgPath)
		.filter(Boolean)
		.join(" ")
	return `${indent}<path${attributes} d="${escapeXml(d)}">\n${title}\n${indent}</path>`
}

function serializeNode(node: SvgProjectionNode, indent: string): string {
	if (node.kind === "object") return serializeObject(node, indent)
	const children = node.children.map((child) =>
		serializeNode(child, `${indent}  `),
	)
	return [
		`${indent}<g id="${escapeXml(node.group.id)}" aria-label="${escapeXml(node.group.name)}">`,
		...children,
		`${indent}</g>`,
	].join("\n")
}

export function serializeSvg(projection: SvgDocumentProjection): string {
	const { artboard } = projection
	const clipId = "create-design-artboard-clip"
	const children = projection.children.map((node) =>
		serializeNode(node, "    "),
	)
	return [
		'<?xml version="1.0" encoding="UTF-8"?>',
		`<svg xmlns="http://www.w3.org/2000/svg" width="${number(artboard.width)}" height="${number(artboard.height)}" viewBox="${[artboard.x, artboard.y, artboard.width, artboard.height].map(number).join(" ")}">`,
		`  <title>${escapeXml(projection.title)}</title>`,
		`  <defs><clipPath id="${clipId}"><rect x="${number(artboard.x)}" y="${number(artboard.y)}" width="${number(artboard.width)}" height="${number(artboard.height)}"/></clipPath></defs>`,
		`  <g clip-path="url(#${clipId})">`,
		...children,
		"  </g>",
		"</svg>",
		"",
	].join("\n")
}

export function exportSvg(
	document: DesignDocument,
	target?: SvgExportTarget,
): Uint8Array {
	return new TextEncoder().encode(
		serializeSvg(createSvgProjectionGraph().project(document, target)),
	)
}
