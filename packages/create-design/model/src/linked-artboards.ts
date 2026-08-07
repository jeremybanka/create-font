import type {
	DesignDocument,
	DesignFontResource,
	DesignGroup,
	DesignImageResource,
	DesignLinkedArtboardResource,
	DesignObject,
	DesignSceneChild,
	DesignSwatch,
	DesignTransform,
} from "@create-design/source"

import { objectBounds } from "./geometry.ts"
import { projectDesignOutput, type DesignOutputEntry } from "./output.ts"

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
	bounds: ReturnType<typeof objectBounds>,
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
			if (link.geometry.kind !== "artboard-link") continue
			const key = `${link.geometry.projectId}/${link.geometry.artboardId}`
			if (stack.includes(key)) {
				diagnostics.push({
					code: "artboard-link.cycle",
					message: `Linked artboard cycle detected at ${key}.`,
					objectId: link.id,
				})
				continue
			}
			const resource = byProject.get(link.geometry.projectId)
			if (resource === undefined) {
				diagnostics.push({
					code: "artboard-link.missing-project",
					message: `Linked design ${link.geometry.projectId} is unavailable.`,
					objectId: link.id,
				})
				continue
			}
			const artboard = resource.document.artboards.find(
				({ id }) => id === link.geometry.artboardId,
			)
			if (artboard === undefined) {
				diagnostics.push({
					code: "artboard-link.missing-artboard",
					message: `Linked artboard ${link.geometry.artboardId} no longer exists in ${link.geometry.projectId}.`,
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
				intersects(objectBounds(object), artboard),
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
				const projected: DesignObject = {
					...object,
					id,
					geometry,
					transform: composeTransform(placement, object.transform),
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
						...(object.appearance.stroke === undefined
							? {}
							: {
									stroke: {
										...object.appearance.stroke,
										swatchId:
											swatchIds.get(object.appearance.stroke.swatchId) ??
											namespace(scope, object.appearance.stroke.swatchId),
									},
								}),
					},
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
			}
			projectedObjects.set("__artboard-clip__", artboardClip)
			linkObjectIdByProjectedId.set(artboardClip.id, link.id)
			root.clippingPathId = artboardClip.id
			root.children.push({ kind: "object", id: artboardClip.id })
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
			const swatches: readonly DesignSwatch[] = output.swatches.map(
				(swatch) => ({
					...swatch,
					id: swatchIds.get(swatch.id) ?? namespace(scope, swatch.id),
				}),
			)
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
