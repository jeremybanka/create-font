import { z } from "zod/v4"

import { diagnostic, failure, success } from "./result.ts"
import { DEFAULT_DESIGN_STROKE_STYLE } from "./types.ts"
import type {
	DesignDocument,
	DesignArtboard,
	DesignLayer,
	DesignObject,
	DesignSourceDiagnostic,
	DesignSourceResult,
} from "./types.ts"

export const CREATE_DESIGN_DOCUMENT_FORMAT = "create-design.document" as const
export const CREATE_DESIGN_DOCUMENT_VERSION = 6 as const
export const PREVIOUS_DESIGN_DOCUMENT_VERSION = 5 as const
export const VERSION_FOUR_DESIGN_DOCUMENT_VERSION = 4 as const
export const VERSION_THREE_DESIGN_DOCUMENT_VERSION = 3 as const
export const VERSION_TWO_DESIGN_DOCUMENT_VERSION = 2 as const
export const LEGACY_DESIGN_DOCUMENT_VERSION = 1 as const

export const finiteNumberSchema = z.number().finite()
export const positiveNumberSchema = finiteNumberSchema.positive()
export const designObjectIdSchema = z.string().regex(/^object:.+/u)
export const blendIdSchema = z.string().regex(/^blend:.+/u)
export const groupIdSchema = z.string().regex(/^group:.+/u)
export const layerIdSchema = z.string().regex(/^layer:.+/u)
export const swatchIdSchema = z.string().regex(/^swatch:.+/u)
export const guideIdSchema = z.string().regex(/^guide:.+/u)
export const artboardIdSchema = z.string().regex(/^artboard:.+/u)
export const contourIdSchema = z.string().min(1)
export const pointIdSchema = z.string().min(1)

export const rgbColorSchema = z
	.object({
		space: z.literal("rgb"),
		r: finiteNumberSchema.min(0).max(255),
		g: finiteNumberSchema.min(0).max(255),
		b: finiteNumberSchema.min(0).max(255),
	})
	.strict()
export const cmykColorSchema = z
	.object({
		space: z.literal("cmyk"),
		c: finiteNumberSchema.min(0).max(100),
		m: finiteNumberSchema.min(0).max(100),
		y: finiteNumberSchema.min(0).max(100),
		k: finiteNumberSchema.min(0).max(100),
	})
	.strict()
export const colorDefinitionSchema = z.discriminatedUnion("space", [
	rgbColorSchema,
	cmykColorSchema,
])
export const swatchSchema = z
	.object({
		id: swatchIdSchema,
		name: z.string(),
		source: colorDefinitionSchema,
		alternate: colorDefinitionSchema.optional(),
	})
	.strict()
export const vectorSchema = z
	.object({ x: finiteNumberSchema, y: finiteNumberSchema })
	.strict()
export const pointSchema = z
	.object({
		id: pointIdSchema,
		x: finiteNumberSchema,
		y: finiteNumberSchema,
		incoming: vectorSchema.optional(),
		outgoing: vectorSchema.optional(),
	})
	.strict()
export const contourSchema = z
	.object({
		id: contourIdSchema,
		closed: z.boolean(),
		points: z.array(pointSchema),
	})
	.strict()
export const previousPointSchema = pointSchema.extend({
	id: pointIdSchema.optional(),
})
export const previousContourSchema = contourSchema.extend({
	id: contourIdSchema.optional(),
	points: z.array(previousPointSchema),
})
export const pathGeometrySchema = z
	.object({
		kind: z.literal("path"),
		fillRule: z.enum(["nonzero", "evenodd"]).optional(),
		contours: z.array(contourSchema),
	})
	.strict()
const legacyPathGeometrySchema = z
	.object({
		kind: z.literal("path"),
		contours: z.array(contourSchema),
	})
	.strict()
export const previousPathGeometrySchema = z
	.object({
		kind: z.literal("path"),
		contours: z.array(previousContourSchema),
	})
	.strict()
export const compatiblePathGeometrySchema = pathGeometrySchema.extend({
	contours: z.array(previousContourSchema),
})
export const rectangleGeometrySchema = z
	.object({
		kind: z.literal("rectangle"),
		x: finiteNumberSchema,
		y: finiteNumberSchema,
		width: finiteNumberSchema,
		height: finiteNumberSchema,
	})
	.strict()
