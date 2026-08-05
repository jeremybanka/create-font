import {
	type ActorToolkit,
	type ReaderToolkit,
	Silo,
	type TimelineManageable,
} from "atom.io"

import type {
	ColorDefinition,
	DesignAppearance,
	DesignArtboard,
	DesignArtboardInsets,
	DesignBlend,
	DesignContour,
	DesignDocument,
	DesignFillRule,
	DesignGeometry,
	DesignGroup,
	DesignGuide,
	DesignLayer,
	DesignObject,
	DesignPoint,
	DesignSceneChild,
	DesignSwatch,
	DesignTransform,
} from "./types.ts"

type ArtboardRect = Readonly<
	Pick<DesignArtboard, "height" | "width" | "x" | "y">
>
type RectangleGeometry = Omit<
	Extract<DesignGeometry, Readonly<{ kind: "rectangle" }>>,
	"kind"
>
type EllipseGeometry = Omit<
	Extract<DesignGeometry, Readonly<{ kind: "ellipse" }>>,
	"kind"
>
type TextGeometry = Omit<
	Extract<DesignGeometry, Readonly<{ kind: "text" }>>,
	"kind"
>
type GeometryKind = DesignGeometry["kind"]
type ObjectContourKey = readonly [objectId: string, contourId: string]
type PointReference = readonly [pointId: string, occurrence: number]
type ObjectPointKey = readonly [
	objectId: string,
	contourId: string,
	pointId: string,
	occurrence: number,
]

const sameStrings = (
	left: readonly string[] | undefined,
	right: readonly string[] | undefined,
): boolean =>
	left === right ||
	(left !== undefined &&
		right !== undefined &&
		left.length === right.length &&
		left.every((value, index) => value === right[index]))

const sameSceneChildren = (
	left: readonly DesignSceneChild[] | undefined,
	right: readonly DesignSceneChild[] | undefined,
): boolean =>
	left === right ||
	(left !== undefined &&
		right !== undefined &&
		left.length === right.length &&
		left.every(
			(value, index) =>
				value.kind === right[index]?.kind && value.id === right[index]?.id,
		))

const sameArtboardRect = (
	left: ArtboardRect | null,
	right: ArtboardRect,
): boolean =>
	left !== null &&
	left.x === right.x &&
	left.y === right.y &&
	left.width === right.width &&
	left.height === right.height

const sameRectangle = (
	left: RectangleGeometry | null,
	right: RectangleGeometry,
): boolean =>
	left !== null &&
	left.x === right.x &&
	left.y === right.y &&
	left.width === right.width &&
	left.height === right.height

const sameEllipse = (
	left: EllipseGeometry | null,
	right: EllipseGeometry,
): boolean =>
	left !== null &&
	left.centerX === right.centerX &&
	left.centerY === right.centerY &&
	left.radiusX === right.radiusX &&
	left.radiusY === right.radiusY

function uniqueIds<Value extends Readonly<{ id: string }>>(
	values: readonly Value[],
	label: string,
): readonly string[] {
	const ids = values.map(({ id }) => id)
	if (new Set(ids).size !== ids.length)
		throw new Error(
			`Duplicate ${label} IDs cannot be loaded into atom families.`,
		)
	return ids
}

/**
 * Declares the normalized authored state for one design document.
 *
 * `DesignDocument` remains the source/RPC projection. Runtime ownership lives in
 * independently observable atoms and keyed families, reconciled by transactions.
 */
