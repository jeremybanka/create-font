import { validateDesignDocument } from "@create-design/source"
import type {
	ColorDefinition,
	DesignDocument,
	DesignGroup,
	DesignLayer,
	DesignObject,
	DesignSceneChild,
	DesignSwatch,
} from "@create-design/source"

import type {
	IllustratorSourceDocument,
	IllustratorSourceColor,
	IllustratorSourceGroup,
	IllustratorSourceNode,
	IllustratorSourcePath,
	IllustratorSourceText,
} from "./illustrator-source-types.ts"
import type {
	IllustratorImportDiagnostic,
	IllustratorImportOptions,
	IllustratorImportResult,
} from "./types.ts"

const identity = Object.freeze({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 })

/** Lowers one Illustrator canvas AST into one shared create-design hierarchy. */
export function lowerIllustratorSource(
	source: IllustratorSourceDocument,
	options: IllustratorImportOptions = {},
): IllustratorImportResult {
	const diagnostics: IllustratorImportDiagnostic[] = source.diagnostics.map(
		({ code, message, severity, span }) => ({
			code,
			message,
			severity,
			stage: "content",
			...(span === undefined ? {} : { sourceSpan: span }),
		}),
	)
	if (diagnostics.some(({ severity }) => severity === "error"))
		return {
			ok: false,
			document: null,
			diagnostics,
			summary: { artboards: 0, objects: 0, swatches: 0 },
		}
	const swatches: DesignSwatch[] = []
	const swatchIds = new Map<string, string>()
	const objects: DesignObject[] = []
	const groups: DesignGroup[] = []
	let objectSequence = 0
	let groupSequence = 0
	let warnedTextStyle = false
	let warnedTextStructure = false
	const externalFonts = new Set<string>()
	const nativeColor = (
		color: IllustratorSourceColor,
	): Readonly<{ source: ColorDefinition; alternate?: ColorDefinition }> => {
		if (color.space === "gray")
			return {
				source: {
					space: "rgb",
					r: color.value * 255,
					g: color.value * 255,
					b: color.value * 255,
				},
			}
		if (color.space === "rgb") {
			const encodedTint = Math.min(1, Math.max(0, color.tint ?? 0))
			const coverage = 1 - encodedTint
			return {
				source: {
					space: "rgb",
					r: (color.r * coverage + encodedTint) * 255,
					g: (color.g * coverage + encodedTint) * 255,
					b: (color.b * coverage + encodedTint) * 255,
				},
				...(color.alternate === undefined
					? {}
					: {
							alternate: {
								space: "cmyk" as const,
								c: color.alternate.c * 100,
								m: color.alternate.m * 100,
								y: color.alternate.y * 100,
								k: color.alternate.k * 100,
							},
						}),
			}
		}
		const encodedTint = Math.min(
			1,
			Math.max(0, color.tint ?? color.alternateGray ?? 0),
		)
		const coverage = 1 - encodedTint
		return {
			source: {
				space: "cmyk",
				c: color.c * coverage * 100,
				m: color.m * coverage * 100,
				y: color.y * coverage * 100,
				k: color.k * coverage * 100,
			},
		}
	}
	const swatchFor = (color: IllustratorSourceColor): string => {
		const key = JSON.stringify(color)
		const found = swatchIds.get(key)
		if (found !== undefined) return found
		const id = `swatch:ai-${swatches.length + 1}`
		const lowered = nativeColor(color)
		const name =
			"name" in color && color.name !== undefined
				? color.name
				: `AI ${color.space.toUpperCase()} ${swatches.length + 1}`
		swatches.push({ id, name, ...lowered })
		swatchIds.set(key, id)
		return id
	}
	const lowerPath = (
		path: IllustratorSourcePath,
		name = path.name ?? "Path",
	): DesignSceneChild => {
		const id = `object:ai-${++objectSequence}`
		objects.push({
			id,
			name,
			geometry: {
				kind: "path",
				fillRule: path.fillRule,
				contours: path.contours.map((contour, contourIndex) => ({
					id: `${id}:contour-${contourIndex + 1}`,
					closed: contour.closed,
					points: contour.points.map((point, pointIndex) => ({
						id: `${id}:point-${contourIndex + 1}-${pointIndex + 1}`,
						x: point.x,
						y: -point.y,
						mode: point.mode,
						...(point.incoming === undefined
							? {}
							: { incoming: { x: point.incoming.x, y: -point.incoming.y } }),
						...(point.outgoing === undefined
							? {}
							: { outgoing: { x: point.outgoing.x, y: -point.outgoing.y } }),
					})),
				})),
			},
			transform: identity,
			appearance: {
				...(path.fill === undefined
					? {}
					: { fill: { swatchId: swatchFor(path.fill) } }),
				...(path.stroke === undefined
					? {}
					: {
							stroke: {
								swatchId: swatchFor(path.stroke.color),
								width: path.stroke.width,
								cap: path.stroke.cap,
								join: path.stroke.join,
								miterLimit: path.stroke.miterLimit,
								dashArray: path.stroke.dashArray,
								dashOffset: path.stroke.dashOffset,
							},
						}),
			},
			...(path.locked ? { locked: true } : {}),
		})
		return { kind: "object", id }
	}
	const lowerText = (
		text: IllustratorSourceText,
	): DesignSceneChild | undefined => {
		const story = text.story
		if (
			story === undefined ||
			story.position === undefined ||
			story.size === undefined
		) {
			diagnostics.push({
				code: "ai.import.unsupported-text-frame",
				message: `Illustrator text story ${text.storyIndex} lacks recoverable text, position, or typography and remains available in the source AST only.`,
				severity: "warning",
				stage: "content",
			})
			return undefined
		}
		if (!warnedTextStyle) {
			warnedTextStyle = true
			diagnostics.push({
				code: "ai.import.partial-text-style",
				message:
					"Live Illustrator text content, position, size, and font were preserved; unsupported run paint, leading, tracking, and paragraph details remain in the source AST.",
				severity: "warning",
				stage: "content",
			})
		}
		if (!warnedTextStructure) {
			warnedTextStructure = true
			diagnostics.push({
				code: "ai.import.unsupported-text-structure",
				message:
					"Illustrator frame kind, bounds, threading, and transform are not yet positively identified, so live text was projected as point-like text; the complete frame resource remains in the source AST.",
				severity: "warning",
				stage: "content",
				sourceSpan: text.span,
			})
		}
		const fontName =
			source.resources.text?.fonts.find(
				({ selector }) => selector === (story.fontSelector ?? 0),
			)?.postScriptName ?? `Unknown Illustrator font ${story.fontSelector ?? 0}`
		externalFonts.add(fontName)
		const id = `object:ai-${++objectSequence}`
		objects.push({
			id,
			name: story.text.replace(/[\r\n]+$/u, "") || `Text ${text.storyIndex}`,
			geometry: {
				kind: "text",
				mode: "point",
				text: story.text.replace(/\r$/u, ""),
				x: story.position.x,
				y: -story.position.y,
				typography: {
					font: {
						id: `font:ai-${story.fontSelector ?? 0}`,
						family: fontName,
					},
					size: story.size,
					leading: story.size,
					tracking: 0,
					kerning: "auto",
					alignment: "start",
					direction: "auto",
				},
			},
			transform: identity,
			appearance: {
				...(text.fill === undefined
					? {}
					: { fill: { swatchId: swatchFor(text.fill) } }),
				...(text.stroke === undefined
					? {}
					: {
							stroke: {
								swatchId: swatchFor(text.stroke.color),
								width: text.stroke.width,
								cap: text.stroke.cap,
								join: text.stroke.join,
								miterLimit: text.stroke.miterLimit,
								dashArray: text.stroke.dashArray,
								dashOffset: text.stroke.dashOffset,
							},
						}),
			},
		})
		return { kind: "object", id }
	}
	const lowerGroup = (group: IllustratorSourceGroup): DesignSceneChild => {
		const compoundPaths = group.children.filter(
			(node): node is IllustratorSourcePath => node.kind === "path",
		)
		if (
			group.groupKind === "compound" &&
			group.clippingPath === undefined &&
			compoundPaths.length > 0 &&
			group.children.every(({ kind }) => kind === "path" || kind === "unknown")
		) {
			const paths = compoundPaths
			const first = paths[0]!
			const appearance = (path: IllustratorSourcePath): string =>
				JSON.stringify({
					fill: path.fill,
					stroke: path.stroke,
					fillRule: path.fillRule,
					locked: path.locked,
				})
			if (paths.every((path) => appearance(path) === appearance(first)))
				return lowerPath(
					{
						...first,
						contours: paths.flatMap(({ contours }) => contours),
					},
					group.name ?? "Compound path",
				)
			diagnostics.push({
				code: "ai.import.mixed-compound-appearance",
				message:
					"A compound path contains incompatible appearances and was preserved as a structural group.",
				severity: "warning",
				stage: "content",
			})
		}
		const id = `group:ai-${++groupSequence}`
		const children: DesignSceneChild[] = []
		let clippingPathId: string | undefined
		if (group.clippingPath !== undefined) {
			const clip = lowerPath(group.clippingPath, "Clipping path")
			children.push(clip)
			clippingPathId = clip.id
		}
		for (const node of group.children) {
			const child = lowerNode(node)
			if (child !== undefined) children.push(child)
		}
		groups.push({
			id,
			name:
				group.name ??
				(group.groupKind === "clip"
					? "Clipping group"
					: group.groupKind === "compound"
						? "Compound path"
						: "Group"),
			children,
			...(clippingPathId === undefined ? {} : { clippingPathId }),
		})
		return { kind: "group", id }
	}
	const lowerNode = (
		node: IllustratorSourceNode,
	): DesignSceneChild | undefined => {
		if (node.kind === "path") return lowerPath(node)
		if (node.kind === "group") return lowerGroup(node)
		if (node.kind === "text") return lowerText(node)
		return undefined
	}
	const layers: DesignLayer[] = source.layers.map((layer, index) => ({
		id: `layer:ai-${index + 1}`,
		name: layer.name,
		children: layer.children
			.map(lowerNode)
			.filter((child): child is DesignSceneChild => child !== undefined),
		uiColor: (
			[
				"red",
				"blue",
				"yellow",
				"purple",
				"green",
				"pink",
				"cyan",
				"orange",
			] as const
		)[index % 8],
		...(layer.hidden ? { hidden: true } : {}),
		...(layer.locked ? { locked: true } : {}),
	}))
	const document: DesignDocument = {
		format: "create-design.document",
		version: 6,
		title:
			options.title ?? source.metadata.title ?? "Imported Illustrator document",
		artboards: source.artboards.map((artboard, index) => ({
			id: `artboard:ai-${index + 1}`,
			name: artboard.name,
			x: artboard.left,
			y: -artboard.top,
			width: artboard.right - artboard.left,
			height: artboard.top - artboard.bottom,
			...(artboard.bleed === undefined ? {} : { bleed: artboard.bleed }),
		})),
		swatches,
		objects,
		layers,
		groups,
		guides: [],
	}
	if (externalFonts.size > 0)
		diagnostics.push({
			code: "ai.import.external-font-required",
			message: `Imported live text references external fonts that must be added to fonts/index.json before build or export: ${[...externalFonts].sort().join(", ")}.`,
			severity: "warning",
			stage: "content",
		})
	const validated = validateDesignDocument(document)
	if (!validated.ok) {
		diagnostics.push({
			code: "ai.import.invalid-native-document",
			message: `Illustrator source could not be lowered into a valid create-design document: ${validated.errors.map(({ message }) => message).join(" ")}`,
			severity: "error",
			stage: "content",
		})
		return {
			ok: false,
			document: null,
			diagnostics,
			summary: { artboards: 0, objects: 0, swatches: 0 },
		}
	}
	return {
		ok: true,
		document: validated.value,
		diagnostics,
		summary: {
			artboards: source.artboards.length,
			objects: objects.length,
			swatches: swatches.length,
		},
	}
}