export const ellipseGeometrySchema = z
	.object({
		kind: z.literal("ellipse"),
		centerX: finiteNumberSchema,
		centerY: finiteNumberSchema,
		radiusX: finiteNumberSchema.nonnegative(),
		radiusY: finiteNumberSchema.nonnegative(),
	})
	.strict()
export const fontReferenceSchema = z
	.object({
		id: z.string().regex(/^font:.+/u),
		family: z.string().min(1),
		faceIndex: z.number().int().nonnegative().optional(),
		revision: z.union([z.string(), finiteNumberSchema]).optional(),
	})
	.strict()
export const textTypographySchema = z
	.object({
		font: fontReferenceSchema,
		size: positiveNumberSchema,
		leading: positiveNumberSchema,
		tracking: finiteNumberSchema,
		kerning: z.union([z.literal("auto"), finiteNumberSchema]),
		alignment: z.enum(["start", "center", "end", "justify"]),
		direction: z.enum(["auto", "ltr", "rtl", "ttb", "btt"]),
		language: z.string().min(1).optional(),
		script: z
			.string()
			.regex(/^[A-Za-z]{4}$/u)
			.optional(),
		variations: z
			.record(z.string().regex(/^[\x20-\x7e]{4}$/u), finiteNumberSchema)
			.optional(),
	})
	.strict()
const textFrameInsetSchema = z
	.object({
		top: finiteNumberSchema.nonnegative(),
		right: finiteNumberSchema.nonnegative(),
		bottom: finiteNumberSchema.nonnegative(),
		left: finiteNumberSchema.nonnegative(),
	})
	.strict()
export const textGeometrySchema = z
	.object({
		kind: z.literal("text"),
		mode: z.enum(["point", "area"]),
		text: z.string(),
		typography: textTypographySchema,
		x: finiteNumberSchema,
		y: finiteNumberSchema,
		frame: z
			.object({
				width: positiveNumberSchema,
				height: positiveNumberSchema,
				inset: textFrameInsetSchema,
				verticalAlignment: z.enum(["top", "center", "bottom"]),
			})
			.strict()
			.optional(),
	})
	.strict()
export const geometrySchema = z.discriminatedUnion("kind", [
	pathGeometrySchema,
	rectangleGeometrySchema,
	ellipseGeometrySchema,
	textGeometrySchema,
])
export const previousGeometrySchema = z.discriminatedUnion("kind", [
	previousPathGeometrySchema,
	rectangleGeometrySchema,
	ellipseGeometrySchema,
])
export const compatibleGeometrySchema = z.discriminatedUnion("kind", [
	compatiblePathGeometrySchema,
	rectangleGeometrySchema,
	ellipseGeometrySchema,
	textGeometrySchema,
])
const legacyGeometrySchema = z.discriminatedUnion("kind", [
	legacyPathGeometrySchema,
	rectangleGeometrySchema,
	ellipseGeometrySchema,
])
export const transformSchema = z
	.object({
		a: finiteNumberSchema,
		b: finiteNumberSchema,
		c: finiteNumberSchema,
		d: finiteNumberSchema,
		e: finiteNumberSchema,
		f: finiteNumberSchema,
	})
	.strict()
export const previousAppearanceSchema = z
	.object({
		fill: z.object({ swatchId: swatchIdSchema }).strict().optional(),
		stroke: z
			.object({
				swatchId: swatchIdSchema,
				width: finiteNumberSchema.nonnegative(),
			})
			.strict()
			.optional(),
	})
	.strict()
export const versionTwoAppearanceSchema = previousAppearanceSchema
const dashArraySchema = z
	.array(finiteNumberSchema.nonnegative())
	.refine(
		(values) => values.length === 0 || values.some((value) => value > 0),
		"Dash arrays must be empty or contain at least one positive length.",
	)
export const appearanceSchema = z
	.object({
		fill: z.object({ swatchId: swatchIdSchema }).strict().optional(),
		stroke: z
			.object({
				swatchId: swatchIdSchema,
				width: finiteNumberSchema.nonnegative(),
				cap: z.enum(["butt", "round", "square"]),
				join: z.enum(["miter", "round", "bevel"]),
				miterLimit: finiteNumberSchema.min(1),
				dashArray: dashArraySchema,
				dashOffset: finiteNumberSchema,
			})
			.strict()
			.optional(),
	})
	.strict()