export function createDesignDocumentState(
	silo: Silo,
	initialDocument: DesignDocument,
) {
	const titleAtom = silo.atom<string>({ key: "title", default: "" })
	const artboardIdsAtom = silo.atom<readonly string[]>({
		key: "artboardIds",
		default: [],
	})
	const swatchIdsAtom = silo.atom<readonly string[]>({
		key: "swatchIds",
		default: [],
	})
	const objectIdsAtom = silo.atom<readonly string[]>({
		key: "objectIds",
		default: [],
	})
	const blendsAtom = silo.atom<readonly DesignBlend[] | undefined>({
		key: "blends",
		default: undefined,
	})
	const layerIdsAtom = silo.atom<readonly string[]>({
		key: "layerIds",
		default: [],
	})
	const groupIdsAtom = silo.atom<readonly string[]>({
		key: "groupIds",
		default: [],
	})
	const guideIdsAtom = silo.atom<readonly string[]>({
		key: "guideIds",
		default: [],
	})

	const artboardNameAtoms = silo.atomFamily<string | null, string>({
		key: "artboardName",
		default: null,
	})
	const artboardRectAtoms = silo.atomFamily<ArtboardRect | null, string>({
		key: "artboardRect",
		default: null,
	})
	const artboardBleedAtoms = silo.atomFamily<
		DesignArtboardInsets | undefined,
		string
	>({ key: "artboardBleed", default: undefined })
	const artboardSafeAreaAtoms = silo.atomFamily<
		DesignArtboardInsets | undefined,
		string
	>({ key: "artboardSafeArea", default: undefined })

	const swatchNameAtoms = silo.atomFamily<string | null, string>({
		key: "swatchName",
		default: null,
	})
	const swatchSourceAtoms = silo.atomFamily<ColorDefinition | null, string>({
		key: "swatchSource",
		default: null,
	})
	const swatchAlternateAtoms = silo.atomFamily<
		ColorDefinition | undefined,
		string
	>({ key: "swatchAlternate", default: undefined })

	const objectNameAtoms = silo.atomFamily<string | null, string>({
		key: "objectName",
		default: null,
	})
	const objectTransformAtoms = silo.atomFamily<DesignTransform | null, string>({
		key: "objectTransform",
		default: null,
	})
	const objectAppearanceAtoms = silo.atomFamily<
		DesignAppearance | null,
		string
	>({
		key: "objectAppearance",
		default: null,
	})
	const objectHiddenAtoms = silo.atomFamily<boolean | undefined, string>({
		key: "objectHidden",
		default: undefined,
	})
	const objectLockedAtoms = silo.atomFamily<boolean | undefined, string>({
		key: "objectLocked",
		default: undefined,
	})
	const objectKindAtoms = silo.atomFamily<GeometryKind | null, string>({
		key: "objectKind",
		default: null,
	})
	const rectangleGeometryAtoms = silo.atomFamily<
		RectangleGeometry | null,
		string
	>({ key: "rectangleGeometry", default: null })
	const ellipseGeometryAtoms = silo.atomFamily<EllipseGeometry | null, string>({
		key: "ellipseGeometry",
		default: null,
	})
	const textGeometryAtoms = silo.atomFamily<TextGeometry | null, string>({
		key: "textGeometry",
		default: null,
	})
	const pathFillRuleAtoms = silo.atomFamily<DesignFillRule | undefined, string>(
		{ key: "pathFillRule", default: undefined },
	)
	const objectContourIdsAtoms = silo.atomFamily<
		readonly string[] | null,
		string
	>({ key: "objectContourIds", default: null })
	const contourClosedAtoms = silo.atomFamily<boolean | null, ObjectContourKey>({
		key: "contourClosed",
		default: null,
	})
	const contourPointIdsAtoms = silo.atomFamily<
		readonly PointReference[] | null,
		ObjectContourKey
	>({ key: "contourPointIds", default: null })
	const pointAtoms = silo.atomFamily<DesignPoint | null, ObjectPointKey>({
		key: "point",
		default: null,
	})

	const groupNameAtoms = silo.atomFamily<string | null, string>({
		key: "groupName",
		default: null,
	})
	const groupChildrenAtoms = silo.atomFamily<
		readonly DesignSceneChild[] | null,
		string
	>({ key: "groupChildren", default: null })
	const layerNameAtoms = silo.atomFamily<string | null, string>({
		key: "layerName",
		default: null,
	})
	const layerChildrenAtoms = silo.atomFamily<
		readonly DesignSceneChild[] | null,
		string
	>({ key: "layerChildren", default: null })
	const layerHiddenAtoms = silo.atomFamily<boolean | undefined, string>({
		key: "layerHidden",
		default: undefined,
	})
	const layerLockedAtoms = silo.atomFamily<boolean | undefined, string>({
		key: "layerLocked",
		default: undefined,
	})
	const guideAtoms = silo.atomFamily<DesignGuide | null, string>({
		key: "guide",
		default: null,
	})
	const readObjectGeometry = (
		get: ReaderToolkit["get"],
		objectId: string,
	): DesignGeometry | null => {
		const kind = get(objectKindAtoms, objectId)
		if (kind === null) return null
		if (kind === "rectangle") {
			const rectangle = get(rectangleGeometryAtoms, objectId)
			return rectangle === null ? null : { kind, ...rectangle }
		}
		if (kind === "ellipse") {
			const ellipse = get(ellipseGeometryAtoms, objectId)
			return ellipse === null ? null : { kind, ...ellipse }
		}
		if (kind === "text") {
			const text = get(textGeometryAtoms, objectId)
			return text === null ? null : { kind, ...text }
		}
		const contourIds = get(objectContourIdsAtoms, objectId)
		if (contourIds === null) return null
		const contours: DesignContour[] = []
		for (const contourId of contourIds) {
			const contourKey: ObjectContourKey = [objectId, contourId]
			const closed = get(contourClosedAtoms, contourKey)
			const pointIds = get(contourPointIdsAtoms, contourKey)
			if (closed === null || pointIds === null) return null
			const points: DesignPoint[] = []
			for (const [pointId, occurrence] of pointIds) {
				const point = get(pointAtoms, [
					objectId,
					contourId,
					pointId,
					occurrence,
				])
				if (point === null) return null
				points.push(point)
			}
			contours.push({ id: contourId, closed, points })
		}
		const fillRule = get(pathFillRuleAtoms, objectId)
		return {
			kind,
			...(fillRule === undefined ? {} : { fillRule }),
			contours,
		}
	}

	const artboardSelectors = silo.selectorFamily<DesignArtboard | null, string>({
		key: "artboard",
		get:
			(id) =>
			({ get }) => {
				const name = get(artboardNameAtoms, id)
				const rect = get(artboardRectAtoms, id)
				if (name === null || rect === null) return null
				const bleed = get(artboardBleedAtoms, id)
				const safeArea = get(artboardSafeAreaAtoms, id)
				return {
					id,
					name,
					...rect,
					...(bleed === undefined ? {} : { bleed }),
					...(safeArea === undefined ? {} : { safeArea }),
				}
			},
	})
	const swatchSelectors = silo.selectorFamily<DesignSwatch | null, string>({
		key: "swatch",
		get:
			(id) =>
			({ get }) => {
				const name = get(swatchNameAtoms, id)
				const source = get(swatchSourceAtoms, id)
				if (name === null || source === null) return null
				const alternate = get(swatchAlternateAtoms, id)
				return {
					id,
					name,
					source,
					...(alternate === undefined ? {} : { alternate }),
				}
			},
	})
	const objectGeometrySelectors = silo.selectorFamily<
		DesignGeometry | null,
		string
	>({
		key: "objectGeometry",
		get:
			(objectId) =>
			({ get }) =>
				readObjectGeometry(get, objectId),
	})
	const objectSelectors = silo.selectorFamily<DesignObject | null, string>({
		key: "object",
		get:
			(id) =>
			({ get }) => {
				const name = get(objectNameAtoms, id)
				const geometry = get(objectGeometrySelectors, id)
				const transform = get(objectTransformAtoms, id)
				const appearance = get(objectAppearanceAtoms, id)
				if (
					name === null ||
					geometry === null ||
					transform === null ||
					appearance === null
				)
					return null
				const hidden = get(objectHiddenAtoms, id)
				const locked = get(objectLockedAtoms, id)
				return {
					id,
					name,
					geometry,
					transform,
					appearance,
					...(hidden === undefined ? {} : { hidden }),
					...(locked === undefined ? {} : { locked }),
				}
			},
	})
	const groupSelectors = silo.selectorFamily<DesignGroup | null, string>({
		key: "group",
		get:
			(id) =>
			({ get }) => {
				const name = get(groupNameAtoms, id)
				const children = get(groupChildrenAtoms, id)
				return name === null || children === null
					? null
					: { id, name, children }
			},
	})
	const layerSelectors = silo.selectorFamily<DesignLayer | null, string>({
		key: "layer",
		get:
			(id) =>
			({ get }) => {
				const name = get(layerNameAtoms, id)
				const children = get(layerChildrenAtoms, id)
				if (name === null || children === null) return null
				const hidden = get(layerHiddenAtoms, id)
				const locked = get(layerLockedAtoms, id)
				return {
					id,
					name,
					children,
					...(hidden === undefined ? {} : { hidden }),
					...(locked === undefined ? {} : { locked }),
				}
			},
	})

	const required = <Value>(
		value: Value | null,
		kind: string,
		id: string,
	): Value => {
		if (value === null)
			throw new Error(`Missing ${kind} ${id} in normalized design state.`)
		return value
	}
	const documentSelector = silo.selector<DesignDocument>({
		key: "document",
		get: ({ get }) => {
			const groupIds = get(groupIdsAtom)
			return {
				format: "create-design.document",
				version: 6,
				title: get(titleAtom),
				artboards: get(artboardIdsAtom).map((id) =>
					required(get(artboardSelectors, id), "artboard", id),
				),
				swatches: get(swatchIdsAtom).map((id) =>
					required(get(swatchSelectors, id), "swatch", id),
				),
				objects: get(objectIdsAtom).map((id) =>
					required(get(objectSelectors, id), "object", id),
				),
				...(get(blendsAtom) === undefined ? {} : { blends: get(blendsAtom)! }),
				layers: get(layerIdsAtom).map((id) =>
					required(get(layerSelectors, id), "layer", id),
				),
				groups: groupIds.map((id) =>
					required(get(groupSelectors, id), "group", id),
				),
				guides: get(guideIdsAtom).map((id) =>
					required(get(guideAtoms, id), "guide", id),
				),
			}
		},
	})

	const setStrings = (
		get: ReaderToolkit["get"],
		set: ActorToolkit["set"],
		token: typeof artboardIdsAtom,
		next: readonly string[],
	): void => {
		if (!sameStrings(get(token), next)) set(token, next)
	}
	const clearPath = (
		tools: Pick<ActorToolkit, "dispose" | "get">,
		objectId: string,
	): void => {
		const contourIds = tools.get(objectContourIdsAtoms, objectId) ?? []
		for (const contourId of contourIds) {
			const contourKey: ObjectContourKey = [objectId, contourId]
			for (const [pointId, occurrence] of tools.get(
				contourPointIdsAtoms,
				contourKey,
			) ?? [])
				tools.dispose(pointAtoms, [objectId, contourId, pointId, occurrence])
			tools.dispose(contourPointIdsAtoms, contourKey)
			tools.dispose(contourClosedAtoms, contourKey)
		}
		tools.dispose(objectContourIdsAtoms, objectId)
		tools.dispose(pathFillRuleAtoms, objectId)
	}
	const writeGeometry = (
		tools: Pick<ActorToolkit, "dispose" | "get" | "set">,
		objectId: string,
		geometry: DesignGeometry,
	): void => {
		const previousKind = tools.get(objectKindAtoms, objectId)
		if (previousKind === "path" && geometry.kind !== "path")
			clearPath(tools, objectId)
		if (previousKind === "rectangle" && geometry.kind !== "rectangle")
			tools.dispose(rectangleGeometryAtoms, objectId)
		if (previousKind === "ellipse" && geometry.kind !== "ellipse")
			tools.dispose(ellipseGeometryAtoms, objectId)
		if (previousKind === "text" && geometry.kind !== "text")
			tools.dispose(textGeometryAtoms, objectId)
		if (previousKind !== geometry.kind)
			tools.set(objectKindAtoms, objectId, geometry.kind)

		if (geometry.kind === "rectangle") {
			const { kind: _, ...rectangle } = geometry
			if (
				!sameRectangle(tools.get(rectangleGeometryAtoms, objectId), rectangle)
			)
				tools.set(rectangleGeometryAtoms, objectId, rectangle)
			return
		}
		if (geometry.kind === "ellipse") {
			const { kind: _, ...ellipse } = geometry
			if (!sameEllipse(tools.get(ellipseGeometryAtoms, objectId), ellipse))
				tools.set(ellipseGeometryAtoms, objectId, ellipse)
			return
		}
		if (geometry.kind === "text") {
			const { kind: _, ...text } = geometry
			const previous = tools.get(textGeometryAtoms, objectId)
			if (
				previous === null ||
				JSON.stringify(previous) !== JSON.stringify(text)
			)
				tools.set(textGeometryAtoms, objectId, text)
			return
		}

		if (tools.get(pathFillRuleAtoms, objectId) !== geometry.fillRule)
			tools.set(pathFillRuleAtoms, objectId, geometry.fillRule)
		const previousContourIds = tools.get(objectContourIdsAtoms, objectId) ?? []
		const contourIds = uniqueIds(geometry.contours, "contour")
		const nextContourIds = new Set(contourIds)
		for (const contourId of previousContourIds) {
			if (nextContourIds.has(contourId)) continue
			const contourKey: ObjectContourKey = [objectId, contourId]
			for (const [pointId, occurrence] of tools.get(
				contourPointIdsAtoms,
				contourKey,
			) ?? [])
				tools.dispose(pointAtoms, [objectId, contourId, pointId, occurrence])
			tools.dispose(contourPointIdsAtoms, contourKey)
			tools.dispose(contourClosedAtoms, contourKey)
		}
		if (!sameStrings(previousContourIds, contourIds))
			tools.set(objectContourIdsAtoms, objectId, contourIds)
		for (const contour of geometry.contours) {
			const contourKey: ObjectContourKey = [objectId, contour.id]
			if (tools.get(contourClosedAtoms, contourKey) !== contour.closed)
				tools.set(contourClosedAtoms, contourKey, contour.closed)
			const previousPointReferences =
				tools.get(contourPointIdsAtoms, contourKey) ?? []
			const pointOccurrences = new Map<string, number>()
			const pointReferences = contour.points.map(({ id }): PointReference => {
				const occurrence = pointOccurrences.get(id) ?? 0
				pointOccurrences.set(id, occurrence + 1)
				return [id, occurrence]
			})
			const referenceKey = ([id, occurrence]: PointReference) =>
				`${id}\u0000${occurrence}`
			const nextPointReferences = new Set(pointReferences.map(referenceKey))
			for (const reference of previousPointReferences)
				if (!nextPointReferences.has(referenceKey(reference)))
					tools.dispose(pointAtoms, [objectId, contour.id, ...reference])
			if (
				!sameStrings(
					previousPointReferences.map(referenceKey),
					pointReferences.map(referenceKey),
				)
			)
				tools.set(contourPointIdsAtoms, contourKey, pointReferences)
			pointOccurrences.clear()
			for (const point of contour.points) {
				const occurrence = pointOccurrences.get(point.id) ?? 0
				pointOccurrences.set(point.id, occurrence + 1)
				const pointKey: ObjectPointKey = [
					objectId,
					contour.id,
					point.id,
					occurrence,
				]
				if (tools.get(pointAtoms, pointKey) !== point)
					tools.set(pointAtoms, pointKey, point)
			}
		}
	}
	const disposeObject = (
		tools: Pick<ActorToolkit, "dispose" | "get">,
		objectId: string,
	): void => {
		const kind = tools.get(objectKindAtoms, objectId)
		if (kind === "path") clearPath(tools, objectId)
		if (kind === "rectangle") tools.dispose(rectangleGeometryAtoms, objectId)
		if (kind === "ellipse") tools.dispose(ellipseGeometryAtoms, objectId)
		if (kind === "text") tools.dispose(textGeometryAtoms, objectId)
		tools.dispose(objectKindAtoms, objectId)
		tools.dispose(objectNameAtoms, objectId)
		tools.dispose(objectTransformAtoms, objectId)
		tools.dispose(objectAppearanceAtoms, objectId)
		tools.dispose(objectHiddenAtoms, objectId)
		tools.dispose(objectLockedAtoms, objectId)
	}

	const writeDocument = (
		tools: ActorToolkit,
		document: DesignDocument,
	): void => {
		if (tools.get(titleAtom) !== document.title)
			tools.set(titleAtom, document.title)

		const previousArtboardIds = tools.get(artboardIdsAtom)
		const artboardIds = uniqueIds(document.artboards, "artboard")
		const nextArtboardIds = new Set(artboardIds)
		for (const id of previousArtboardIds) {
			if (nextArtboardIds.has(id)) continue
			tools.dispose(artboardNameAtoms, id)
			tools.dispose(artboardRectAtoms, id)
			tools.dispose(artboardBleedAtoms, id)
			tools.dispose(artboardSafeAreaAtoms, id)
		}
		setStrings(tools.get, tools.set, artboardIdsAtom, artboardIds)
		for (const artboard of document.artboards) {
			if (tools.get(artboardNameAtoms, artboard.id) !== artboard.name)
				tools.set(artboardNameAtoms, artboard.id, artboard.name)
			const rect: ArtboardRect = {
				x: artboard.x,
				y: artboard.y,
				width: artboard.width,
				height: artboard.height,
			}
			if (!sameArtboardRect(tools.get(artboardRectAtoms, artboard.id), rect))
				tools.set(artboardRectAtoms, artboard.id, rect)
			if (tools.get(artboardBleedAtoms, artboard.id) !== artboard.bleed)
				tools.set(artboardBleedAtoms, artboard.id, artboard.bleed)
			if (tools.get(artboardSafeAreaAtoms, artboard.id) !== artboard.safeArea)
				tools.set(artboardSafeAreaAtoms, artboard.id, artboard.safeArea)
		}

		const previousSwatchIds = tools.get(swatchIdsAtom)
		const swatchIds = uniqueIds(document.swatches, "swatch")
		const nextSwatchIds = new Set(swatchIds)
		for (const id of previousSwatchIds) {
			if (nextSwatchIds.has(id)) continue
			tools.dispose(swatchNameAtoms, id)
			tools.dispose(swatchSourceAtoms, id)
			tools.dispose(swatchAlternateAtoms, id)
		}
		setStrings(tools.get, tools.set, swatchIdsAtom, swatchIds)
		for (const swatch of document.swatches) {
			if (tools.get(swatchNameAtoms, swatch.id) !== swatch.name)
				tools.set(swatchNameAtoms, swatch.id, swatch.name)
			if (tools.get(swatchSourceAtoms, swatch.id) !== swatch.source)
				tools.set(swatchSourceAtoms, swatch.id, swatch.source)
			if (tools.get(swatchAlternateAtoms, swatch.id) !== swatch.alternate)
				tools.set(swatchAlternateAtoms, swatch.id, swatch.alternate)
		}

		const previousObjectIds = tools.get(objectIdsAtom)
		const objectIds = uniqueIds(document.objects, "object")
		const nextObjectIds = new Set(objectIds)
		for (const id of previousObjectIds)
			if (!nextObjectIds.has(id)) disposeObject(tools, id)
		setStrings(tools.get, tools.set, objectIdsAtom, objectIds)
		for (const object of document.objects) {
			if (tools.get(objectNameAtoms, object.id) !== object.name)
				tools.set(objectNameAtoms, object.id, object.name)
			if (tools.get(objectTransformAtoms, object.id) !== object.transform)
				tools.set(objectTransformAtoms, object.id, object.transform)
			if (tools.get(objectAppearanceAtoms, object.id) !== object.appearance)
				tools.set(objectAppearanceAtoms, object.id, object.appearance)
			if (tools.get(objectHiddenAtoms, object.id) !== object.hidden)
				tools.set(objectHiddenAtoms, object.id, object.hidden)
			if (tools.get(objectLockedAtoms, object.id) !== object.locked)
				tools.set(objectLockedAtoms, object.id, object.locked)
			writeGeometry(tools, object.id, object.geometry)
		}
		if (tools.get(blendsAtom) !== document.blends)
			tools.set(blendsAtom, document.blends)

		const previousLayerIds = tools.get(layerIdsAtom)
		const layerIds = uniqueIds(document.layers, "layer")
		const nextLayerIds = new Set(layerIds)
		for (const id of previousLayerIds) {
			if (nextLayerIds.has(id)) continue
			tools.dispose(layerNameAtoms, id)
			tools.dispose(layerChildrenAtoms, id)
			tools.dispose(layerHiddenAtoms, id)
			tools.dispose(layerLockedAtoms, id)
		}
		setStrings(tools.get, tools.set, layerIdsAtom, layerIds)
		for (const layer of document.layers) {
			if (tools.get(layerNameAtoms, layer.id) !== layer.name)
				tools.set(layerNameAtoms, layer.id, layer.name)
			if (
				!sameSceneChildren(
					tools.get(layerChildrenAtoms, layer.id) ?? [],
					layer.children,
				)
			)
				tools.set(layerChildrenAtoms, layer.id, layer.children)
			if (tools.get(layerHiddenAtoms, layer.id) !== layer.hidden)
				tools.set(layerHiddenAtoms, layer.id, layer.hidden)
			if (tools.get(layerLockedAtoms, layer.id) !== layer.locked)
				tools.set(layerLockedAtoms, layer.id, layer.locked)
		}

		const previousGroupIds = tools.get(groupIdsAtom)
		const groupIds = uniqueIds(document.groups, "group")
		const nextGroupIds = new Set(groupIds)
		for (const id of previousGroupIds) {
			if (nextGroupIds.has(id)) continue
			tools.dispose(groupNameAtoms, id)
			tools.dispose(groupChildrenAtoms, id)
		}
		if (!sameStrings(tools.get(groupIdsAtom), groupIds))
			tools.set(groupIdsAtom, groupIds)
		for (const group of document.groups) {
			if (tools.get(groupNameAtoms, group.id) !== group.name)
				tools.set(groupNameAtoms, group.id, group.name)
			if (
				!sameSceneChildren(
					tools.get(groupChildrenAtoms, group.id) ?? [],
					group.children,
				)
			)
				tools.set(groupChildrenAtoms, group.id, group.children)
		}

		const previousGuideIds = tools.get(guideIdsAtom)
		const guideIds = uniqueIds(document.guides, "guide")
		const nextGuideIds = new Set(guideIds)
		for (const id of previousGuideIds)
			if (!nextGuideIds.has(id)) tools.dispose(guideAtoms, id)
		setStrings(tools.get, tools.set, guideIdsAtom, guideIds)
		for (const guide of document.guides)
			if (tools.get(guideAtoms, guide.id) !== guide)
				tools.set(guideAtoms, guide.id, guide)
	}

	const initializeDocumentTransaction = silo.transaction<
		(document: DesignDocument) => void
	>({
		key: "initializeDocument",
		do: (tools, document) => writeDocument(tools, document),
	})
	silo.runTransaction(initializeDocumentTransaction)(initialDocument)
	const scope: TimelineManageable[] = [
		titleAtom,
		artboardIdsAtom,
		artboardNameAtoms,
		artboardRectAtoms,
		artboardBleedAtoms,
		artboardSafeAreaAtoms,
		swatchIdsAtom,
		swatchNameAtoms,
		swatchSourceAtoms,
		swatchAlternateAtoms,
		objectIdsAtom,
		blendsAtom,
		objectNameAtoms,
		objectTransformAtoms,
		objectAppearanceAtoms,
		objectHiddenAtoms,
		objectLockedAtoms,
		objectKindAtoms,
		rectangleGeometryAtoms,
		ellipseGeometryAtoms,
		pathFillRuleAtoms,
		objectContourIdsAtoms,
		contourClosedAtoms,
		contourPointIdsAtoms,
		pointAtoms,
		layerIdsAtom,
		layerNameAtoms,
		layerChildrenAtoms,
		layerHiddenAtoms,
		layerLockedAtoms,
		groupIdsAtom,
		groupNameAtoms,
		groupChildrenAtoms,
		guideIdsAtom,
		guideAtoms,
	]

	return {
		documentSelector,
		scope,
		states: {
			titleAtom,
			artboardIdsAtom,
			artboardNameAtoms,
			artboardRectAtoms,
			artboardBleedAtoms,
			artboardSafeAreaAtoms,
			artboardSelectors,
			swatchIdsAtom,
			swatchNameAtoms,
			swatchSourceAtoms,
			swatchAlternateAtoms,
			swatchSelectors,
			objectIdsAtom,
			blendsAtom,
			objectNameAtoms,
			objectTransformAtoms,
			objectAppearanceAtoms,
			objectHiddenAtoms,
			objectLockedAtoms,
			objectKindAtoms,
			rectangleGeometryAtoms,
			ellipseGeometryAtoms,
			pathFillRuleAtoms,
			objectContourIdsAtoms,
			contourClosedAtoms,
			contourPointIdsAtoms,
			pointAtoms,
			objectGeometrySelectors,
			objectSelectors,
			layerIdsAtom,
			layerNameAtoms,
			layerChildrenAtoms,
			layerHiddenAtoms,
			layerLockedAtoms,
			layerSelectors,
			groupIdsAtom,
			groupNameAtoms,
			groupChildrenAtoms,
			groupSelectors,
			guideIdsAtom,
			guideAtoms,
			documentSelector,
		},
		writeDocument,
	}
}

export type DesignDocumentState = ReturnType<typeof createDesignDocumentState>
