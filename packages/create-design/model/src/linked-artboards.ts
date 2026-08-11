import type {
	DesignDocument,
	DesignFontResource,
	DesignGeometry,
	DesignGroup,
	DesignImageResource,
	DesignLinkedArtboardResource,
	DesignObject,
	DesignSceneChild,
	DesignSwatch,
	DesignTransform,
} from "@create-design/source"
import { designHexColorChannels } from "@create-design/source"

import { projectDesignOutput, type DesignOutputEntry } from "./output.ts"
import { visibleObjectBounds } from "./painted-geometry.ts"

export type DesignArtboardLinkDiagnostic = Readonly<{
	code:
		| "artboard-link.missing-project"
		| "artboard-link.missing-artboard"
		| "artboard-link.cycle"
	message: string
	objectId: string
}>

export type DesignArtboardLinkResolution = Readonly<{
	document: DesignDocument
	diagnostics: readonly DesignArtboardLinkDiagnostic[]
	/** Namespaced runtime assets referenced by materialized linked objects. */
	imageResources: readonly DesignImageResource[]
	/** Namespaced runtime fonts referenced by materialized live text. */
	fontResources: readonly DesignFontResource[]
	/** Maps every projected child back to the authored, atomic link that owns it. */
	linkObjectIdByProjectedId: ReadonlyMap<string, string>
}>

type MutableGroup = {
	id: string
	name: string
	children: DesignSceneChild[]
	clippingPathId?: string
}

type ExpandedDocument = Readonly<{
	document: DesignDocument
	images: readonly DesignImageResource[]
	fonts: readonly DesignFontResource[]
}>

function intersects(
	bounds: ReturnType<typeof visibleObjectBounds>,
	artboard: DesignDocument["artboards"][number],
): boolean {
	return (
		bounds !== null &&
		bounds.maxX >= artboard.x &&
		bounds.minX <= artboard.x + artboard.width &&
		bounds.maxY >= artboard.y &&
		bounds.minY <= artboard.y + artboard.height
	)
}

function composeTransform(
	parent: DesignTransform,
	child: DesignTransform,
): DesignTransform {
	return {
		a: parent.a * child.a + parent.c * child.b,
		b: parent.b * child.a + parent.d * child.b,
		c: parent.a * child.c + parent.c * child.d,
		d: parent.b * child.c + parent.d * child.d,
		e: parent.a * child.e + parent.c * child.f + parent.e,
		f: parent.b * child.e + parent.d * child.f + parent.f,
	}
}

/**
 * Bakes a scalar into local geometry so length-valued paint can carry the same
 * scale while the projected object's affine transform is divided by it.
 */
function scaleGeometry(
	geometry: DesignGeometry,
	scale: number,
): DesignGeometry {
	if (geometry.kind === "path")
		return {
			...geometry,
			contours: geometry.contours.map((contour) => ({
				...contour,
				points: contour.points.map((point) => ({
					...point,
					x: point.x * scale,
					y: point.y * scale,
					...(point.incoming === undefined
						? {}
						: {
								incoming: {
									x: point.incoming.x * scale,
									y: point.incoming.y * scale,
								},
							}),
					...(point.outgoing === undefined
						? {}
						: {
								outgoing: {
									x: point.outgoing.x * scale,
									y: point.outgoing.y * scale,
								},
							}),
					...(point.corner === undefined
						? {}
						: {
								corner: {
									...point.corner,
									amount: point.corner.amount * scale,
								},
							}),
				})),
			})),
		}
	if (geometry.kind === "text")
		return {
			...geometry,
			x: geometry.x * scale,
			y: geometry.y * scale,
			typography: {
				...geometry.typography,
				size: geometry.typography.size * scale,
				leading: geometry.typography.leading * scale,
			},
			...(geometry.frame === undefined
				? {}
				: {
						frame: {
							...geometry.frame,
							width: geometry.frame.width * scale,
							height: geometry.frame.height * scale,
							inset: {
								top: geometry.frame.inset.top * scale,
								right: geometry.frame.inset.right * scale,
								bottom: geometry.frame.inset.bottom * scale,
								left: geometry.frame.inset.left * scale,
							},
						},
					}),
		}
	if (geometry.kind === "image")
		return {
			...geometry,
			intrinsicWidth: geometry.intrinsicWidth * scale,
			intrinsicHeight: geometry.intrinsicHeight * scale,
		}
	if (geometry.kind === "artboard-link")
		return {
			...geometry,
			width: geometry.width * scale,
			height: geometry.height * scale,
		}
	if (geometry.kind === "rectangle")
		return {
			...geometry,
			x: geometry.x * scale,
			y: geometry.y * scale,
			width: geometry.width * scale,
			height: geometry.height * scale,
		}
	return {
		...geometry,
		centerX: geometry.centerX * scale,
		centerY: geometry.centerY * scale,
		radiusX: geometry.radiusX * scale,
		radiusY: geometry.radiusY * scale,
	}
}