export const designObjectSchema = z
	.object({
		id: designObjectIdSchema,
		name: z.string(),
		geometry: geometrySchema,
		transform: transformSchema,
		appearance: appearanceSchema,
		hidden: z.boolean().optional(),
		locked: z.boolean().optional(),
	})
	.strict()
export const blendPointCorrespondenceSchema = z
	.object({
		startPointId: pointIdSchema,
		endPointId: pointIdSchema,
	})
	.strict()
export const blendContourCorrespondenceSchema = z
	.object({
		startContourId: contourIdSchema,
		endContourId: contourIdSchema,
		points: z.array(blendPointCorrespondenceSchema),
	})
	.strict()
export const designBlendSchema = z
	.object({
		id: blendIdSchema,
		name: z.string(),
		startObjectId: designObjectIdSchema,
		endObjectId: designObjectIdSchema,
		steps: z.number().int().min(1).max(10_000),
		contours: z.array(blendContourCorrespondenceSchema),
		hidden: z.boolean().optional(),
		locked: z.boolean().optional(),
	})
	.strict()
const previousDesignObjectSchema = z
	.object({
		id: designObjectIdSchema,
		name: z.string(),
		geometry: legacyGeometrySchema,
		transform: transformSchema,
		appearance: previousAppearanceSchema,
		hidden: z.boolean().optional(),
		locked: z.boolean().optional(),
	})
	.strict()
const versionTwoDesignObjectSchema = previousDesignObjectSchema.extend({
	geometry: previousGeometrySchema,
})
const versionFourDesignObjectSchema = designObjectSchema.extend({
	geometry: legacyGeometrySchema,
})
export const legacyDesignObjectSchema = z
	.object({
		id: designObjectIdSchema,
		name: z.string(),
		contours: z.array(previousContourSchema),
		fillId: swatchIdSchema,
		hidden: z.boolean().optional(),
		locked: z.boolean().optional(),
	})
	.strict()
const versionOneDesignObjectSchema = z.unknown().transform((value, context) => {
	const canonical =
		typeof value === "object" &&
		value !== null &&
		!Array.isArray(value) &&
		("geometry" in value || "transform" in value || "appearance" in value)
	const parsed = (
		canonical ? versionTwoDesignObjectSchema : legacyDesignObjectSchema
	).safeParse(value)
	if (parsed.success) return parsed.data
	for (const issue of parsed.error.issues) context.addIssue(issue)
	return z.NEVER
})
export const guideSchema = z
	.object({
		id: guideIdSchema,
		axis: z.enum(["x", "y"]),
		value: finiteNumberSchema,
		locked: z.boolean().optional(),
	})
	.strict()

export const sceneChildSchema = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("object"), id: designObjectIdSchema }).strict(),
	z.object({ kind: z.literal("group"), id: groupIdSchema }).strict(),
])
export const groupSchema = z
	.object({
		id: groupIdSchema,
		name: z.string(),
		children: z.array(sceneChildSchema),
	})
	.strict()
export const layerSchema = z
	.object({
		id: layerIdSchema,
		name: z.string(),
		children: z.array(sceneChildSchema),
		hidden: z.boolean().optional(),
		locked: z.boolean().optional(),
	})
	.strict()

export const artboardInsetsSchema = z
	.object({
		top: finiteNumberSchema.nonnegative(),
		right: finiteNumberSchema.nonnegative(),
		bottom: finiteNumberSchema.nonnegative(),
		left: finiteNumberSchema.nonnegative(),
	})
	.strict()
export const artboardSchema = z
	.object({
		id: artboardIdSchema,
		name: z.string(),
		x: finiteNumberSchema,
		y: finiteNumberSchema,
		width: positiveNumberSchema,
		height: positiveNumberSchema,
		bleed: artboardInsetsSchema.optional(),
		safeArea: artboardInsetsSchema.optional(),
	})
	.strict()
const pageSchema = artboardSchema.omit({
	id: true,
	name: true,
	bleed: true,
	safeArea: true,
})
export const previousPageSchema = z
	.object({
		width: positiveNumberSchema,
		height: positiveNumberSchema,
	})
	.strict()

