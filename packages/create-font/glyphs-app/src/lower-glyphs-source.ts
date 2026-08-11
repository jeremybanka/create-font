import {
	analyzeFeaProject,
	validateEditorFontSource,
} from "@create-font/source"
import type {
	EditorAxisSource,
	EditorFontSource,
	EditorGlyphLayerSource,
	EditorGlyphSource,
	EditorInstanceSource,
	EditorMasterSource,
} from "@create-font/states"

import type {
	GlyphsSourceDictionary as PlistDictionary,
	GlyphsSourceDocument,
	GlyphsSourceValue as PlistValue,
} from "./glyphs-source-types.ts"
import type { GlyphsImportDiagnostic, GlyphsImportResult } from "./types.ts"

function dictionary(
	value: PlistValue | undefined,
): PlistDictionary | undefined {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as PlistDictionary)
		: undefined
}

function array(value: PlistValue | undefined): readonly PlistValue[] {
	return Array.isArray(value) ? value : []
}

function string(value: PlistValue | undefined): string | undefined {
	return typeof value === "string" ? value : undefined
}

function number(value: PlistValue | undefined): number | undefined {
	const text = string(value)
	if (text === undefined || text.trim() === "") return undefined
	const parsed = Number(text)
	return Number.isFinite(parsed) ? parsed : undefined
}

function enabled(value: PlistValue | undefined, fallback = true): boolean {
	const text = string(value)
	if (text === undefined) return fallback
	return text !== "0" && text.toLowerCase() !== "false"
}

function dictionaries(
	value: PlistValue | undefined,
): readonly PlistDictionary[] {
	return array(value).flatMap((item) => {
		const record = dictionary(item)
		return record === undefined ? [] : [record]
	})
}

function identifier(value: string): string {
	return value.normalize("NFC").replaceAll("/", "_")
}

function customParameters(root: PlistDictionary): Map<string, PlistValue> {
	return new Map(
		dictionaries(root.customParameters).flatMap((parameter) => {
			const name = string(parameter.name)
			return name === undefined || parameter.value === undefined
				? []
				: [[name, parameter.value] as const]
		}),
	)
}

function axisDefinitions(root: PlistDictionary): readonly {
	defaultValue?: number
	hidden?: boolean
	name: string
	tag: string
}[] {
	const direct = dictionaries(root.axes)
	const parameters = customParameters(root)
	const legacy = dictionaries(parameters.get("Axes"))
	return (direct.length > 0 ? direct : legacy).flatMap((axis, index) => {
		const name = string(axis.name) ?? string(axis.Name) ?? `Axis ${index + 1}`
		const tag = string(axis.tag) ?? string(axis.Tag)
		const defaultValue = number(axis.default)
		return tag === undefined
			? []
			: [
					{
						name,
						tag,
						...(defaultValue === undefined ? {} : { defaultValue }),
						...(axis.hidden === undefined
							? {}
							: { hidden: enabled(axis.hidden, false) }),
					},
				]
	})
}

function legacyCoordinate(
	record: PlistDictionary,
	tag: string,
): number | undefined {
	const suffix =
		tag === "wght"
			? "Weight"
			: tag === "wdth"
				? "Width"
				: tag === "opsz"
					? "Custom"
					: undefined
	if (suffix === undefined) return undefined
	return (
		number(record[`interpolation${suffix}`]) ??
		number(record[`${suffix.toLowerCase()}Value`])
	)
}

function widthClassForWidth(width: number): number {
	const stops = [50, 62.5, 75, 87.5, 100, 112.5, 125, 150, 200]
	if (width <= (stops[0] ?? 50)) return 1
	if (width >= (stops[stops.length - 1] ?? 200)) return 9
	for (let index = 0; index < stops.length - 1; index += 1) {
		const left = stops[index]
		const right = stops[index + 1]
		if (left !== undefined && right !== undefined && width <= right)
			return Math.round(index + 1 + (width - left) / (right - left))
	}
	return 5
}

function coordinates(
	record: PlistDictionary,
	definitions: readonly { name: string; tag: string }[],
): readonly number[] {
	const values = array(record.axesValues ?? record.axisValues).map(number)
	return definitions.map(
		(definition, index) =>
			values[index] ?? legacyCoordinate(record, definition.tag) ?? 0,
	)
}

function resolvedInstanceCoordinates(
	record: PlistDictionary,
	definitions: readonly { name: string; tag: string }[],
	rawMasters: readonly PlistDictionary[],
	masterCoordinates: readonly (readonly number[])[],
): readonly number[] {
	const values = array(record.axesValues ?? record.axisValues).map(number)
	const recipe = dictionary(record.instanceInterpolations)
	return definitions.map((definition, axisIndex) => {
		const direct = values[axisIndex] ?? legacyCoordinate(record, definition.tag)
		if (direct !== undefined) return direct
		if (recipe !== undefined) {
			let weighted = 0
			let total = 0
			for (
				let masterIndex = 0;
				masterIndex < rawMasters.length;
				masterIndex += 1
			) {
				const masterId = string(rawMasters[masterIndex]?.id)
				const factor =
					masterId === undefined ? undefined : number(recipe[masterId])
				if (factor === undefined) continue
				weighted += factor * (masterCoordinates[masterIndex]?.[axisIndex] ?? 0)
				total += factor
			}
			if (total !== 0) return weighted / total
		}
		return masterCoordinates[0]?.[axisIndex] ?? 0
	})
}

function masterMetric(
	root: PlistDictionary,
	master: PlistDictionary,
	type: string,
	legacyKey: string,
): { over: number; pos: number } | undefined {
	const metrics = dictionaries(root.metrics)
	const index = metrics.findIndex(
		(metric) => string(metric.type)?.trim().toLowerCase() === type,
	)
	const store =
		index < 0 ? undefined : dictionary(array(master.metricValues)[index])
	const position = number(store?.pos) ?? number(master[legacyKey])
	return position === undefined
		? undefined
		: { pos: position, over: Math.abs(number(store?.over) ?? 0) }
}

