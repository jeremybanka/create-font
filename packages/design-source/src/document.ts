import { z } from "zod/v4"

import { diagnostic, failure, success } from "./result.ts"
import { DEFAULT_DESIGN_STROKE_STYLE } from "./types.ts"
import type {
	DesignDocument,
	DesignArtboard,
	DesignObject,
	DesignSourceDiagnostic,
	DesignSourceResult,
} from "./types.ts"

export const CREATE_DESIGN_DOCUMENT_FORMAT = "create-design.document" as const
export const CREATE_DESIGN_DOCUMENT_VERSION = 5 as const
export const PREVIOUS_DESIGN_DOCUMENT_VERSION = 4 as const
export const VERSION_THREE_DESIGN_DOCUMENT_VERSION = 3 as const
export const VERSION_TWO_DESIGN_DOCUMENT_VERSION = 2 as const
export const LEGACY_DESIGN_DOCUMENT_VERSION = 1 as const

export const finiteNumberSchema = z.number().finite()
export const positiveNumberSchema = finiteNumberSchema.positive()
export const designObjectIdSchema = z.string().regex(/^object:.+/u)
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
		contours: z.array(contourSchema),
	})
	.strict()
export const previousPathGeometrySchema = pathGeometrySchema.extend({
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
export const geometrySchema = z.discriminatedUnion("kind", [
	pathGeometrySchema,
	rectangleGeometrySchema,
	ellipseGeometrySchema,
])
export const previousGeometrySchema = z.discriminatedUnion("kind", [
	previousPathGeometrySchema,
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
const previousDesignObjectSchema = z
	.object({
		id: designObjectIdSchema,
		name: z.string(),
		geometry: geometrySchema,
		transform: transformSchema,
		appearance: previousAppearanceSchema,
		hidden: z.boolean().optional(),
		locked: z.boolean().optional(),
	})
	.strict()
const versionTwoDesignObjectSchema = previousDesignObjectSchema.extend({
	geometry: previousGeometrySchema,
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

export const previousDesignDocumentSchema = z
	.object({
		format: z.literal(CREATE_DESIGN_DOCUMENT_FORMAT),
		version: z.literal(PREVIOUS_DESIGN_DOCUMENT_VERSION),
		title: z.string(),
		page: pageSchema,
		swatches: z.array(swatchSchema),
		objects: z.array(designObjectSchema),
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
		guides: parsed.data.guides,
	})
}

export function migrateDesignDocumentV4(
	value: unknown,
): DesignSourceResult<DesignDocument> {
	const parsed = previousDesignDocumentSchema.safeParse(value)
	if (!parsed.success) return failure(documentSchemaDiagnostics(parsed.error))
	return validateDesignDocument({
		format: parsed.data.format,
		version: CREATE_DESIGN_DOCUMENT_VERSION,
		title: parsed.data.title,
		artboards: [legacyPageArtboard(parsed.data.page)],
		swatches: parsed.data.swatches,
		objects: parsed.data.objects,
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
		case PREVIOUS_DESIGN_DOCUMENT_VERSION:
			return migrateDesignDocumentV4(value)
		case VERSION_THREE_DESIGN_DOCUMENT_VERSION:
			return migrateDesignDocumentV3(value)
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