export const designDocumentSchema = z
	.object({
		format: z.literal(CREATE_DESIGN_DOCUMENT_FORMAT),
		version: z.literal(CREATE_DESIGN_DOCUMENT_VERSION),
		title: z.string(),
		artboards: z.array(artboardSchema).min(1),
		swatches: z.array(swatchSchema),
		objects: z.array(designObjectSchema),
		blends: z.array(designBlendSchema).optional(),
		layers: z.array(layerSchema).min(1),
		groups: z.array(groupSchema),
		guides: z.array(guideSchema),
	})
	.strict()

export const versionFiveDesignDocumentSchema = z
	.object({
		format: z.literal(CREATE_DESIGN_DOCUMENT_FORMAT),
		version: z.literal(PREVIOUS_DESIGN_DOCUMENT_VERSION),
		title: z.string(),
		artboards: z.array(artboardSchema).min(1),
		swatches: z.array(swatchSchema),
		objects: z.array(designObjectSchema),
		blends: z.array(designBlendSchema).optional(),
		scene: z.array(sceneChildSchema).optional(),
		groups: z.array(groupSchema).optional(),
		guides: z.array(guideSchema),
	})
	.strict()

export const versionTwoDesignDocumentSchema = z
	.object({
		format: z.literal(CREATE_DESIGN_DOCUMENT_FORMAT),
		version: z.literal(VERSION_TWO_DESIGN_DOCUMENT_VERSION),
		title: z.string(),
		page: previousPageSchema,
		swatches: z.array(swatchSchema),
		objects: z.array(versionTwoDesignObjectSchema),
		guides: z.array(guideSchema),
	})
	.strict()

export const legacyDesignDocumentSchema = z
	.object({
		format: z.literal(CREATE_DESIGN_DOCUMENT_FORMAT),
		version: z.literal(LEGACY_DESIGN_DOCUMENT_VERSION),
		title: z.string(),
		page: previousPageSchema,
		swatches: z.array(swatchSchema),
		objects: z.array(versionOneDesignObjectSchema),
		guides: z.array(guideSchema),
	})
	.strict()

export const versionThreeDesignDocumentSchema = z
	.object({
		format: z.literal(CREATE_DESIGN_DOCUMENT_FORMAT),
		version: z.literal(VERSION_THREE_DESIGN_DOCUMENT_VERSION),
		title: z.string(),
		page: pageSchema,
		swatches: z.array(swatchSchema),
		objects: z.array(previousDesignObjectSchema),
		guides: z.array(guideSchema),
	})
	.strict()

export const versionFourDesignDocumentSchema = z
	.object({
		format: z.literal(CREATE_DESIGN_DOCUMENT_FORMAT),
		version: z.literal(VERSION_FOUR_DESIGN_DOCUMENT_VERSION),
		title: z.string(),
		page: pageSchema,
		swatches: z.array(swatchSchema),
		objects: z.array(versionFourDesignObjectSchema),
		guides: z.array(guideSchema),
	})
	.strict()

function issuePath(parts: readonly PropertyKey[]): string {
	return parts.length === 0
		? "$"
		: `$${parts
				.map((part) =>
					typeof part === "number" ? `[${part}]` : `.${String(part)}`,
				)
				.join("")}`
}

export function documentSchemaDiagnostics(
	error: z.ZodError,
): readonly DesignSourceDiagnostic[] {
	return error.issues.map((issue) =>
		diagnostic("document.schema", issuePath(issue.path), issue.message),
	)
}