interface RawNode {
	readonly x: number
	readonly y: number
	readonly type: string
	readonly smooth: boolean
}

function parseNode(value: PlistValue): RawNode | undefined {
	if (Array.isArray(value)) {
		const x = number(value[0])
		const y = number(value[1])
		const configuration = string(value[2])
		if (
			x === undefined ||
			y === undefined ||
			configuration === undefined ||
			(value[3] !== undefined && dictionary(value[3]) === undefined)
		)
			return undefined
		const type =
			configuration[0] === "m"
				? "MOVE"
				: configuration[0] === "l"
					? "LINE"
					: configuration[0] === "c"
						? "CURVE"
						: configuration[0] === "q"
							? "QCURVE"
							: configuration[0] === "o"
								? "OFFCURVE"
								: undefined
		return type === undefined
			? undefined
			: { x, y, type, smooth: configuration.includes("s") }
	}
	const text = string(value)
	if (text === undefined) return undefined
	const match =
		/^\s*(-?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)\s+(-?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)\s+([A-Za-z]+)(?:\s+(SMOOTH))?\s*$/iu.exec(
			text,
		)
	if (match === null) return undefined
	return {
		x: Number(match[1]),
		y: Number(match[2]),
		type: match[3]?.toUpperCase() ?? "",
		smooth: match[4] !== undefined,
	}
}

type NativePoint = EditorGlyphLayerSource["contours"][number]["points"][number]
type NativeContour = EditorGlyphLayerSource["contours"][number]

function convertPath(
	path: PlistDictionary,
	idPrefix: string,
	diagnosticPath: string,
	errors: GlyphsImportDiagnostic[],
	softDowngrades: string[],
): NativeContour | undefined {
	const rawNodes = array(path.nodes).map(parseNode)
	if (rawNodes.some((node) => node === undefined)) {
		errors.push({
			severity: "error",
			code: "glyphs.invalid_node",
			path: `${diagnosticPath}.nodes`,
			message:
				"Every path node must contain finite x/y coordinates and a node type.",
		})
		return undefined
	}
	const nodes = rawNodes as RawNode[]
	const closed = enabled(path.closed, true)
	const onCurveIndices = nodes.flatMap((node, index) =>
		node.type === "OFFCURVE" ? [] : [index],
	)
	if (onCurveIndices.length === 0) {
		errors.push({
			severity: "error",
			code: "glyphs.invalid_node",
			path: `${diagnosticPath}.nodes`,
			message: "A contour must contain at least one on-curve node.",
		})
		return undefined
	}
	const points: NativePoint[] = onCurveIndices.map((nodeIndex, pointIndex) => {
		const node = nodes[nodeIndex] as RawNode
		return {
			id: `point:${idPrefix}:${pointIndex}`,
			mode: node.smooth ? "soft" : "hard",
			x: node.x,
			y: node.y,
		}
	})
	const segmentStart = closed ? 0 : 1
	for (
		let destinationIndex = segmentStart;
		destinationIndex < onCurveIndices.length;
		destinationIndex += 1
	) {
		const previousIndex =
			(destinationIndex - 1 + onCurveIndices.length) % onCurveIndices.length
		const fromNodeIndex = onCurveIndices[previousIndex] as number
		const toNodeIndex = onCurveIndices[destinationIndex] as number
		const controls: RawNode[] = []
		let cursor = (fromNodeIndex + 1) % nodes.length
		while (cursor !== toNodeIndex) {
			const control = nodes[cursor]
			if (control !== undefined) controls.push(control)
			cursor = (cursor + 1) % nodes.length
			if (!closed && cursor === 0) break
		}
		const from = points[previousIndex]
		const to = points[destinationIndex]
		const toNode = nodes[toNodeIndex]
		if (from === undefined || to === undefined || toNode === undefined) continue
		if (toNode.type === "CURVE" && controls.length === 2) {
			const first = controls[0] as RawNode
			const second = controls[1] as RawNode
			points[previousIndex] = {
				...from,
				outgoing: { x: first.x - from.x, y: first.y - from.y },
			}
			points[destinationIndex] = {
				...to,
				incoming: { x: second.x - to.x, y: second.y - to.y },
			}
		} else if (controls.length > 0 || !["LINE", "MOVE"].includes(toNode.type)) {
			errors.push({
				severity: "error",
				code: "glyphs.unsupported_curve",
				path: `${diagnosticPath}.nodes[${toNodeIndex}]`,
				message:
					"Only line segments and cubic curves with exactly two off-curve controls can be imported.",
			})
		}
	}
	for (let pointIndex = 0; pointIndex < points.length; pointIndex += 1) {
		const point = points[pointIndex]
		if (point === undefined || point.mode !== "soft") continue
		const { incoming, outgoing } = point
		const valid =
			incoming === undefined && outgoing === undefined
				? false
				: incoming === undefined || outgoing === undefined
					? true
					: (() => {
							const scale = Math.max(
								1,
								Math.hypot(incoming.x, incoming.y) *
									Math.hypot(outgoing.x, outgoing.y),
							)
							const cross = incoming.x * outgoing.y - incoming.y * outgoing.x
							const dot = incoming.x * outgoing.x + incoming.y * outgoing.y
							return Math.abs(cross) <= Number.EPSILON * 32 * scale && dot <= 0
						})()
		if (valid) continue
		points[pointIndex] = { ...point, mode: "hard" }
		softDowngrades.push(
			`${diagnosticPath}.nodes[${onCurveIndices[pointIndex] ?? pointIndex}]`,
		)
	}
	return { id: `contour:${idPrefix}`, closed, points }
}

interface Transform {
	readonly a: number
	readonly b: number
	readonly c: number
	readonly d: number
	readonly tx: number
	readonly ty: number
}