function transformEffectScale(transform: DesignTransform): number {
	return Math.sqrt(
		Math.abs(transform.a * transform.d - transform.b * transform.c),
	)
}

function namespace(scope: string, id: string): string {
	return `${scope}:${encodeURIComponent(id)}`
}

function replaceObjectChild(
	children: readonly DesignSceneChild[],
	objectId: string,
	groupId: string,
): readonly DesignSceneChild[] {
	return children.map((child) =>
		child.kind === "object" && child.id === objectId
			? { kind: "group" as const, id: groupId }
			: child,
	)
}

/**
 * Materializes links only at the shared render/export boundary. Each link is
 * replaced by an isolated hierarchy group whose children retain their own
 * paint, live text/image geometry, masks, and projected blend output. The
 * authored document continues to contain one portable reference object.
 */
export function resolveDesignArtboardLinks(
	document: DesignDocument,
	resources: readonly DesignLinkedArtboardResource[],
): DesignArtboardLinkResolution {
	const byProject = new Map(
		resources.map((resource) => [resource.projectId, resource]),
	)
	const diagnostics: DesignArtboardLinkDiagnostic[] = []
	const linkObjectIdByProjectedId = new Map<string, string>()

	const expand = (
		input: DesignDocument,
		stack: readonly string[],
		baseImages: readonly DesignImageResource[] = [],
		baseFonts: readonly DesignFontResource[] = [],
	): ExpandedDocument => {
		let current = input
		let images = [...baseImages]
		let fonts = [...baseFonts]
		for (const link of input.objects) {
			const linkGeometry = link.geometry
			if (linkGeometry.kind !== "artboard-link") continue
			const key = `${linkGeometry.projectId}/${linkGeometry.artboardId}`
			if (stack.includes(key)) {
				diagnostics.push({
					code: "artboard-link.cycle",
					message: `Linked artboard cycle detected at ${key}.`,
					objectId: link.id,
				})
				continue
			}
			const resource = byProject.get(linkGeometry.projectId)
			if (resource === undefined) {
				diagnostics.push({
					code: "artboard-link.missing-project",
					message: `Linked design ${linkGeometry.projectId} is unavailable.`,
					objectId: link.id,
				})
				continue
			}
			const artboard = resource.document.artboards.find(
				({ id }) => id === linkGeometry.artboardId,
			)
			if (artboard === undefined) {
				diagnostics.push({
					code: "artboard-link.missing-artboard",
					message: `Linked artboard ${linkGeometry.artboardId} no longer exists in ${linkGeometry.projectId}.`,
					objectId: link.id,
				})
				continue
			}

			const source = expand(
				resource.document,
				[...stack, key],
				resource.images,
				resource.fonts,
			)
			const output = projectDesignOutput(source.document)
			const entries = output.entries.filter(({ object }) =>
				intersects(visibleObjectBounds(object), artboard),
			)
			const scope = `linked:${encodeURIComponent(link.id)}:${encodeURIComponent(key)}`
			const rootGroupId = namespace(scope, "group:root")
			const swatchIds = new Map(
				output.swatches.map(({ id }) => [id, namespace(scope, id)]),
			)
			const imageIds = new Map<string, string>()
			const fontIds = new Map<string, string>()
			const sourceImages = new Map(
				source.images.map((resource) => [resource.id, resource]),
			)
			const sourceFonts = new Map(
				source.fonts.map((resource) => [resource.reference.id, resource]),
			)
			const linkedImages: DesignImageResource[] = []
			const linkedFonts: DesignFontResource[] = []
			const projectedObjects = new Map<string, DesignObject>()
			const placement = composeTransform(link.transform, {
				a: 1,
				b: 0,
				c: 0,
				d: 1,
				e: -artboard.x,
				f: -artboard.y,
			})
			const effectScale = transformEffectScale(link.transform)
			const linkState = {
				...(link.hidden === true ? { hidden: true } : {}),
				...(link.locked === true ? { locked: true } : {}),
			}
			const projectObject = (object: DesignObject): DesignObject => {
				const previous = projectedObjects.get(object.id)
				if (previous !== undefined) return previous
				const id = namespace(scope, object.id)
				let geometry = object.geometry
				if (geometry.kind === "image") {
					const sourceId = geometry.source.id
					const imageId = imageIds.get(sourceId) ?? namespace(scope, sourceId)
					imageIds.set(sourceId, imageId)
					geometry = {
						...geometry,
						source: { ...geometry.source, id: imageId },
					}
					const image = sourceImages.get(sourceId)
					if (
						image !== undefined &&
						!linkedImages.some((candidate) => candidate.id === imageId)
					)
						linkedImages.push({ ...image, id: imageId })
				} else if (geometry.kind === "text") {
					const sourceId = geometry.typography.font.id
					const fontId = fontIds.get(sourceId) ?? namespace(scope, sourceId)
					fontIds.set(sourceId, fontId)
					geometry = {
						...geometry,
						typography: {
							...geometry.typography,
							font: { ...geometry.typography.font, id: fontId },
						},
					}
					const font = sourceFonts.get(sourceId)
					if (
						font !== undefined &&
						!linkedFonts.some((candidate) => candidate.reference.id === fontId)
					)
						linkedFonts.push({
							...font,
							reference: { ...font.reference, id: fontId },
						})
				}
				const composedTransform = composeTransform(placement, object.transform)
				const stroke = object.appearance.stroke
				const normalizeScaledEffects =
					stroke !== undefined && effectScale > Number.EPSILON
				const projected: DesignObject = {
					...object,
					id,
					geometry: normalizeScaledEffects
						? scaleGeometry(geometry, effectScale)
						: geometry,
					transform: normalizeScaledEffects
						? {
								a: composedTransform.a / effectScale,
								b: composedTransform.b / effectScale,
								c: composedTransform.c / effectScale,
								d: composedTransform.d / effectScale,
								e: composedTransform.e,
								f: composedTransform.f,
							}
						: composedTransform,
					appearance: {
						...(object.appearance.fill === undefined
							? {}
							: {
									fill: {
										swatchId:
											swatchIds.get(object.appearance.fill.swatchId) ??
											namespace(scope, object.appearance.fill.swatchId),
									},
								}),
						...(stroke === undefined
							? {}
							: {
									stroke: {
										...stroke,
										swatchId:
											swatchIds.get(stroke.swatchId) ??
											namespace(scope, stroke.swatchId),
										width: stroke.width * effectScale,
										dashArray: stroke.dashArray.map(
											(value) => value * effectScale,
										),
										dashOffset: stroke.dashOffset * effectScale,
									},
								}),
					},
					...linkState,
				}
				projectedObjects.set(object.id, projected)
				linkObjectIdByProjectedId.set(id, link.id)
				return projected
			}

			const sourceGroups = new Map(
				source.document.groups.map((group) => [group.id, group]),
			)
			const projectedGroups = new Map<string, MutableGroup>()
			const root: MutableGroup = {
				id: rootGroupId,
				name: link.name,
				children: [],
			}
			projectedGroups.set(rootGroupId, root)
			const artboardClip: DesignObject = {
				id: namespace(scope, "object:artboard-clip"),
				name: `${artboard.name} bounds`,
				geometry: {
					kind: "rectangle",
					x: 0,
					y: 0,
					width: artboard.width,
					height: artboard.height,
				},
				transform: link.transform,
				appearance: {},
				...linkState,
			}
			projectedObjects.set("__artboard-clip__", artboardClip)
			linkObjectIdByProjectedId.set(artboardClip.id, link.id)
			root.clippingPathId = artboardClip.id
			root.children.push({ kind: "object", id: artboardClip.id })
			const backgroundSwatchId = namespace(
				scope,
				"__runtime__:swatch:artboard-background",
			)
			if (artboard.backgroundColor !== undefined) {
				const background: DesignObject = {
					id: namespace(scope, "__runtime__:object:artboard-background"),
					name: `${artboard.name} background`,
					geometry: {
						kind: "rectangle",
						x: 0,
						y: 0,
						width: artboard.width,
						height: artboard.height,
					},
					transform: link.transform,
					appearance: { fill: { swatchId: backgroundSwatchId } },
					...linkState,
				}
				projectedObjects.set("__artboard-background__", background)
				linkObjectIdByProjectedId.set(background.id, link.id)
				root.children.push({ kind: "object", id: background.id })
			}
			const ensureGroup = (
				groupId: string,
				parent: MutableGroup,
			): MutableGroup => {
				const id = namespace(scope, groupId)
				const existing = projectedGroups.get(id)
				if (existing !== undefined) return existing
				const sourceGroup = sourceGroups.get(groupId)
				const group: MutableGroup = {
					id,
					name: sourceGroup?.name ?? groupId,
					children: [],
				}
				if (sourceGroup?.clippingPathId !== undefined) {
					const clippingObject = source.document.objects.find(
						({ id: objectId }) => objectId === sourceGroup.clippingPathId,
					)
					if (clippingObject !== undefined) {
						const projected = projectObject(clippingObject)
						group.clippingPathId = projected.id
						group.children.push({ kind: "object", id: projected.id })
					}
				}
				projectedGroups.set(id, group)
				parent.children.push({ kind: "group", id })
				return group
			}
			const appendEntry = (entry: DesignOutputEntry): void => {
				let parent = root
				for (const groupId of entry.groupIds)
					parent = ensureGroup(groupId, parent)
				const projected = projectObject(entry.object)
				if (
					!parent.children.some(
						(child) => child.kind === "object" && child.id === projected.id,
					)
				)
					parent.children.push({ kind: "object", id: projected.id })
			}
			for (const entry of entries) appendEntry(entry)

			const groups: readonly DesignGroup[] = [...projectedGroups.values()].map(
				(group) => ({
					id: group.id,
					name: group.name,
					children: group.children,
					...(group.clippingPathId === undefined
						? {}
						: { clippingPathId: group.clippingPathId }),
				}),
			)
			const swatches: readonly DesignSwatch[] = [
				...(artboard.backgroundColor === undefined
					? []
					: [
							{
								id: backgroundSwatchId,
								name: `${artboard.name} background`,
								source: {
									space: "rgb" as const,
									...designHexColorChannels(artboard.backgroundColor),
								},
							},
						]),
				...output.swatches.map((swatch) => ({
					...swatch,
					id: swatchIds.get(swatch.id) ?? namespace(scope, swatch.id),
				})),
			]
			current = {
				...current,
				swatches: [...current.swatches, ...swatches],
				objects: [
					...current.objects.filter(({ id }) => id !== link.id),
					...projectedObjects.values(),
				],
				groups: [
					...current.groups.map((group) => ({
						...group,
						children: replaceObjectChild(group.children, link.id, rootGroupId),
					})),
					...groups,
				],
				layers: current.layers.map((layer) => ({
					...layer,
					children: replaceObjectChild(layer.children, link.id, rootGroupId),
				})),
			}
			images = [...images, ...linkedImages]
			fonts = [...fonts, ...linkedFonts]
		}
		return { document: current, images, fonts }
	}

	const expanded = expand(document, [])
	return {
		document: expanded.document,
		diagnostics,
		imageResources: expanded.images,
		fontResources: expanded.fonts,
		linkObjectIdByProjectedId,
	}
}