function relationalDiagnostics(
	document: DesignDocument,
): readonly DesignSourceDiagnostic[] {
	const errors: DesignSourceDiagnostic[] = []
	const seenArtboards = new Set<string>()
	for (const [index, artboard] of document.artboards.entries()) {
		if (seenArtboards.has(artboard.id))
			errors.push(
				diagnostic(
					"directory.duplicate_id",
					`$.artboards[${index}].id`,
					`Duplicate artboard ID ${artboard.id}.`,
				),
			)
		seenArtboards.add(artboard.id)
	}
	const seenSwatches = new Set<string>()
	for (const [index, swatch] of document.swatches.entries()) {
		if (seenSwatches.has(swatch.id))
			errors.push(
				diagnostic(
					"directory.duplicate_id",
					`$.swatches[${index}].id`,
					`Duplicate swatch ID ${swatch.id}.`,
				),
			)
		seenSwatches.add(swatch.id)
	}
	const seenObjects = new Set<string>()
	for (const [index, object] of document.objects.entries()) {
		if (seenObjects.has(object.id))
			errors.push(
				diagnostic(
					"directory.duplicate_id",
					`$.objects[${index}].id`,
					`Duplicate object ID ${object.id}.`,
				),
			)
		seenObjects.add(object.id)
		for (const [kind, paint] of [
			["fill", object.appearance.fill],
			["stroke", object.appearance.stroke],
		] as const) {
			if (paint !== undefined && !seenSwatches.has(paint.swatchId))
				errors.push(
					diagnostic(
						"directory.reference",
						`$.objects[${index}].appearance.${kind}.swatchId`,
						`Object ${object.id} references missing swatch ${paint.swatchId}.`,
					),
				)
		}
		if (object.geometry.kind === "path") {
			const seenContours = new Set<string>()
			const seenPoints = new Set<string>()
			for (const [
				contourIndex,
				contour,
			] of object.geometry.contours.entries()) {
				if (contour.id !== undefined) {
					if (seenContours.has(contour.id))
						errors.push(
							diagnostic(
								"directory.duplicate_id",
								`$.objects[${index}].geometry.contours[${contourIndex}].id`,
								`Duplicate contour ID ${contour.id} in object ${object.id}.`,
							),
						)
					seenContours.add(contour.id)
				}
				for (const [pointIndex, point] of contour.points.entries()) {
					if (point.id === undefined) continue
					if (seenPoints.has(point.id))
						errors.push(
							diagnostic(
								"directory.duplicate_id",
								`$.objects[${index}].geometry.contours[${contourIndex}].points[${pointIndex}].id`,
								`Duplicate point ID ${point.id} in object ${object.id}.`,
							),
						)
					seenPoints.add(point.id)
				}
			}
		}
		if (
			object.geometry.kind === "text" &&
			((object.geometry.mode === "area" &&
				object.geometry.frame === undefined) ||
				(object.geometry.mode === "point" &&
					object.geometry.frame !== undefined))
		)
			errors.push(
				diagnostic(
					"document.schema",
					`$.objects[${index}].geometry.frame`,
					object.geometry.mode === "area"
						? "Area text requires a frame."
						: "Point text cannot have a frame.",
				),
			)
	}
	const seenBlends = new Set<string>()
	for (const [index, blend] of (document.blends ?? []).entries()) {
		if (seenBlends.has(blend.id))
			errors.push(
				diagnostic(
					"directory.duplicate_id",
					`$.blends[${index}].id`,
					`Duplicate blend ID ${blend.id}.`,
				),
			)
		seenBlends.add(blend.id)
	}
	{
		const layers = new Map<string, DesignLayer>()
		for (const [index, layer] of document.layers.entries()) {
			if (layers.has(layer.id))
				errors.push(
					diagnostic(
						"directory.duplicate_id",
						`$.layers[${index}].id`,
						`Duplicate layer ID ${layer.id}.`,
					),
				)
			layers.set(layer.id, layer)
		}
		const groups = new Map<string, import("./types.ts").DesignGroup>()
		for (const [index, group] of document.groups.entries()) {
			if (groups.has(group.id))
				errors.push(
					diagnostic(
						"directory.duplicate_id",
						`$.groups[${index}].id`,
						`Duplicate group ID ${group.id}.`,
					),
				)
			groups.set(group.id, group)
		}
		const visitedObjects: string[] = []
		const structuralObjects = new Set<string>()
		const visitedGroups = new Set<string>()
		const activeGroups = new Set<string>()
		const visit = (
			children: readonly import("./types.ts").DesignSceneChild[],
			path: string,
		) => {
			for (const [index, child] of children.entries()) {
				const childPath = `${path}[${index}].id`
				if (child.kind === "object") {
					if (!seenObjects.has(child.id))
						errors.push(
							diagnostic(
								"directory.reference",
								childPath,
								`Hierarchy references missing object ${child.id}.`,
							),
						)
					if (structuralObjects.has(child.id))
						errors.push(
							diagnostic(
								"directory.hierarchy",
								childPath,
								`Object ${child.id} has more than one structural parent.`,
							),
						)
					structuralObjects.add(child.id)
					visitedObjects.push(child.id)
					continue
				}
				const group = groups.get(child.id)
				if (group === undefined) {
					errors.push(
						diagnostic(
							"directory.reference",
							childPath,
							`Hierarchy references missing group ${child.id}.`,
						),
					)
					continue
				}
				if (activeGroups.has(child.id)) {
					errors.push(
						diagnostic(
							"directory.hierarchy",
							childPath,
							`Group ${child.id} creates a hierarchy cycle.`,
						),
					)
					continue
				}
				if (visitedGroups.has(child.id)) {
					errors.push(
						diagnostic(
							"directory.hierarchy",
							childPath,
							`Group ${child.id} has more than one structural parent.`,
						),
					)
					continue
				}
				visitedGroups.add(child.id)
				activeGroups.add(child.id)
				const groupIndex = document.groups.findIndex(
					(candidate) => candidate.id === group.id,
				)
				visit(group.children, `$.groups[${groupIndex}].children`)
				activeGroups.delete(child.id)
			}
		}
		for (const [index, layer] of document.layers.entries())
			visit(layer.children, `$.layers[${index}].children`)
		if (
			visitedObjects.length !== seenObjects.size ||
			new Set(visitedObjects).size !== visitedObjects.length ||
			visitedObjects.some((id, index) => document.objects[index]?.id !== id)
		)
			errors.push(
				diagnostic(
					"directory.hierarchy",
					"$.layers",
					"Every object must appear once in layer paint order.",
				),
			)
		if (visitedGroups.size !== groups.size)
			errors.push(
				diagnostic(
					"directory.hierarchy",
					"$.groups",
					"Every group must have one structural parent.",
				),
			)
	}
	const seenGuides = new Set<string>()
	for (const [index, guide] of document.guides.entries()) {
		if (seenGuides.has(guide.id))
			errors.push(
				diagnostic(
					"directory.duplicate_id",
					`$.guides[${index}].id`,
					`Duplicate guide ID ${guide.id}.`,
				),
			)
		seenGuides.add(guide.id)
	}
	return errors
}