const identityTransform: Transform = { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 }

function parseTransform(value: PlistValue | undefined): Transform | undefined {
	if (value === undefined) return identityTransform
	const text = string(value)
	if (text === undefined) return undefined
	const values = text
		.replace(/[{}()]/gu, "")
		.split(",")
		.map((part) => Number(part.trim()))
	if (values.length !== 6 || values.some((item) => !Number.isFinite(item)))
		return undefined
	return {
		a: values[0] as number,
		b: values[1] as number,
		c: values[2] as number,
		d: values[3] as number,
		tx: values[4] as number,
		ty: values[5] as number,
	}
}

function tupleNumbers(
	value: PlistValue | undefined,
	length: number,
): readonly number[] | undefined {
	const values = array(value).map(number)
	return values.length === length && values.every((item) => item !== undefined)
		? (values as number[])
		: undefined
}

function componentTransform(shape: PlistDictionary): Transform | undefined {
	if (shape.transform !== undefined) return parseTransform(shape.transform)
	const position = tupleNumbers(shape.pos, 2) ?? [0, 0]
	const scale = tupleNumbers(shape.scale, 2) ?? [1, 1]
	const slant = tupleNumbers(shape.slant, 2) ?? [0, 0]
	const angle = number(shape.angle) ?? 0
	if (
		[...position, ...scale, ...slant, angle].some(
			(item) => !Number.isFinite(item),
		)
	)
		return undefined
	const horizontalSlant = Math.tan(((slant[0] ?? 0) * Math.PI) / 180)
	const verticalSlant = Math.tan(((slant[1] ?? 0) * Math.PI) / 180)
	const radians = (-angle * Math.PI) / 180
	const cosine = Math.cos(radians)
	const sine = Math.sin(radians)
	const a = scale[0] ?? 1
	const b = verticalSlant * a
	const d = scale[1] ?? 1
	const c = horizontalSlant * d
	return {
		a: cosine * a - sine * b,
		b: sine * a + cosine * b,
		c: cosine * c - sine * d,
		d: sine * c + cosine * d,
		tx: position[0] ?? 0,
		ty: position[1] ?? 0,
	}
}

function transformContour(
	contour: NativeContour,
	transform: Transform,
	id: string,
): NativeContour {
	const vector = (point: Readonly<{ x: number; y: number }>) => ({
		x: transform.a * point.x + transform.c * point.y,
		y: transform.b * point.x + transform.d * point.y,
	})
	return {
		...contour,
		id: `contour:${id}`,
		points: contour.points.map((point, pointIndex) => {
			const transformed = vector(point)
			return {
				...point,
				id: `point:${id}:${pointIndex}`,
				x: transformed.x + transform.tx,
				y: transformed.y + transform.ty,
				...(point.incoming === undefined
					? {}
					: { incoming: vector(point.incoming) }),
				...(point.outgoing === undefined
					? {}
					: { outgoing: vector(point.outgoing) }),
			}
		}),
	}
}

function layerShapes(layer: PlistDictionary): readonly PlistDictionary[] {
	const shapes = dictionaries(layer.shapes)
	return shapes.length > 0
		? shapes
		: [...dictionaries(layer.paths), ...dictionaries(layer.components)]
}

function featureSource(root: PlistDictionary): string | undefined {
	const chunks: string[] = []
	for (const item of dictionaries(root.classes)) {
		if (enabled(item.disabled, false)) continue
		const name = string(item.name)
		const code = string(item.code)
		if (name !== undefined && code !== undefined)
			chunks.push(`@${name} = [\n${code}\n];`)
	}
	for (const item of dictionaries(root.featurePrefixes)) {
		if (enabled(item.disabled, false)) continue
		const code = string(item.code)
		if (code !== undefined && code.trim() !== "") chunks.push(code)
	}
	for (const item of dictionaries(root.features)) {
		if (enabled(item.disabled, false)) continue
		const name = string(item.tag ?? item.name)
		const code = string(item.code)
		if (name !== undefined && code !== undefined)
			chunks.push(`feature ${name} {\n${code}\n} ${name};`)
	}
	return chunks.length === 0 ? undefined : `${chunks.join("\n\n")}\n`
}

function postScriptFamilyName(name: string): string {
	return name.normalize("NFKD").replace(/[^A-Za-z0-9]/gu, "") || "ImportedFont"
}

/** Lower one parsed Glyphs source document into validated create-font data. */
export function lowerGlyphsSource(
	document: GlyphsSourceDocument,
): GlyphsImportResult {
	const { formatVersion, root } = document
	const errors: GlyphsImportDiagnostic[] = []
	const warnings: GlyphsImportDiagnostic[] = []
	const softDowngrades: string[] = []
	const family = string(root.familyName)?.trim() || "Imported Font"
	const rawMasters = dictionaries(root.fontMaster ?? root.masters)
	if (rawMasters.length === 0) {
		return {
			ok: false,
			errors: [
				{
					severity: "error",
					code: "glyphs.invalid_value",
					path: "$.fontMaster",
					message: "The Glyphs source contains no font masters.",
				},
			],
		}
	}
	const definitions = axisDefinitions(root)
	const rawInstances = dictionaries(root.instances)
	const masterCoordinates = rawMasters.map((master) =>
		coordinates(master, definitions),
	)
	const instanceCoordinates = rawInstances.map((instance) =>
		resolvedInstanceCoordinates(
			instance,
			definitions,
			rawMasters,
			masterCoordinates,
		),
	)
	const declaredDefaults = definitions.map(
		(definition) => definition.defaultValue,
	)
	const namedRegularIndex = rawMasters.findIndex(
		(master) => (string(master.name) ?? string(master.weight)) === "Regular",
	)
	let defaultMasterIndex = namedRegularIndex >= 0 ? namedRegularIndex : 0
	if (declaredDefaults.some((value) => value !== undefined)) {
		const matchingMasterIndices = masterCoordinates.flatMap(
			(location, index) =>
				declaredDefaults.every(
					(target, axisIndex) =>
						target === undefined || (location[axisIndex] ?? 0) === target,
				)
					? [index]
					: [],
		)
		if (matchingMasterIndices.length === 0)
			return {
				ok: false,
				errors: [
					{
						severity: "error",
						code: "glyphs.invalid_value",
						path: "$.axes",
						message:
							"Declared axis defaults must exactly match one font master; interpolating a complete default source is not supported.",
					},
				],
			}
		defaultMasterIndex = matchingMasterIndices.includes(namedRegularIndex)
			? namedRegularIndex
			: (matchingMasterIndices[0] as number)
	}
	const masterIds = rawMasters.map(
		(master, index) =>
			`master:${identifier(string(master.id) ?? `master-${index + 1}`)}` as const,
	)
	const axes: EditorAxisSource[] = definitions.map((definition, axisIndex) => {
		const values = [...masterCoordinates, ...instanceCoordinates].map(
			(location) => location[axisIndex] ?? 0,
		)
		const defaultValue =
			definition.defaultValue ?? values[defaultMasterIndex] ?? 0
		return {
			id: `axis:${identifier(definition.tag)}`,
			tag: definition.tag,
			name: definition.name,
			min: Math.min(defaultValue, ...values),
			default: defaultValue,
			max: Math.max(defaultValue, ...values),
			...(definition.hidden === undefined ? {} : { hidden: definition.hidden }),
		}
	})
	const masters: EditorMasterSource[] = rawMasters.map((master, index) => {
		const id = masterIds[index] as (typeof masterIds)[number]
		const name =
			string(master.name) ?? string(master.weight) ?? `Master ${index + 1}`
		if (index === defaultMasterIndex) return { id, kind: "default", name }
		return {
			id,
			kind: "source",
			name,
			location: Object.fromEntries(
				axes.map((axis, axisIndex) => [
					axis.id,
					masterCoordinates[index]?.[axisIndex] ?? 0,
				]),
			),
			support: { kind: "non-intermediate" },
		}
	})
	const rawGlyphs = dictionaries(root.glyphs)
	let componentCount = 0
	let firstComponentPath: string | undefined
	let firstAnchorPath: string | undefined
	let firstGuidePath: string | undefined
	let firstSpecialLayerPath: string | undefined
	let firstBackgroundPath: string | undefined
	const knownMasterIds = new Set(
		rawMasters.flatMap((master) => string(master.id) ?? []),
	)
	const glyphByName = new Map<string, PlistDictionary>()
	const glyphIndexByName = new Map<string, number>()
	for (const [index, glyph] of rawGlyphs.entries()) {
		const name = string(glyph.glyphname ?? glyph.glyphName)
		if (name === undefined || name === "") {
			errors.push({
				severity: "error",
				code: "glyphs.invalid_value",
				path: `$.glyphs[${index}].glyphname`,
				message: "Every glyph must have a non-empty glyph name.",
			})
			continue
		}
		if (glyphByName.has(name)) {
			errors.push({
				severity: "error",
				code: "glyphs.invalid_value",
				path: `$.glyphs[${index}].glyphname`,
				message: `Glyph name ${JSON.stringify(name)} is duplicated.`,
			})
			continue
		}
		glyphByName.set(name, glyph)
		glyphIndexByName.set(name, index)
		for (const [layerIndex, layer] of dictionaries(glyph.layers).entries()) {
			const layerPath = `$.glyphs[${index}].layers[${layerIndex}]`
			if (array(layer.anchors).length > 0 && firstAnchorPath === undefined)
				firstAnchorPath = `${layerPath}.anchors`
			if (
				array(layer.guides ?? layer.guideLines).length > 0 &&
				firstGuidePath === undefined
			)
				firstGuidePath = `${layerPath}.guides`
			if (layer.background !== undefined && firstBackgroundPath === undefined)
				firstBackgroundPath = `${layerPath}.background`
			const layerId = string(layer.layerId)
			if (
				layerId !== undefined &&
				!knownMasterIds.has(layerId) &&
				firstSpecialLayerPath === undefined
			)
				firstSpecialLayerPath = layerPath
			for (const [shapeIndex, shape] of layerShapes(layer).entries()) {
				if (
					shape.nodes !== undefined ||
					string(shape.ref ?? shape.name) === undefined
				)
					continue
				componentCount += 1
				firstComponentPath ??= `${layerPath}.shapes[${shapeIndex}]`
			}
		}
	}
	if (firstComponentPath !== undefined)
		warnings.push({
			severity: "warning",
			code: "glyphs.unsupported_data",
			path: firstComponentPath,
			message: `${componentCount} component shape${componentCount === 1 ? " was" : "s were"} expanded to contours; component editability is not represented by create-font.`,
		})
	for (const [path, message] of [
		[
			firstAnchorPath,
			"Anchors are not represented by create-font and were omitted.",
		],
		[
			firstGuidePath,
			"Layer guides are not represented by create-font and were omitted.",
		],
		[
			firstBackgroundPath,
			"Layer backgrounds are not represented by create-font and were omitted.",
		],
		[
			firstSpecialLayerPath,
			"Brace, bracket, color, and other non-master layers are not represented by create-font and were omitted.",
		],
	] as const) {
		if (path !== undefined)
			warnings.push({
				severity: "warning",
				code: "glyphs.unsupported_data",
				path,
				message,
			})
	}

	const componentLayerCache = new Map<string, readonly NativeContour[]>()
	const maximumComponentDepth = 64
	const maximumLayerContours = 10_000
	const maximumLayerPoints = 2_000_000
	const contoursForLayer = (
		glyphName: string,
		masterId: string,
		stack: readonly string[] = [],
	): readonly NativeContour[] => {
		const cacheKey = `${glyphName}\0${masterId}`
		const cached = componentLayerCache.get(cacheKey)
		if (cached !== undefined) return cached
		if (stack.length >= maximumComponentDepth) {
			errors.push({
				severity: "error",
				code: "glyphs.resource_limit",
				path: `$.glyphs[${glyphIndexByName.get(glyphName) ?? 0}]`,
				message: `Component nesting exceeds the maximum depth of ${maximumComponentDepth}.`,
			})
			return []
		}
		if (stack.includes(glyphName)) {
			errors.push({
				severity: "error",
				code: "glyphs.component_cycle",
				path: `$.glyphs[${glyphIndexByName.get(glyphName) ?? 0}]`,
				message: `Component cycle detected: ${[...stack, glyphName].join(" -> ")}.`,
			})
			return []
		}
		const glyph = glyphByName.get(glyphName)
		if (glyph === undefined) {
			errors.push({
				severity: "error",
				code: "glyphs.missing_component",
				path: "$",
				message: `Component glyph ${JSON.stringify(glyphName)} does not exist.`,
			})
			return []
		}
		const layers = dictionaries(glyph.layers)
		const layerIndex = layers.findIndex(
			(item) => string(item.layerId ?? item.associatedMasterId) === masterId,
		)
		const layer = layers[layerIndex]
		if (layer === undefined) {
			errors.push({
				severity: "error",
				code: "glyphs.missing_layer",
				path: `$.glyphs[${glyphIndexByName.get(glyphName) ?? 0}].layers`,
				message: `Glyph ${JSON.stringify(glyphName)} has no geometry for master ${JSON.stringify(masterId)}.`,
			})
			return []
		}
		const layerPath = `$.glyphs[${glyphIndexByName.get(glyphName) ?? 0}].layers[${layerIndex}]`
		const contours: NativeContour[] = []
		let pointCount = 0
		for (const [shapeIndex, shape] of layerShapes(layer).entries()) {
			const nodes = shape.nodes
			if (nodes !== undefined) {
				const contour = convertPath(
					shape,
					`${identifier(glyphName)}:${identifier(masterId)}:${shapeIndex}`,
					`${layerPath}.shapes[${shapeIndex}]`,
					errors,
					softDowngrades,
				)
				if (contour !== undefined) {
					if (pointCount + contour.points.length > maximumLayerPoints) {
						errors.push({
							severity: "error",
							code: "glyphs.resource_limit",
							path: `${layerPath}.shapes[${shapeIndex}]`,
							message: `Expanded component layer exceeds ${maximumLayerPoints.toLocaleString("en-US")} points.`,
						})
						break
					}
					pointCount += contour.points.length
					contours.push(contour)
				}
				continue
			}
			const reference = string(shape.ref ?? shape.name)
			if (reference === undefined) continue
			if (!glyphByName.has(reference)) {
				errors.push({
					severity: "error",
					code: "glyphs.missing_component",
					path: `${layerPath}.shapes[${shapeIndex}]`,
					message: `Component ${JSON.stringify(reference)} does not refer to an imported glyph.`,
				})
				continue
			}
			const transform = componentTransform(shape)
			if (transform === undefined) {
				errors.push({
					severity: "error",
					code: "glyphs.invalid_value",
					path: `${layerPath}.shapes[${shapeIndex}].transform`,
					message:
						"A component transform must contain finite legacy affine values or finite v3 position, scale, angle, and slant values.",
				})
				continue
			}
			for (const [componentContourIndex, contour] of contoursForLayer(
				reference,
				masterId,
				[...stack, glyphName],
			).entries()) {
				if (
					contours.length >= maximumLayerContours ||
					pointCount + contour.points.length > maximumLayerPoints
				) {
					errors.push({
						severity: "error",
						code: "glyphs.resource_limit",
						path: `${layerPath}.shapes[${shapeIndex}]`,
						message:
							contours.length >= maximumLayerContours
								? `Expanded component layer exceeds ${maximumLayerContours.toLocaleString("en-US")} contours.`
								: `Expanded component layer exceeds ${maximumLayerPoints.toLocaleString("en-US")} points.`,
					})
					break
				}
				pointCount += contour.points.length
				contours.push(
					transformContour(
						contour,
						transform,
						`${identifier(glyphName)}:${identifier(masterId)}:${shapeIndex}:${componentContourIndex}`,
					),
				)
			}
		}
		componentLayerCache.set(cacheKey, contours)
		return contours
	}
	// Glyphs permits approximately smooth handles. Native soft nodes have an
	// exact geometric invariant, so keep their geometry and relax only the mode.
	// This is summarized to keep large imports actionable instead of noisy.

	const glyphs: EditorGlyphSource[] = []
	const cmap: EditorFontSource["cmap"][number][] = []
	const glyphNameById = new Map<string, string>()
	let omittedUnexportedUnicodeCount = 0
	let firstUnexportedUnicodePath: string | undefined
	for (const [glyphIndex, [name, glyph]] of [...glyphByName].entries()) {
		const layers: EditorGlyphLayerSource[] = []
		for (
			let masterIndex = 0;
			masterIndex < rawMasters.length;
			masterIndex += 1
		) {
			const sourceMasterId = string(rawMasters[masterIndex]?.id)
			const masterId = masterIds[masterIndex]
			if (sourceMasterId === undefined || masterId === undefined) continue
			const layer = dictionaries(glyph.layers).find(
				(item) =>
					string(item.layerId ?? item.associatedMasterId) === sourceMasterId,
			)
			if (layer === undefined) {
				errors.push({
					severity: "error",
					code: "glyphs.missing_layer",
					path: `$.glyphs[${glyphIndex}].layers`,
					message: `Glyph ${JSON.stringify(name)} has no geometry for master ${JSON.stringify(sourceMasterId)}.`,
				})
				continue
			}
			const contours = contoursForLayer(name, sourceMasterId)
			const minimumX = contours.flatMap((contour) =>
				contour.points.map((point) => point.x),
			)
			layers.push({
				masterId,
				advanceWidth: number(layer.width) ?? 0,
				leftSideBearing:
					number(layer.LSB) ??
					(minimumX.length === 0 ? 0 : Math.min(...minimumX)),
				contours,
			})
		}
		const id = `glyph:${identifier(name)}` as const
		const collidingName = glyphNameById.get(id)
		if (collidingName !== undefined) {
			errors.push({
				severity: "error",
				code: "glyphs.invalid_value",
				path: `$.glyphs[${glyphIndexByName.get(name) ?? glyphIndex}].glyphname`,
				message: `Glyph names ${JSON.stringify(collidingName)} and ${JSON.stringify(name)} map to the same create-font ID ${JSON.stringify(id)}.`,
			})
			continue
		}
		glyphNameById.set(id, name)
		const note = string(glyph.note)
		const glyphExports = enabled(glyph.export, true)
		glyphs.push({
			id,
			name,
			export: glyphExports,
			...(note === undefined ? {} : { note }),
			layers,
		})
		const rawUnicode = glyph.unicode ?? glyph.unicodes
		const unicodeValues = Array.isArray(rawUnicode)
			? rawUnicode.flatMap((item) => string(item) ?? [])
			: string(rawUnicode) === undefined
				? []
				: [string(rawUnicode) as string]
		for (const unicode of unicodeValues) {
			const syntax = formatVersion >= 3 ? /^[0-9]+$/u : /^[0-9A-Fa-f]+$/u
			const codePoint = syntax.test(unicode)
				? Number.parseInt(unicode, formatVersion >= 3 ? 10 : 16)
				: Number.NaN
			if (
				!Number.isInteger(codePoint) ||
				codePoint < 0 ||
				codePoint > 0x10ffff ||
				(codePoint >= 0xd800 && codePoint <= 0xdfff)
			) {
				errors.push({
					severity: "error",
					code: "glyphs.invalid_value",
					path: `$.glyphs[${glyphIndex}].unicode`,
					message: `Unicode value ${JSON.stringify(unicode)} is not a valid ${formatVersion >= 3 ? "decimal" : "hexadecimal"} scalar value for Glyphs format ${formatVersion}.`,
				})
				continue
			}
			if (!glyphExports) {
				omittedUnexportedUnicodeCount += 1
				firstUnexportedUnicodePath ??= `$.glyphs[${glyphIndexByName.get(name) ?? glyphIndex}].unicode`
				continue
			}
			cmap.push({ codePoint, glyphId: id })
		}
	}
	if (firstUnexportedUnicodePath !== undefined)
		warnings.push({
			severity: "warning",
			code: "glyphs.unsupported_data",
			path: firstUnexportedUnicodePath,
			message: `${omittedUnexportedUnicodeCount} Unicode mapping${omittedUnexportedUnicodeCount === 1 ? " was" : "s were"} omitted because exported fonts cannot map characters to non-exporting glyphs.`,
		})
	const glyphOrder = array(customParameters(root).get("glyphOrder")).flatMap(
		(item) => string(item) ?? [],
	)
	if (glyphOrder.length > 0) {
		const order = new Map(glyphOrder.map((name, index) => [name, index]))
		glyphs.sort(
			(a, b) =>
				(order.get(a.name) ?? Number.MAX_SAFE_INTEGER) -
				(order.get(b.name) ?? Number.MAX_SAFE_INTEGER),
		)
	}
	const notdefIndex = glyphs.findIndex((glyph) => glyph.name === ".notdef")
	if (notdefIndex < 0) {
		glyphs.unshift({
			id: "glyph:.notdef",
			name: ".notdef",
			export: true,
			layers: masterIds.map((masterId) => ({
				masterId,
				advanceWidth: Math.round((number(root.unitsPerEm) ?? 1000) / 2),
				leftSideBearing: 0,
				contours: [],
			})),
		})
		warnings.push({
			severity: "warning",
			code: "glyphs.unsupported_data",
			path: "$.glyphs",
			message:
				"A minimal .notdef glyph was synthesized at glyph ID 0 because the Glyphs source did not contain one.",
		})
	} else if (notdefIndex > 0) {
		const [notdef] = glyphs.splice(notdefIndex, 1)
		if (notdef !== undefined) glyphs.unshift(notdef)
	}
	if (softDowngrades.length > 0)
		warnings.push({
			severity: "warning",
			code: "glyphs.unsupported_data",
			path: softDowngrades[0] as string,
			message: `${softDowngrades.length} approximately smooth node${softDowngrades.length === 1 ? " was" : "s were"} preserved geometrically and imported as hard because create-font soft handles must be exactly collinear and opposed.`,
		})

	const defaultMaster = rawMasters[defaultMasterIndex] as PlistDictionary
	const defaultMasterId = string(defaultMaster.id) ?? ""
	const kerning: NonNullable<EditorFontSource["kerning"]>[number][] = []
	const kerningSource = dictionary(root.kerningLTR ?? root.kerning)
	const defaultKerning = dictionary(kerningSource?.[defaultMasterId])
	const kerningMasters = Object.keys(kerningSource ?? {})
	if (kerningMasters.some((masterId) => masterId !== defaultMasterId))
		warnings.push({
			severity: "warning",
			code: "glyphs.unsupported_kerning",
			path: "$.kerning",
			message:
				"Only default-master kerning is represented by create-font; other masters were omitted.",
		})
	if (defaultKerning !== undefined) {
		const glyphIdByName = new Map(glyphs.map((glyph) => [glyph.name, glyph.id]))
		const leftGroups = new Map<string, string[]>()
		const rightGroups = new Map<string, string[]>()
		for (const glyph of rawGlyphs) {
			const name = string(glyph.glyphname ?? glyph.glyphName)
			const id = name === undefined ? undefined : glyphIdByName.get(name)
			if (id === undefined) continue
			const left = string(glyph.kernLeft ?? glyph.leftKerningGroup)
			const right = string(glyph.kernRight ?? glyph.rightKerningGroup)
			if (left !== undefined)
				leftGroups.set(left, [...(leftGroups.get(left) ?? []), id])
			if (right !== undefined)
				rightGroups.set(right, [...(rightGroups.get(right) ?? []), id])
		}
		const operands = (
			key: string,
			side: "left" | "right",
		): readonly string[] => {
			const direct = glyphIdByName.get(key)
			if (direct !== undefined) return [direct]
			const match = /^@MMK_[LR]_(.*)$/u.exec(key)
			if (match === null) return []
			return (
				(side === "left" ? rightGroups : leftGroups).get(match[1] ?? "") ?? []
			)
		}
		const pairs = new Map<string, (typeof kerning)[number]>()
		const pairPriorities = new Map<string, number>()
		for (const [leftKey, rightValue] of Object.entries(defaultKerning)) {
			const rightRecord = dictionary(rightValue)
			if (rightRecord === undefined) continue
			for (const [rightKey, rawValue] of Object.entries(rightRecord)) {
				const amount = number(rawValue)
				const leftIds = operands(leftKey, "left")
				const rightIds = operands(rightKey, "right")
				if (
					amount === undefined ||
					leftIds.length === 0 ||
					rightIds.length === 0
				) {
					warnings.push({
						severity: "warning",
						code: "glyphs.unsupported_kerning",
						path: `$.kerning[${JSON.stringify(defaultMasterId)}][${JSON.stringify(leftKey)}][${JSON.stringify(rightKey)}]`,
						message:
							"Kerning with an unknown glyph/group or non-numeric value was omitted.",
					})
					continue
				}
				for (const left of leftIds) {
					for (const right of rightIds) {
						const value = Math.max(
							-32_768,
							Math.min(32_767, Math.round(amount)),
						)
						const pairKey = `${left}\0${right}`
						const priority =
							(glyphIdByName.has(leftKey) ? 1 : 0) +
							(glyphIdByName.has(rightKey) ? 1 : 0)
						if ((pairPriorities.get(pairKey) ?? -1) > priority) continue
						pairPriorities.set(pairKey, priority)
						pairs.set(pairKey, {
							left: left as `glyph:${string}`,
							right: right as `glyph:${string}`,
							value,
						})
					}
				}
			}
		}
		kerning.push(...pairs.values())
		if (leftGroups.size > 0 || rightGroups.size > 0)
			warnings.push({
				severity: "warning",
				code: "glyphs.unsupported_kerning",
				path: `$.kerning[${JSON.stringify(defaultMasterId)}]`,
				message:
					"Kerning classes were expanded to explicit pairs; class editability is not represented by create-font.",
			})
	}

	const instances: EditorInstanceSource[] = rawInstances.map(
		(instance, index) => {
			const postScriptName = string(
				instance.postscriptFontName ?? instance.postScriptName,
			)
			return {
				id: `instance:${identifier(string(instance.name) ?? `instance-${index + 1}`)}`,
				name: string(instance.name) ?? `Instance ${index + 1}`,
				coordinates: Object.fromEntries(
					axes.map((axis, axisIndex) => [
						axis.id,
						instanceCoordinates[index]?.[axisIndex] ?? axis.default,
					]),
				),
				...(postScriptName === undefined ? {} : { postScriptName }),
			}
		},
	)
	const parameterizedInstanceIndex = rawInstances.findIndex(
		(instance) =>
			array(instance.customParameters).length > 0 ||
			instance.instanceInterpolations !== undefined,
	)
	if (parameterizedInstanceIndex >= 0)
		warnings.push({
			severity: "warning",
			code: "glyphs.unsupported_data",
			path: `$.instances[${parameterizedInstanceIndex}]`,
			message:
				"Instance export parameters and interpolation recipes are not represented by create-font; design coordinates were preserved.",
		})
	const metricsByMaster = rawMasters.map((master) => ({
		ascender: masterMetric(root, master, "ascender", "ascender"),
		capHeight: masterMetric(root, master, "cap height", "capHeight"),
		descender: masterMetric(root, master, "descender", "descender"),
		italicAngle: masterMetric(root, master, "italic angle", "italicAngle"),
		xHeight: masterMetric(root, master, "x-height", "xHeight"),
	}))
	if (
		metricsByMaster.some((metrics) =>
			(["ascender", "capHeight", "descender", "xHeight"] as const).some(
				(key) =>
					metrics[key]?.pos !== metricsByMaster[defaultMasterIndex]?.[key]?.pos,
			),
		)
	)
		warnings.push({
			severity: "warning",
			code: "glyphs.unsupported_data",
			path: "$.fontMaster",
			message:
				"Per-master vertical metrics are not represented by create-font; the default master's metrics were preserved.",
		})
	const parameters = customParameters(root)
	const defaultMetrics = metricsByMaster[defaultMasterIndex]
	const subfamily =
		string(defaultMaster.name) ?? string(defaultMaster.weight) ?? "Regular"
	const major = number(root.versionMajor) ?? 1
	const minor = number(root.versionMinor) ?? 0
	const revision = major + minor / 1000
	const ascender = defaultMetrics?.ascender?.pos ?? 800
	const descender = defaultMetrics?.descender?.pos ?? -200
	const xHeight = defaultMetrics?.xHeight?.pos ?? Math.round(ascender * 0.625)
	const capHeight =
		defaultMetrics?.capHeight?.pos ?? Math.round(ascender * 0.875)
	const axisDefault = (tag: string): number | undefined =>
		axes.find((axis) => axis.tag === tag)?.default
	const slantDefault = axisDefault("slnt")
	const italicDefault = axisDefault("ital")
	const italicAngle =
		slantDefault ??
		number(root.italicAngle) ??
		defaultMetrics?.italicAngle?.pos ??
		0
	let outlineMaximumY = 0
	let outlineMinimumY = 0
	for (const glyph of glyphs) {
		for (const layer of glyph.layers) {
			for (const contour of layer.contours) {
				for (const point of contour.points) {
					for (const y of [
						point.y,
						...(point.incoming === undefined
							? []
							: [point.y + point.incoming.y]),
						...(point.outgoing === undefined
							? []
							: [point.y + point.outgoing.y]),
					]) {
						outlineMaximumY = Math.max(outlineMaximumY, y)
						outlineMinimumY = Math.min(outlineMinimumY, y)
					}
				}
			}
		}
	}
	const metricAscenders = metricsByMaster.flatMap((metrics) =>
		metrics.ascender === undefined ? [] : [metrics.ascender.pos],
	)
	const metricDescenders = metricsByMaster.flatMap((metrics) =>
		metrics.descender === undefined ? [] : [metrics.descender.pos],
	)
	const winAscent = Math.ceil(
		Math.max(0, ascender, ...metricAscenders, outlineMaximumY),
	)
	const winDescent = Math.ceil(
		Math.max(
			0,
			-descender,
			...metricDescenders.map((value) => -value),
			-outlineMinimumY,
		),
	)
	const weightAxisIndex = definitions.findIndex(
		(definition) => definition.tag === "wght",
	)
	const defaultWeight =
		axisDefault("wght") ??
		number(defaultMaster.weightValue) ??
		(weightAxisIndex < 0
			? 400
			: (masterCoordinates[defaultMasterIndex]?.[weightAxisIndex] ?? 400))
	const widthDefault = axisDefault("wdth")
	const italic =
		italicDefault === undefined
			? slantDefault === undefined && italicAngle !== 0
			: italicDefault !== 0
	const overshootDepth = (value: number | undefined): number =>
		Math.min(16_383, Math.max(0, Math.round(Math.abs(value ?? 0))))
	const source: EditorFontSource = {
		format: "create-font.editor",
		editorVersion: 5,
		metadata: {
			unitsPerEm: number(root.unitsPerEm) ?? 1000,
			fontRevision: revision,
			vendorId: string(parameters.get("vendorID")) ?? "NONE",
			lowestPpem: number(parameters.get("lowestRecPPEM")) ?? 8,
		},
		names: {
			family,
			subfamily,
			uniqueId: `${family}:${subfamily}:${revision.toFixed(3)}`,
			fullName: `${family} ${subfamily}`,
			version: `Version ${revision.toFixed(3)}`,
			postScriptName: `${postScriptFamilyName(family)}-${postScriptFamilyName(subfamily)}`,
			typographicFamily: family,
			typographicSubfamily: subfamily,
		},
		metrics: {
			ascender,
			descender,
			lineGap: 0,
			winAscent,
			winDescent,
			xHeight,
			capHeight,
			underlinePosition: number(parameters.get("underlinePosition")) ?? -100,
			underlineThickness: number(parameters.get("underlineThickness")) ?? 50,
			overshoots: {
				baseline: overshootDepth(
					masterMetric(root, defaultMaster, "baseline", "baseline")?.over,
				),
				ascender: overshootDepth(defaultMetrics?.ascender?.over),
				descender: overshootDepth(defaultMetrics?.descender?.over),
				winAscent: 0,
				winDescent: 0,
				xHeight: overshootDepth(defaultMetrics?.xHeight?.over),
				capHeight: overshootDepth(defaultMetrics?.capHeight?.over),
				underlinePosition: 0,
			},
		},
		style: {
			weightClass: defaultWeight,
			widthClass:
				widthDefault === undefined ? 5 : widthClassForWidth(widthDefault),
			italic,
			bold: defaultWeight >= 700,
			oblique: slantDefault !== undefined && slantDefault !== 0 && !italic,
			italicAngle,
		},
		axes,
		masters,
		defaultMasterId: masterIds[
			defaultMasterIndex
		] as (typeof masterIds)[number],
		instances,
		glyphs,
		cmap,
		...(kerning.length === 0 ? {} : { kerning }),
	}
	if (errors.length > 0)
		return {
			ok: false,
			errors: errors as [GlyphsImportDiagnostic, ...GlyphsImportDiagnostic[]],
		}
	const validated = validateEditorFontSource(source)
	if (!validated.ok) {
		return {
			ok: false,
			errors: validated.errors.map((error) => ({
				severity: "error",
				code: "glyphs.invalid_value",
				path: error.path,
				message: `Imported source is invalid: ${error.message}`,
			})) as [GlyphsImportDiagnostic, ...GlyphsImportDiagnostic[]],
		}
	}
	const candidateFeatureSource = featureSource(root)
	let importedFeatureSource: string | undefined
	if (candidateFeatureSource !== undefined) {
		const analysis = analyzeFeaProject({
			entries: ["features/glyphs-import.fea"],
			glyphs: validated.value.glyphs.map((glyph, id) => ({
				id,
				name: glyph.name,
				export: glyph.export,
			})),
			sources: new Map([
				["features/glyphs-import.fea", candidateFeatureSource],
			]),
		})
		if (analysis.ok) importedFeatureSource = candidateFeatureSource
		else {
			const first = analysis.diagnostics.find(
				(diagnostic) => diagnostic.severity === "error",
			)
			warnings.push({
				severity: "warning",
				code: "glyphs.unsupported_feature",
				path: "$.features",
				message: `Glyphs feature source is not in create-font's supported semantic subset and was omitted${first === undefined ? "." : `: ${first.message}`}`,
			})
		}
	}
	return {
		ok: true,
		value: {
			source: validated.value,
			...(importedFeatureSource === undefined
				? {}
				: { featureSource: importedFeatureSource }),
			warnings,
		},
	}
}