export function validateDesignDocument(
	value: unknown,
): DesignSourceResult<DesignDocument> {
	const parsed = designDocumentSchema.safeParse(value)
	if (!parsed.success) return failure(documentSchemaDiagnostics(parsed.error))
	const document = parsed.data as DesignDocument
	const errors = relationalDiagnostics(document)
	return errors.length === 0 ? success(document) : failure(errors)
}

export const DEFAULT_LAYER_ID = "layer:artwork" as const

function defaultLayer(
	children: readonly import("./types.ts").DesignSceneChild[],
): DesignLayer {
	return { id: DEFAULT_LAYER_ID, name: "Artwork", children }
}

function migrateObjectV1(
	object: z.infer<typeof versionOneDesignObjectSchema>,
): z.infer<typeof versionTwoDesignObjectSchema> {
	if ("geometry" in object) return object
	return {
		id: object.id,
		name: object.name,
		geometry: { kind: "path", contours: object.contours },
		transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
		appearance: { fill: { swatchId: object.fillId } },
		...(object.hidden === undefined ? {} : { hidden: object.hidden }),
		...(object.locked === undefined ? {} : { locked: object.locked }),
	}
}

function nextStableId(base: string, reserved: ReadonlySet<string>): string {
	if (!reserved.has(base)) return base
	for (let suffix = 1; ; suffix += 1) {
		const candidate = `${base}:${suffix}`
		if (!reserved.has(candidate)) return candidate
	}
}

/**
 * Fills only identities that predate the v3 contract. Existing identities are
 * reserved before generation so migration never rewrites an authored ID.
 */
export function stabilizeDesignObjectIdentities(
	object:
		| z.infer<typeof designObjectSchema>
		| z.infer<typeof previousDesignObjectSchema>
		| z.infer<typeof versionTwoDesignObjectSchema>
		| ReturnType<typeof migrateObjectV1>,
): DesignObject {
	const appearance = {
		...object.appearance,
		...(object.appearance.stroke === undefined
			? {}
			: {
					stroke: {
						...DEFAULT_DESIGN_STROKE_STYLE,
						...object.appearance.stroke,
					},
				}),
	}
	if (object.geometry.kind !== "path")
		return { ...object, appearance } as DesignObject
	const reservedContours = new Set(
		object.geometry.contours.flatMap(({ id }) =>
			id === undefined ? [] : [id],
		),
	)
	const reservedPoints = new Set(
		object.geometry.contours.flatMap((contour) =>
			contour.points.flatMap(({ id }) => (id === undefined ? [] : [id])),
		),
	)
	return {
		...object,
		appearance,
		geometry: {
			kind: "path",
			...(object.geometry.fillRule === undefined
				? {}
				: { fillRule: object.geometry.fillRule }),
			contours: object.geometry.contours.map((contour, contourIndex) => {
				const contourId =
					contour.id ??
					nextStableId(`${object.id}:contour:${contourIndex}`, reservedContours)
				reservedContours.add(contourId)
				return {
					...contour,
					id: contourId,
					points: contour.points.map((point, pointIndex) => {
						const pointId =
							point.id ??
							nextStableId(`${contourId}:point:${pointIndex}`, reservedPoints)
						reservedPoints.add(pointId)
						return { ...point, id: pointId }
					}),
				}
			}),
		},
	}
}

function migrateCompleteDocument(
	document: Readonly<{
		readonly format: typeof CREATE_DESIGN_DOCUMENT_FORMAT
		readonly title: string
		readonly page: Readonly<{
			readonly x?: number
			readonly y?: number
			readonly width: number
			readonly height: number
		}>
		readonly swatches: readonly unknown[]
		readonly objects: readonly (
			| z.infer<typeof designObjectSchema>
			| z.infer<typeof previousDesignObjectSchema>
			| z.infer<typeof versionTwoDesignObjectSchema>
			| ReturnType<typeof migrateObjectV1>
		)[]
		readonly guides: readonly unknown[]
	}>,
): DesignSourceResult<DesignDocument> {
	return validateDesignDocument({
		format: document.format,
		version: CREATE_DESIGN_DOCUMENT_VERSION,
		title: document.title,
		artboards: [legacyPageArtboard(document.page)],
		swatches: document.swatches,
		objects: document.objects.map(stabilizeDesignObjectIdentities),
		layers: [
			defaultLayer(
				document.objects.map(({ id }) => ({ kind: "object" as const, id })),
			),
		],
		groups: [],
		guides: document.guides,
	})
}

export const DEFAULT_ARTBOARD_ID = "artboard:page" as const

function legacyPageArtboard(
	page: Readonly<{
		readonly x?: number
		readonly y?: number
		readonly width: number
		readonly height: number
	}>,
): DesignArtboard {
	return {
		id: DEFAULT_ARTBOARD_ID,
		name: "Artboard 1",
		x: page.x ?? 0,
		y: page.y ?? 0,
		width: page.width,
		height: page.height,
	}
}

export function migrateDesignDocumentV1(
	value: unknown,
): DesignSourceResult<DesignDocument> {
	const parsed = legacyDesignDocumentSchema.safeParse(value)
	if (!parsed.success) return failure(documentSchemaDiagnostics(parsed.error))
	return migrateCompleteDocument({
		...parsed.data,
		objects: parsed.data.objects.map(migrateObjectV1),
	})
}

export function migrateDesignDocumentV2(
	value: unknown,
): DesignSourceResult<DesignDocument> {
	const parsed = versionTwoDesignDocumentSchema.safeParse(value)
	if (!parsed.success) return failure(documentSchemaDiagnostics(parsed.error))
	return migrateCompleteDocument(parsed.data)
}

export function migrateDesignDocumentV3(
	value: unknown,
): DesignSourceResult<DesignDocument> {
	const parsed = versionThreeDesignDocumentSchema.safeParse(value)
	if (!parsed.success) return failure(documentSchemaDiagnostics(parsed.error))
	return validateDesignDocument({
		format: parsed.data.format,
		version: CREATE_DESIGN_DOCUMENT_VERSION,
		title: parsed.data.title,
		artboards: [legacyPageArtboard(parsed.data.page)],
		swatches: parsed.data.swatches,
		objects: parsed.data.objects.map(stabilizeDesignObjectIdentities),
		layers: [
			defaultLayer(
				parsed.data.objects.map(({ id }) => ({ kind: "object" as const, id })),
			),
		],
		groups: [],
		guides: parsed.data.guides,
	})
}

export function migrateDesignDocumentV4(
	value: unknown,
): DesignSourceResult<DesignDocument> {
	const parsed = versionFourDesignDocumentSchema.safeParse(value)
	if (!parsed.success) return failure(documentSchemaDiagnostics(parsed.error))
	return validateDesignDocument({
		format: parsed.data.format,
		version: CREATE_DESIGN_DOCUMENT_VERSION,
		title: parsed.data.title,
		artboards: [legacyPageArtboard(parsed.data.page)],
		swatches: parsed.data.swatches,
		objects: parsed.data.objects,
		layers: [
			defaultLayer(
				parsed.data.objects.map(({ id }) => ({ kind: "object" as const, id })),
			),
		],
		groups: [],
		guides: parsed.data.guides,
	})
}

export function migrateDesignDocumentV5(
	value: unknown,
): DesignSourceResult<DesignDocument> {
	const parsed = versionFiveDesignDocumentSchema.safeParse(value)
	if (!parsed.success) return failure(documentSchemaDiagnostics(parsed.error))
	return validateDesignDocument({
		format: parsed.data.format,
		version: CREATE_DESIGN_DOCUMENT_VERSION,
		title: parsed.data.title,
		artboards: parsed.data.artboards,
		swatches: parsed.data.swatches,
		objects: parsed.data.objects,
		...(parsed.data.blends === undefined ? {} : { blends: parsed.data.blends }),
		layers: [
			defaultLayer(
				parsed.data.scene ??
					parsed.data.objects.map(({ id }) => ({
						kind: "object" as const,
						id,
					})),
			),
		],
		groups: parsed.data.groups ?? [],
		guides: parsed.data.guides,
	})
}

function envelope(value: unknown): DesignSourceResult<{
	readonly version: number
}> {
	if (typeof value !== "object" || value === null || Array.isArray(value))
		return failure([
			diagnostic(
				"document.schema",
				"$",
				"Expected a create-design document object.",
			),
		])
	const record = value as Readonly<Record<string, unknown>>
	if (record.format !== CREATE_DESIGN_DOCUMENT_FORMAT)
		return failure([
			diagnostic(
				"document.format",
				"$.format",
				`Expected document format ${CREATE_DESIGN_DOCUMENT_FORMAT}.`,
			),
		])
	if (
		typeof record.version !== "number" ||
		!Number.isSafeInteger(record.version) ||
		record.version < 1
	)
		return failure([
			diagnostic(
				"document.version",
				"$.version",
				"Expected a positive integer document version.",
			),
		])
	return success({ version: record.version })
}

export function decodeDesignDocument(
	value: unknown,
): DesignSourceResult<DesignDocument> {
	const decodedEnvelope = envelope(value)
	if (!decodedEnvelope.ok) return decodedEnvelope
	switch (decodedEnvelope.value.version) {
		case LEGACY_DESIGN_DOCUMENT_VERSION:
			return migrateDesignDocumentV1(value)
		case VERSION_TWO_DESIGN_DOCUMENT_VERSION:
			return migrateDesignDocumentV2(value)
		case VERSION_FOUR_DESIGN_DOCUMENT_VERSION:
			return migrateDesignDocumentV4(value)
		case VERSION_THREE_DESIGN_DOCUMENT_VERSION:
			return migrateDesignDocumentV3(value)
		case PREVIOUS_DESIGN_DOCUMENT_VERSION:
			return migrateDesignDocumentV5(value)
		case CREATE_DESIGN_DOCUMENT_VERSION:
			return validateDesignDocument(value)
		default:
			return failure([
				diagnostic(
					"document.future_version",
					"$.version",
					`Document version ${decodedEnvelope.value.version} is newer than supported version ${CREATE_DESIGN_DOCUMENT_VERSION}.`,
				),
			])
	}
}

export function parseDesignDocumentText(
	text: string,
): DesignSourceResult<DesignDocument> {
	let value: unknown
	try {
		value = JSON.parse(text)
	} catch {
		return failure([diagnostic("json.syntax", "$", "Invalid JSON syntax.")])
	}
	return decodeDesignDocument(value)
}
