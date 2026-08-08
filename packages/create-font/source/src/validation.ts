import type {
	AxisId,
	ContourId,
	EditorAxisMapEntrySource,
	EditorAxisSource,
	EditorCmapEntrySource,
	EditorContourSource,
	EditorFontSource,
	EditorGlyphLayerSource,
	EditorGlyphSource,
	EditorHandleVectorSource,
	EditorInstanceSource,
	EditorKerningPairSource,
	EditorLayerPointSource,
	EditorLocationSource,
	EditorMasterSource,
	EditorMasterSupportSource,
	EditorPointSource,
	EditorRuleSource,
	GlyphId,
	InstanceId,
	MasterId,
	PointId,
	RuleId,
} from "@create-font/states"

import { diagnostic, failure, success } from "./result.ts"
import {
	CREATE_FONT_EDITOR_FORMAT,
	CREATE_FONT_EDITOR_VERSION,
	type SourceDiagnostic,
	type SourceResult,
} from "./types.ts"

const LEGACY_EDITOR_VERSION = 3 as const
const SHARED_TOPOLOGY_EDITOR_VERSION = 4 as const
const MAX_OVERSHOOT_DEPTH = 16_383

type TimestampMode = "file" | "state"
type SafeRecord = Readonly<Record<string, unknown>>

const ABSENT = Symbol("absent")
const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"])

interface ValidationContext {
	readonly errors: SourceDiagnostic[]
}

function add(
	context: ValidationContext,
	code: SourceDiagnostic["code"],
	path: string,
	message: string,
): void {
	context.errors.push(diagnostic(code, path, message))
}

function propertyPath(parent: string, key: string): string {
	return !UNSAFE_KEYS.has(key) && /^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(key)
		? `${parent}.${key}`
		: `${parent}[${JSON.stringify(key)}]`
}

function objectValue(
	value: unknown,
	path: string,
	context: ValidationContext,
): SafeRecord | null {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		add(context, "source.object", path, "Expected a plain JSON object.")
		return null
	}
	const prototype = Object.getPrototypeOf(value)
	if (prototype !== Object.prototype && prototype !== null) {
		add(
			context,
			"source.object",
			path,
			"Expected an object with the ordinary or null prototype.",
		)
		return null
	}

	const normalized = Object.create(null) as Record<string, unknown>
	for (const key of Reflect.ownKeys(value)) {
		if (typeof key !== "string") {
			add(
				context,
				"source.unknown_property",
				path,
				"Symbol properties cannot be represented in a source file.",
			)
			continue
		}
		const keyPath = propertyPath(path, key)
		if (UNSAFE_KEYS.has(key)) {
			add(
				context,
				"json.unsafe_key",
				keyPath,
				`Object property ${JSON.stringify(key)} is not safe source data.`,
			)
		}
		const descriptor = Object.getOwnPropertyDescriptor(value, key)
		if (
			descriptor === undefined ||
			!("value" in descriptor) ||
			!descriptor.enumerable
		) {
			add(
				context,
				"source.object",
				keyPath,
				"Source properties must be enumerable data properties.",
			)
			continue
		}
		normalized[key] = descriptor.value
	}
	return normalized
}

function arrayValue(
	value: unknown,
	path: string,
	context: ValidationContext,
): readonly unknown[] | null {
	if (!Array.isArray(value)) {
		add(context, "source.array", path, "Expected a JSON array.")
		return null
	}
	if (Object.getPrototypeOf(value) !== Array.prototype) {
		add(
			context,
			"source.array",
			path,
			"Expected an array with the ordinary Array prototype.",
		)
		return null
	}
	const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length")
	if (
		lengthDescriptor === undefined ||
		!("value" in lengthDescriptor) ||
		typeof lengthDescriptor.value !== "number" ||
		!Number.isInteger(lengthDescriptor.value) ||
		lengthDescriptor.value < 0 ||
		lengthDescriptor.value > 0xffff_ffff
	) {
		add(context, "source.array", path, "Array length is not a valid uint32.")
		return null
	}
	const length = lengthDescriptor.value
	const indexedEntries: { readonly index: number; readonly value: unknown }[] =
		[]
	for (const key of Reflect.ownKeys(value)) {
		if (key === "length") continue
		if (typeof key === "string" && /^(?:0|[1-9][0-9]*)$/u.test(key)) {
			const index = Number(key)
			if (index >= length || index >= 0xffff_ffff) {
				add(
					context,
					"source.unknown_property",
					propertyPath(path, key),
					"Array index lies outside its declared length.",
				)
				continue
			}
			const descriptor = Object.getOwnPropertyDescriptor(value, key)
			if (
				descriptor === undefined ||
				!("value" in descriptor) ||
				!descriptor.enumerable
			) {
				add(
					context,
					"source.array",
					`${path}[${index}]`,
					"Array entries must be enumerable data properties.",
				)
				continue
			}
			indexedEntries.push({ index, value: descriptor.value })
			continue
		}
		add(
			context,
			"source.unknown_property",
			path,
			"Source arrays cannot carry named or symbol properties.",
		)
	}
	if (indexedEntries.length !== length) {
		add(
			context,
			"source.array",
			path,
			`Source arrays must be dense; length is ${length} but ${indexedEntries.length} indexed entries exist.`,
		)
		return null
	}
	indexedEntries.sort((left, right) => left.index - right.index)
	for (let index = 0; index < indexedEntries.length; index += 1) {
		if (indexedEntries[index]?.index !== index) {
			add(
				context,
				"source.array",
				path,
				"Source arrays must use contiguous zero-based indexes.",
			)
			return null
		}
	}
	return indexedEntries.map((entry) => entry.value)
}

function checkShape(
	record: SafeRecord,
	allowed: readonly string[],
	path: string,
	context: ValidationContext,
): void {
	const allowedKeys = new Set(allowed)
	for (const key of Object.keys(record)) {
		if (!allowedKeys.has(key)) {
			add(
				context,
				"source.unknown_property",
				propertyPath(path, key),
				`Unknown property ${JSON.stringify(key)}.`,
			)
		}
	}
}

function requiredField(
	record: SafeRecord,
	key: string,
	path: string,
	context: ValidationContext,
): unknown | typeof ABSENT {
	if (!Object.hasOwn(record, key)) {
		add(
			context,
			"source.missing_property",
			propertyPath(path, key),
			`Missing required property ${JSON.stringify(key)}.`,
		)
		return ABSENT
	}
	return record[key]
}

function stringValue(
	value: unknown,
	path: string,
	context: ValidationContext,
): string {
	if (typeof value !== "string") {
		add(context, "source.string", path, "Expected a string.")
		return ""
	}
	return value
}

function requiredString(
	record: SafeRecord,
	key: string,
	path: string,
	context: ValidationContext,
): string {
	const keyPath = propertyPath(path, key)
	const value = requiredField(record, key, path, context)
	return value === ABSENT ? "" : stringValue(value, keyPath, context)
}

function optionalString(
	record: SafeRecord,
	key: string,
	path: string,
	context: ValidationContext,
): string | undefined {
	if (!Object.hasOwn(record, key)) return undefined
	return stringValue(record[key], propertyPath(path, key), context)
}

function numberValue(
	value: unknown,
	path: string,
	context: ValidationContext,
): number {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		add(context, "source.number", path, "Expected a finite number.")
		return 0
	}
	return value
}

function requiredNumber(
	record: SafeRecord,
	key: string,
	path: string,
	context: ValidationContext,
): number {
	const keyPath = propertyPath(path, key)
	const value = requiredField(record, key, path, context)
	return value === ABSENT ? 0 : numberValue(value, keyPath, context)
}

function booleanValue(
	value: unknown,
	path: string,
	context: ValidationContext,
): boolean {
	if (typeof value !== "boolean") {
		add(context, "source.boolean", path, "Expected a boolean.")
		return false
	}
	return value
}

function requiredBoolean(
	record: SafeRecord,
	key: string,
	path: string,
	context: ValidationContext,
): boolean {
	const keyPath = propertyPath(path, key)
	const value = requiredField(record, key, path, context)
	return value === ABSENT ? false : booleanValue(value, keyPath, context)
}

function optionalBoolean(
	record: SafeRecord,
	key: string,
	path: string,
	context: ValidationContext,
): boolean | undefined {
	if (!Object.hasOwn(record, key)) return undefined
	return booleanValue(record[key], propertyPath(path, key), context)
}

function idValue<Id extends string>(
	value: unknown,
	prefix: string,
	path: string,
	context: ValidationContext,
): Id {
	const id = stringValue(value, path, context)
	if (!id.startsWith(prefix)) {
		add(
			context,
			"source.id",
			path,
			`Expected an identifier beginning with ${JSON.stringify(prefix)}.`,
		)
	}
	return id as Id
}

function requiredId<Id extends string>(
	record: SafeRecord,
	key: string,
	prefix: string,
	path: string,
	context: ValidationContext,
): Id {
	const keyPath = propertyPath(path, key)
	const value = requiredField(record, key, path, context)
	return value === ABSENT
		? (prefix as Id)
		: idValue<Id>(value, prefix, keyPath, context)
}

function requiredArray(
	record: SafeRecord,
	key: string,
	path: string,
	context: ValidationContext,
): readonly unknown[] | null {
	const value = requiredField(record, key, path, context)
	return value === ABSENT
		? null
		: arrayValue(value, propertyPath(path, key), context)
}

function optionalTimestamp(
	record: SafeRecord,
	key: "createdAt" | "modifiedAt",
	path: string,
	mode: TimestampMode,
	context: ValidationContext,
): bigint | undefined {
	if (!Object.hasOwn(record, key)) return undefined
	const keyPath = propertyPath(path, key)
	const value = record[key]
	if (mode === "state") {
		if (typeof value !== "bigint") {
			add(
				context,
				"source.timestamp",
				keyPath,
				"Expected an in-memory bigint timestamp.",
			)
			return 0n
		}
		return value
	}
	if (typeof value !== "string" || !/^(?:0|-?[1-9][0-9]*)$/u.test(value)) {
		add(
			context,
			"source.timestamp",
			keyPath,
			"Expected a canonical base-ten bigint string.",
		)
		return 0n
	}
	return BigInt(value)
}

function parseMetadata(
	value: unknown,
	path: string,
	mode: TimestampMode,
	context: ValidationContext,
): EditorFontSource["metadata"] {
	const record = objectValue(value, path, context)
	if (record === null) {
		return { unitsPerEm: 0, fontRevision: 0, vendorId: "", lowestPpem: 0 }
	}
	checkShape(
		record,
		[
			"unitsPerEm",
			"fontRevision",
			"vendorId",
			"lowestPpem",
			"createdAt",
			"modifiedAt",
		],
		path,
		context,
	)
	const createdAt = optionalTimestamp(record, "createdAt", path, mode, context)
	const modifiedAt = optionalTimestamp(
		record,
		"modifiedAt",
		path,
		mode,
		context,
	)
	return {
		unitsPerEm: requiredNumber(record, "unitsPerEm", path, context),
		fontRevision: requiredNumber(record, "fontRevision", path, context),
		vendorId: requiredString(record, "vendorId", path, context),
		lowestPpem: requiredNumber(record, "lowestPpem", path, context),
		...(createdAt === undefined ? {} : { createdAt }),
		...(modifiedAt === undefined ? {} : { modifiedAt }),
	}
}

function parseNames(
	value: unknown,
	path: string,
	context: ValidationContext,
): EditorFontSource["names"] {
	const record = objectValue(value, path, context)
	if (record === null) {
		return {
			family: "",
			subfamily: "",
			uniqueId: "",
			fullName: "",
			version: "",
			postScriptName: "",
			typographicFamily: "",
			typographicSubfamily: "",
		}
	}
	checkShape(
		record,
		[
			"family",
			"subfamily",
			"uniqueId",
			"fullName",
			"version",
			"postScriptName",
			"typographicFamily",
			"typographicSubfamily",
		],
		path,
		context,
	)
	return {
		family: requiredString(record, "family", path, context),
		subfamily: requiredString(record, "subfamily", path, context),
		uniqueId: requiredString(record, "uniqueId", path, context),
		fullName: requiredString(record, "fullName", path, context),
		version: requiredString(record, "version", path, context),
		postScriptName: requiredString(record, "postScriptName", path, context),
		typographicFamily: requiredString(
			record,
			"typographicFamily",
			path,
			context,
		),
		typographicSubfamily: requiredString(
			record,
			"typographicSubfamily",
			path,
			context,
		),
	}
}

function parseMetrics(
	value: unknown,
	path: string,
	editorVersion: number,
	context: ValidationContext,
): EditorFontSource["metrics"] {
	const record = objectValue(value, path, context)
	if (record === null) {
		return {
			ascender: 0,
			descender: 0,
			lineGap: 0,
			winAscent: 0,
			winDescent: 0,
			xHeight: 0,
			capHeight: 0,
			underlinePosition: 0,
			underlineThickness: 0,
			overshoots: {
				baseline: 0,
				ascender: 0,
				descender: 0,
				winAscent: 0,
				winDescent: 0,
				xHeight: 0,
				capHeight: 0,
				underlinePosition: 0,
			},
		}
	}
	checkShape(
		record,
		[
			"ascender",
			"descender",
			"lineGap",
			"winAscent",
			"winDescent",
			"xHeight",
			"capHeight",
			"underlinePosition",
			"underlineThickness",
			...(editorVersion === LEGACY_EDITOR_VERSION ? [] : ["overshoots"]),
		],
		path,
		context,
	)
	const overshootKeys = [
		"baseline",
		"ascender",
		"descender",
		"winAscent",
		"winDescent",
		"xHeight",
		"capHeight",
		"underlinePosition",
	] as const
	const overshoots: Record<(typeof overshootKeys)[number], number> = {
		baseline: 0,
		ascender: 0,
		descender: 0,
		winAscent: 0,
		winDescent: 0,
		xHeight: 0,
		capHeight: 0,
		underlinePosition: 0,
	}
	if (editorVersion !== LEGACY_EDITOR_VERSION) {
		const overshootValue = requiredField(record, "overshoots", path, context)
		const overshootRecord = objectValue(
			overshootValue === ABSENT ? {} : overshootValue,
			`${path}.overshoots`,
			context,
		)
		if (overshootRecord !== null) {
			checkShape(overshootRecord, overshootKeys, `${path}.overshoots`, context)
			for (const key of overshootKeys) {
				const depth = requiredNumber(
					overshootRecord,
					key,
					`${path}.overshoots`,
					context,
				)
				if (
					!Number.isInteger(depth) ||
					depth < 0 ||
					depth > MAX_OVERSHOOT_DEPTH
				) {
					add(
						context,
						"source.number",
						`${path}.overshoots.${key}`,
						`Expected an integer overshoot depth from 0 through ${MAX_OVERSHOOT_DEPTH}.`,
					)
				}
				overshoots[key] = depth
			}
		}
	}
	return {
		ascender: requiredNumber(record, "ascender", path, context),
		descender: requiredNumber(record, "descender", path, context),
		lineGap: requiredNumber(record, "lineGap", path, context),
		winAscent: requiredNumber(record, "winAscent", path, context),
		winDescent: requiredNumber(record, "winDescent", path, context),
		xHeight: requiredNumber(record, "xHeight", path, context),
		capHeight: requiredNumber(record, "capHeight", path, context),
		underlinePosition: requiredNumber(
			record,
			"underlinePosition",
			path,
			context,
		),
		underlineThickness: requiredNumber(
			record,
			"underlineThickness",
			path,
			context,
		),
		overshoots,
	}
}

function parseStyle(
	value: unknown,
	path: string,
	context: ValidationContext,
): EditorFontSource["style"] {
	const record = objectValue(value, path, context)
	if (record === null) {
		return {
			weightClass: 0,
			widthClass: 0,
			italic: false,
			bold: false,
			oblique: false,
			italicAngle: 0,
		}
	}
	checkShape(
		record,
		["weightClass", "widthClass", "italic", "bold", "oblique", "italicAngle"],
		path,
		context,
	)
	return {
		weightClass: requiredNumber(record, "weightClass", path, context),
		widthClass: requiredNumber(record, "widthClass", path, context),
		italic: requiredBoolean(record, "italic", path, context),
		bold: requiredBoolean(record, "bold", path, context),
		oblique: requiredBoolean(record, "oblique", path, context),
		italicAngle: requiredNumber(record, "italicAngle", path, context),
	}
}

function parseAxisMapEntry(
	value: unknown,
	path: string,
	context: ValidationContext,
): EditorAxisMapEntrySource {
	const record = objectValue(value, path, context)
	if (record === null) return { from: 0, to: 0 }
	checkShape(record, ["from", "to"], path, context)
	return {
		from: requiredNumber(record, "from", path, context),
		to: requiredNumber(record, "to", path, context),
	}
}

function parseAxis(
	value: unknown,
	path: string,
	context: ValidationContext,
): EditorAxisSource {
	const record = objectValue(value, path, context)
	if (record === null) {
		return {
			id: "axis:",
			tag: "",
			name: "",
			min: 0,
			default: 0,
			max: 0,
		}
	}
	checkShape(
		record,
		["id", "tag", "name", "min", "default", "max", "hidden", "map"],
		path,
		context,
	)
	const hidden = optionalBoolean(record, "hidden", path, context)
	let map: readonly EditorAxisMapEntrySource[] | undefined
	if (Object.hasOwn(record, "map")) {
		const items = arrayValue(record.map, `${path}.map`, context)
		map =
			items?.map((entry, index) =>
				parseAxisMapEntry(entry, `${path}.map[${index}]`, context),
			) ?? []
	}
	return {
		id: requiredId<AxisId>(record, "id", "axis:", path, context),
		tag: requiredString(record, "tag", path, context),
		name: requiredString(record, "name", path, context),
		min: requiredNumber(record, "min", path, context),
		default: requiredNumber(record, "default", path, context),
		max: requiredNumber(record, "max", path, context),
		...(hidden === undefined ? {} : { hidden }),
		...(map === undefined ? {} : { map }),
	}
}

function parseLocation(
	value: unknown,
	path: string,
	context: ValidationContext,
): EditorLocationSource {
	const record = objectValue(value, path, context)
	if (record === null) return {}
	const location: Partial<Record<AxisId, number>> = {}
	for (const key of Object.keys(record)) {
		const keyPath = propertyPath(path, key)
		const axisId = idValue<AxisId>(key, "axis:", keyPath, context)
		location[axisId] = numberValue(record[key], keyPath, context)
	}
	return location
}

function parseSupport(
	value: unknown,
	path: string,
	context: ValidationContext,
): EditorMasterSupportSource {
	const record = objectValue(value, path, context)
	if (record === null) return { kind: "non-intermediate" }
	const kind = requiredString(record, "kind", path, context)
	if (kind === "non-intermediate") {
		checkShape(record, ["kind"], path, context)
		return { kind }
	}
	if (kind === "intermediate") {
		checkShape(record, ["kind", "start", "end"], path, context)
		const startValue = requiredField(record, "start", path, context)
		const endValue = requiredField(record, "end", path, context)
		return {
			kind,
			start: parseLocation(
				startValue === ABSENT ? {} : startValue,
				`${path}.start`,
				context,
			),
			end: parseLocation(
				endValue === ABSENT ? {} : endValue,
				`${path}.end`,
				context,
			),
		}
	}
	add(
		context,
		"source.string",
		`${path}.kind`,
		'Expected "non-intermediate" or "intermediate".',
	)
	checkShape(record, ["kind", "start", "end"], path, context)
	return { kind: "non-intermediate" }
}

function parseMaster(
	value: unknown,
	path: string,
	context: ValidationContext,
): EditorMasterSource {
	const record = objectValue(value, path, context)
	if (record === null) {
		return { id: "master:", kind: "default", name: "" }
	}
	const kind = requiredString(record, "kind", path, context)
	const id = requiredId<MasterId>(record, "id", "master:", path, context)
	const name = requiredString(record, "name", path, context)
	if (kind === "default") {
		checkShape(record, ["id", "kind", "name"], path, context)
		return { id, kind, name }
	}
	if (kind === "source") {
		checkShape(
			record,
			["id", "kind", "name", "location", "support"],
			path,
			context,
		)
		const locationValue = requiredField(record, "location", path, context)
		const supportValue = requiredField(record, "support", path, context)
		return {
			id,
			kind,
			name,
			location: parseLocation(
				locationValue === ABSENT ? {} : locationValue,
				`${path}.location`,
				context,
			),
			support: parseSupport(
				supportValue === ABSENT ? { kind: "non-intermediate" } : supportValue,
				`${path}.support`,
				context,
			),
		}
	}
	add(
		context,
		"source.string",
		`${path}.kind`,
		'Expected master kind "default" or "source".',
	)
	checkShape(
		record,
		["id", "kind", "name", "location", "support"],
		path,
		context,
	)
	return { id, kind: "default", name }
}

function parseInstance(
	value: unknown,
	path: string,
	context: ValidationContext,
): EditorInstanceSource {
	const record = objectValue(value, path, context)
	if (record === null) {
		return { id: "instance:", name: "", coordinates: {} }
	}
	checkShape(
		record,
		["id", "name", "coordinates", "postScriptName", "elidable"],
		path,
		context,
	)
	const coordinatesValue = requiredField(record, "coordinates", path, context)
	const postScriptName = optionalString(record, "postScriptName", path, context)
	const elidable = optionalBoolean(record, "elidable", path, context)
	return {
		id: requiredId<InstanceId>(record, "id", "instance:", path, context),
		name: requiredString(record, "name", path, context),
		coordinates: parseLocation(
			coordinatesValue === ABSENT ? {} : coordinatesValue,
			`${path}.coordinates`,
			context,
		),
		...(postScriptName === undefined ? {} : { postScriptName }),
		...(elidable === undefined ? {} : { elidable }),
	}
}

function parseTopologyPoint(
	value: unknown,
	path: string,
	context: ValidationContext,
): EditorPointSource {
	const record = objectValue(value, path, context)
	if (record === null) return { id: "point:", mode: "hard" }
	checkShape(record, ["id", "mode"], path, context)
	const modeValue = requiredString(record, "mode", path, context)
	const mode = modeValue === "soft" || modeValue === "hard" ? modeValue : "hard"
	if (modeValue !== "soft" && modeValue !== "hard") {
		add(
			context,
			"source.string",
			`${path}.mode`,
			'Expected node mode "soft" or "hard".',
		)
	}
	return {
		id: requiredId<PointId>(record, "id", "point:", path, context),
		mode,
	}
}

interface LegacyContour {
	readonly id: ContourId
	readonly closed: boolean
	readonly points: readonly EditorPointSource[]
}

function parseContourTopology(
	value: unknown,
	path: string,
	context: ValidationContext,
): LegacyContour {
	const record = objectValue(value, path, context)
	if (record === null) return { id: "contour:", closed: true, points: [] }
	checkShape(record, ["id", "closed", "points"], path, context)
	const points = requiredArray(record, "points", path, context)
	return {
		id: requiredId<ContourId>(record, "id", "contour:", path, context),
		closed: requiredBoolean(record, "closed", path, context),
		points:
			points?.map((point, index) =>
				parseTopologyPoint(point, `${path}.points[${index}]`, context),
			) ?? [],
	}
}

function parseContour(
	value: unknown,
	path: string,
	context: ValidationContext,
): EditorContourSource {
	const record = objectValue(value, path, context)
	if (record === null) return { id: "contour:", closed: true, points: [] }
	checkShape(record, ["id", "closed", "points"], path, context)
	const points = requiredArray(record, "points", path, context)
	return {
		id: requiredId<ContourId>(record, "id", "contour:", path, context),
		closed: requiredBoolean(record, "closed", path, context),
		points:
			points?.map((point, index) =>
				parseLayerPoint(point, `${path}.points[${index}]`, context),
			) ?? [],
	}
}

function parseLayerPoint(
	value: unknown,
	path: string,
	context: ValidationContext,
): EditorLayerPointSource {
	const record = objectValue(value, path, context)
	if (record === null) return { id: "point:", mode: "hard", x: 0, y: 0 }
	checkShape(
		record,
		["id", "mode", "x", "y", "incoming", "outgoing", "corner"],
		path,
		context,
	)
	const modeValue = requiredString(record, "mode", path, context)
	const mode = modeValue === "soft" || modeValue === "hard" ? modeValue : "hard"
	if (modeValue !== "soft" && modeValue !== "hard") {
		add(
			context,
			"source.string",
			`${path}.mode`,
			'Expected node mode "soft" or "hard".',
		)
	}
	const parseHandle = (
		key: "incoming" | "outgoing",
	): EditorHandleVectorSource | undefined => {
		if (!Object.hasOwn(record, key)) return undefined
		const handlePath = `${path}.${key}`
		const handle = objectValue(record[key], handlePath, context)
		if (handle === null) return { x: 0, y: 0 }
		checkShape(handle, ["x", "y"], handlePath, context)
		return {
			x: requiredNumber(handle, "x", handlePath, context),
			y: requiredNumber(handle, "y", handlePath, context),
		}
	}
	const incoming = parseHandle("incoming")
	const outgoing = parseHandle("outgoing")
	let corner: EditorLayerPointSource["corner"]
	if (Object.hasOwn(record, "corner")) {
		const cornerPath = `${path}.corner`
		const value = objectValue(record.corner, cornerPath, context)
		if (value !== null) {
			checkShape(value, ["profile", "amount"], cornerPath, context)
			const profileValue = requiredString(value, "profile", cornerPath, context)
			const profile =
				profileValue === "circular" || profileValue === "squircle"
					? profileValue
					: "circular"
			if (profileValue !== "circular" && profileValue !== "squircle")
				add(
					context,
					"source.string",
					`${cornerPath}.profile`,
					'Expected corner profile "circular" or "squircle".',
				)
			const amount = requiredNumber(value, "amount", cornerPath, context)
			if (!(amount > 0))
				add(
					context,
					"source.number",
					`${cornerPath}.amount`,
					"Expected a positive corner amount.",
				)
			corner = { profile, amount }
		}
	}
	return {
		id: requiredId<PointId>(record, "id", "point:", path, context),
		mode,
		x: requiredNumber(record, "x", path, context),
		y: requiredNumber(record, "y", path, context),
		...(incoming === undefined ? {} : { incoming }),
		...(outgoing === undefined ? {} : { outgoing }),
		...(corner === undefined ? {} : { corner }),
	}
}

interface LegacyLayerPoint {
	readonly pointId: PointId
	readonly x: number
	readonly y: number
	readonly incoming?: EditorHandleVectorSource
	readonly outgoing?: EditorHandleVectorSource
}

function parseLegacyLayerPoint(
	value: unknown,
	path: string,
	context: ValidationContext,
): LegacyLayerPoint {
	const record = objectValue(value, path, context)
	if (record === null) return { pointId: "point:", x: 0, y: 0 }
	checkShape(
		record,
		["pointId", "x", "y", "incoming", "outgoing"],
		path,
		context,
	)
	const parseHandle = (
		key: "incoming" | "outgoing",
	): EditorHandleVectorSource | undefined => {
		if (!Object.hasOwn(record, key)) return undefined
		const handlePath = `${path}.${key}`
		const handle = objectValue(record[key], handlePath, context)
		if (handle === null) return { x: 0, y: 0 }
		checkShape(handle, ["x", "y"], handlePath, context)
		return {
			x: requiredNumber(handle, "x", handlePath, context),
			y: requiredNumber(handle, "y", handlePath, context),
		}
	}
	const incoming = parseHandle("incoming")
	const outgoing = parseHandle("outgoing")
	return {
		pointId: requiredId<PointId>(record, "pointId", "point:", path, context),
		x: requiredNumber(record, "x", path, context),
		y: requiredNumber(record, "y", path, context),
		...(incoming === undefined ? {} : { incoming }),
		...(outgoing === undefined ? {} : { outgoing }),
	}
}

function localContourId(
	masterId: MasterId,
	id: ContourId,
	preserve: boolean,
): ContourId {
	return preserve ? id : `contour:${masterId}:${id.slice("contour:".length)}`
}

function localPointId(
	masterId: MasterId,
	id: PointId,
	preserve: boolean,
): PointId {
	return preserve ? id : `point:${masterId}:${id.slice("point:".length)}`
}

function parseLayer(
	value: unknown,
	path: string,
	context: ValidationContext,
): EditorGlyphLayerSource {
	const record = objectValue(value, path, context)
	if (record === null) {
		return {
			masterId: "master:",
			advanceWidth: 0,
			leftSideBearing: 0,
			contours: [],
		}
	}
	checkShape(
		record,
		["masterId", "advanceWidth", "leftSideBearing", "contours"],
		path,
		context,
	)
	const contours = requiredArray(record, "contours", path, context)
	return {
		masterId: requiredId<MasterId>(
			record,
			"masterId",
			"master:",
			path,
			context,
		),
		advanceWidth: requiredNumber(record, "advanceWidth", path, context),
		leftSideBearing: requiredNumber(record, "leftSideBearing", path, context),
		contours:
			contours?.map((contour, index) =>
				parseContour(contour, `${path}.contours[${index}]`, context),
			) ?? [],
	}
}

function parseLegacyLayer(
	value: unknown,
	path: string,
	context: ValidationContext,
): Readonly<{
	masterId: MasterId
	advanceWidth: number
	leftSideBearing: number
	points: readonly LegacyLayerPoint[]
}> {
	const record = objectValue(value, path, context)
	if (record === null) {
		return {
			masterId: "master:",
			advanceWidth: 0,
			leftSideBearing: 0,
			points: [],
		}
	}
	checkShape(
		record,
		["masterId", "advanceWidth", "leftSideBearing", "points"],
		path,
		context,
	)
	const points = requiredArray(record, "points", path, context)
	return {
		masterId: requiredId<MasterId>(
			record,
			"masterId",
			"master:",
			path,
			context,
		),
		advanceWidth: requiredNumber(record, "advanceWidth", path, context),
		leftSideBearing: requiredNumber(record, "leftSideBearing", path, context),
		points:
			points?.map((point, index) =>
				parseLegacyLayerPoint(point, `${path}.points[${index}]`, context),
			) ?? [],
	}
}

function parseGlyph(
	value: unknown,
	path: string,
	editorVersion: number,
	defaultMasterId: MasterId,
	context: ValidationContext,
): EditorGlyphSource {
	const record = objectValue(value, path, context)
	if (record === null) {
		return {
			id: "glyph:",
			name: "",
			export: false,
			layers: [],
		}
	}
	const sharedTopology = editorVersion <= SHARED_TOPOLOGY_EDITOR_VERSION
	checkShape(
		record,
		[
			"id",
			"name",
			"export",
			"note",
			"color",
			"overlap",
			"rules",
			...(sharedTopology ? ["contours"] : []),
			"layers",
		],
		path,
		context,
	)
	const note = optionalString(record, "note", path, context)
	const color = optionalString(record, "color", path, context)
	const overlap = optionalBoolean(record, "overlap", path, context)
	const rawRules = Object.hasOwn(record, "rules")
		? requiredArray(record, "rules", path, context)
		: undefined
	const rules: EditorRuleSource[] | undefined = rawRules?.map(
		(value, index) => {
			const rulePath = `${path}.rules[${index}]`
			const rule = objectValue(value, rulePath, context)
			if (rule === null)
				return { id: "rule:", a: { x: 0, y: 0 }, b: { x: 1, y: 0 } }
			checkShape(rule, ["id", "a", "b"], rulePath, context)
			const point = (key: "a" | "b") => {
				const pointPath = `${rulePath}.${key}`
				const value = objectValue(rule[key], pointPath, context)
				if (value === null) return { x: 0, y: 0 }
				checkShape(value, ["x", "y"], pointPath, context)
				return {
					x: requiredNumber(value, "x", pointPath, context),
					y: requiredNumber(value, "y", pointPath, context),
				}
			}
			return {
				id: requiredId<RuleId>(rule, "id", "rule:", rulePath, context),
				a: point("a"),
				b: point("b"),
			}
		},
	)
	const layers = requiredArray(record, "layers", path, context)
	let parsedLayers: readonly EditorGlyphLayerSource[]
	if (sharedTopology) {
		const contours = requiredArray(record, "contours", path, context)
		const legacyContours =
			contours?.map((contour, index) =>
				parseContourTopology(contour, `${path}.contours[${index}]`, context),
			) ?? []
		parsedLayers =
			layers?.map((layer, layerIndex) => {
				const layerPath = `${path}.layers[${layerIndex}]`
				const legacy = parseLegacyLayer(layer, layerPath, context)
				const positions = new Map<PointId, LegacyLayerPoint>()
				for (let index = 0; index < legacy.points.length; index += 1) {
					const point = legacy.points[index]
					if (point === undefined) continue
					if (positions.has(point.pointId)) {
						add(
							context,
							"source.duplicate",
							`${layerPath}.points[${index}].pointId`,
							`Duplicate legacy layer point ${JSON.stringify(point.pointId)} makes migration ambiguous.`,
						)
					} else positions.set(point.pointId, point)
				}
				const expected = new Set(
					legacyContours.flatMap((contour) =>
						contour.points.map((point) => point.id),
					),
				)
				for (let index = 0; index < legacy.points.length; index += 1) {
					const point = legacy.points[index]
					if (point !== undefined && !expected.has(point.pointId)) {
						add(
							context,
							"source.reference",
							`${layerPath}.points[${index}].pointId`,
							`Legacy layer point ${JSON.stringify(point.pointId)} is not present in shared topology.`,
						)
					}
				}
				const preserve = legacy.masterId === defaultMasterId
				return {
					masterId: legacy.masterId,
					advanceWidth: legacy.advanceWidth,
					leftSideBearing: legacy.leftSideBearing,
					contours: legacyContours.map((contour, contourIndex) => ({
						id: localContourId(legacy.masterId, contour.id, preserve),
						closed: contour.closed,
						points: contour.points.map((topology, pointIndex) => {
							const geometry = positions.get(topology.id)
							if (geometry === undefined) {
								add(
									context,
									"source.reference",
									`${layerPath}.points`,
									`Legacy layer is missing point ${JSON.stringify(topology.id)} required by contours[${contourIndex}].points[${pointIndex}].`,
								)
							}
							return {
								id: localPointId(legacy.masterId, topology.id, preserve),
								mode: topology.mode,
								x: geometry?.x ?? 0,
								y: geometry?.y ?? 0,
								...(geometry?.incoming === undefined
									? {}
									: { incoming: geometry.incoming }),
								...(geometry?.outgoing === undefined
									? {}
									: { outgoing: geometry.outgoing }),
							}
						}),
					})),
				}
			}) ?? []
	} else {
		parsedLayers =
			layers?.map((layer, index) =>
				parseLayer(layer, `${path}.layers[${index}]`, context),
			) ?? []
	}
	return {
		id: requiredId<GlyphId>(record, "id", "glyph:", path, context),
		name: requiredString(record, "name", path, context),
		export: requiredBoolean(record, "export", path, context),
		...(note === undefined ? {} : { note }),
		...(color === undefined ? {} : { color }),
		...(overlap === undefined ? {} : { overlap }),
		...(rules === undefined ? {} : { rules }),
		layers: parsedLayers,
	}
}

function parseCmapEntry(
	value: unknown,
	path: string,
	context: ValidationContext,
): EditorCmapEntrySource {
	const record = objectValue(value, path, context)
	if (record === null) return { codePoint: 0, glyphId: "glyph:" }
	checkShape(record, ["codePoint", "glyphId"], path, context)
	const codePoint = requiredNumber(record, "codePoint", path, context)
	if (!Number.isInteger(codePoint)) {
		add(
			context,
			"source.cmap_code_point",
			`${path}.codePoint`,
			"Cmap code points must be integers.",
		)
	}
	return {
		codePoint,
		glyphId: requiredId<GlyphId>(record, "glyphId", "glyph:", path, context),
	}
}

function parseKerningPair(
	value: unknown,
	path: string,
	context: ValidationContext,
): EditorKerningPairSource {
	const record = objectValue(value, path, context)
	if (record === null) return { left: "glyph:", right: "glyph:", value: 0 }
	checkShape(record, ["left", "right", "value"], path, context)
	return {
		left: requiredId<GlyphId>(record, "left", "glyph:", path, context),
		right: requiredId<GlyphId>(record, "right", "glyph:", path, context),
		value: requiredNumber(record, "value", path, context),
	}
}

function parseRoot(
	value: unknown,
	mode: TimestampMode,
	context: ValidationContext,
): EditorFontSource {
	const record = objectValue(value, "$", context)
	if (record === null) {
		return {
			format: CREATE_FONT_EDITOR_FORMAT,
			editorVersion: CREATE_FONT_EDITOR_VERSION,
			metadata: {
				unitsPerEm: 0,
				fontRevision: 0,
				vendorId: "",
				lowestPpem: 0,
			},
			names: {
				family: "",
				subfamily: "",
				uniqueId: "",
				fullName: "",
				version: "",
				postScriptName: "",
				typographicFamily: "",
				typographicSubfamily: "",
			},
			metrics: {
				ascender: 0,
				descender: 0,
				lineGap: 0,
				winAscent: 0,
				winDescent: 0,
				xHeight: 0,
				capHeight: 0,
				underlinePosition: 0,
				underlineThickness: 0,
				overshoots: {
					baseline: 0,
					ascender: 0,
					descender: 0,
					winAscent: 0,
					winDescent: 0,
					xHeight: 0,
					capHeight: 0,
					underlinePosition: 0,
				},
			},
			style: {
				weightClass: 0,
				widthClass: 0,
				italic: false,
				bold: false,
				oblique: false,
				italicAngle: 0,
			},
			axes: [],
			masters: [],
			defaultMasterId: "master:",
			instances: [],
			glyphs: [],
			cmap: [],
			kerning: [],
		}
	}
	checkShape(
		record,
		[
			"format",
			"editorVersion",
			"metadata",
			"names",
			"metrics",
			"style",
			"axes",
			"masters",
			"defaultMasterId",
			"instances",
			"glyphs",
			"cmap",
			"kerning",
		],
		"$",
		context,
	)
	const format = requiredString(record, "format", "$", context)
	if (format !== CREATE_FONT_EDITOR_FORMAT) {
		add(
			context,
			"source.format",
			"$.format",
			`Expected source format ${JSON.stringify(CREATE_FONT_EDITOR_FORMAT)}.`,
		)
	}
	const editorVersion = requiredNumber(record, "editorVersion", "$", context)
	const migratesLegacy =
		mode === "file" &&
		(editorVersion === LEGACY_EDITOR_VERSION ||
			editorVersion === SHARED_TOPOLOGY_EDITOR_VERSION)
	if (editorVersion !== CREATE_FONT_EDITOR_VERSION && !migratesLegacy) {
		add(
			context,
			"source.version",
			"$.editorVersion",
			`Unsupported editor source version ${JSON.stringify(editorVersion)}.`,
		)
	}

	const metadata = requiredField(record, "metadata", "$", context)
	const names = requiredField(record, "names", "$", context)
	const metrics = requiredField(record, "metrics", "$", context)
	const style = requiredField(record, "style", "$", context)
	const axes = requiredArray(record, "axes", "$", context)
	const masters = requiredArray(record, "masters", "$", context)
	const instances = requiredArray(record, "instances", "$", context)
	const glyphs = requiredArray(record, "glyphs", "$", context)
	const cmap = requiredArray(record, "cmap", "$", context)
	const kerning = Object.hasOwn(record, "kerning")
		? requiredArray(record, "kerning", "$", context)
		: []
	const defaultMasterId = requiredId<MasterId>(
		record,
		"defaultMasterId",
		"master:",
		"$",
		context,
	)
	return {
		format: CREATE_FONT_EDITOR_FORMAT,
		editorVersion: CREATE_FONT_EDITOR_VERSION,
		metadata: parseMetadata(
			metadata === ABSENT ? {} : metadata,
			"$.metadata",
			mode,
			context,
		),
		names: parseNames(names === ABSENT ? {} : names, "$.names", context),
		metrics: parseMetrics(
			metrics === ABSENT ? {} : metrics,
			"$.metrics",
			editorVersion,
			context,
		),
		style: parseStyle(style === ABSENT ? {} : style, "$.style", context),
		axes:
			axes?.map((axis, index) =>
				parseAxis(axis, `$.axes[${index}]`, context),
			) ?? [],
		masters:
			masters?.map((master, index) =>
				parseMaster(master, `$.masters[${index}]`, context),
			) ?? [],
		defaultMasterId,
		instances:
			instances?.map((instance, index) =>
				parseInstance(instance, `$.instances[${index}]`, context),
			) ?? [],
		glyphs:
			glyphs?.map((glyph, index) =>
				parseGlyph(
					glyph,
					`$.glyphs[${index}]`,
					editorVersion,
					defaultMasterId,
					context,
				),
			) ?? [],
		cmap:
			cmap?.map((entry, index) =>
				parseCmapEntry(entry, `$.cmap[${index}]`, context),
			) ?? [],
		...(kerning !== null && kerning.length > 0
			? {
					kerning: kerning.map((pair, index) =>
						parseKerningPair(pair, `$.kerning[${index}]`, context),
					),
				}
			: {}),
	}
}

function diagnoseDuplicates<Value>(
	values: readonly Value[],
	pathOf: (index: number) => string,
	label: string,
	context: ValidationContext,
): void {
	const seen = new Set<Value>()
	for (let index = 0; index < values.length; index += 1) {
		const value = values[index]
		if (value === undefined) continue
		if (seen.has(value)) {
			add(
				context,
				"source.duplicate",
				pathOf(index),
				`Duplicate ${label} ${JSON.stringify(value)}.`,
			)
		}
		seen.add(value)
	}
}

function diagnoseLocationReferences(
	location: EditorLocationSource,
	path: string,
	axisIds: ReadonlySet<AxisId>,
	context: ValidationContext,
): void {
	for (const axisId of Object.keys(location) as AxisId[]) {
		if (!axisIds.has(axisId)) {
			add(
				context,
				"source.reference",
				propertyPath(path, axisId),
				`Unknown axis reference ${JSON.stringify(axisId)}.`,
			)
		}
	}
}

function handlesShareOppositeRay(
	incoming: EditorHandleVectorSource,
	outgoing: EditorHandleVectorSource,
): boolean {
	const scale = Math.max(
		1,
		Math.hypot(incoming.x, incoming.y) * Math.hypot(outgoing.x, outgoing.y),
	)
	const cross = incoming.x * outgoing.y - incoming.y * outgoing.x
	const dot = incoming.x * outgoing.x + incoming.y * outgoing.y
	return Math.abs(cross) <= Number.EPSILON * 32 * scale && dot <= 0
}

function diagnoseStructure(
	source: EditorFontSource,
	context: ValidationContext,
): void {
	diagnoseDuplicates(
		source.axes.map((axis) => axis.id),
		(index) => `$.axes[${index}].id`,
		"axis ID",
		context,
	)
	diagnoseDuplicates(
		source.masters.map((master) => master.id),
		(index) => `$.masters[${index}].id`,
		"master ID",
		context,
	)
	diagnoseDuplicates(
		source.instances.map((instance) => instance.id),
		(index) => `$.instances[${index}].id`,
		"instance ID",
		context,
	)
	diagnoseDuplicates(
		source.glyphs.map((glyph) => glyph.id),
		(index) => `$.glyphs[${index}].id`,
		"glyph ID",
		context,
	)
	diagnoseDuplicates(
		source.cmap.map((entry) => entry.codePoint),
		(index) => `$.cmap[${index}].codePoint`,
		"cmap code point",
		context,
	)

	const axisIds = new Set(source.axes.map((axis) => axis.id))
	const masterIds = new Set(source.masters.map((master) => master.id))
	const glyphIds = new Set(source.glyphs.map((glyph) => glyph.id))
	const defaultMasters = source.masters.filter(
		(master) => master.kind === "default",
	)
	if (
		defaultMasters.length !== 1 ||
		defaultMasters[0]?.id !== source.defaultMasterId
	) {
		add(
			context,
			"source.default_master",
			"$.defaultMasterId",
			"Exactly one default master must match defaultMasterId.",
		)
	}

	for (
		let masterIndex = 0;
		masterIndex < source.masters.length;
		masterIndex += 1
	) {
		const master = source.masters[masterIndex]
		if (master?.kind !== "source") continue
		const masterPath = `$.masters[${masterIndex}]`
		diagnoseLocationReferences(
			master.location,
			`${masterPath}.location`,
			axisIds,
			context,
		)
		if (master.support.kind === "intermediate") {
			diagnoseLocationReferences(
				master.support.start,
				`${masterPath}.support.start`,
				axisIds,
				context,
			)
			diagnoseLocationReferences(
				master.support.end,
				`${masterPath}.support.end`,
				axisIds,
				context,
			)
		}
	}
	for (
		let instanceIndex = 0;
		instanceIndex < source.instances.length;
		instanceIndex += 1
	) {
		const instance = source.instances[instanceIndex]
		if (instance === undefined) continue
		diagnoseLocationReferences(
			instance.coordinates,
			`$.instances[${instanceIndex}].coordinates`,
			axisIds,
			context,
		)
	}

	for (let glyphIndex = 0; glyphIndex < source.glyphs.length; glyphIndex += 1) {
		const glyph = source.glyphs[glyphIndex]
		if (glyph === undefined) continue
		const glyphPath = `$.glyphs[${glyphIndex}]`
		diagnoseDuplicates(
			(glyph.rules ?? []).map((rule) => rule.id),
			(index) => `${glyphPath}.rules[${index}].id`,
			"glyph rule ID",
			context,
		)
		for (
			let ruleIndex = 0;
			ruleIndex < (glyph.rules?.length ?? 0);
			ruleIndex += 1
		) {
			const rule = glyph.rules?.[ruleIndex]
			if (
				rule !== undefined &&
				Math.hypot(rule.b.x - rule.a.x, rule.b.y - rule.a.y) <= 1e-6
			)
				add(
					context,
					"source.number",
					`${glyphPath}.rules[${ruleIndex}]`,
					"Rule endpoints must be distinct.",
				)
		}
		diagnoseDuplicates(
			glyph.layers.map((layer) => layer.masterId),
			(index) => `${glyphPath}.layers[${index}].masterId`,
			"glyph-layer master ID",
			context,
		)
		for (
			let layerIndex = 0;
			layerIndex < glyph.layers.length;
			layerIndex += 1
		) {
			const layer = glyph.layers[layerIndex]
			if (layer === undefined) continue
			const layerPath = `${glyphPath}.layers[${layerIndex}]`
			if (!masterIds.has(layer.masterId)) {
				add(
					context,
					"source.reference",
					`${layerPath}.masterId`,
					`Unknown master reference ${JSON.stringify(layer.masterId)}.`,
				)
			}
			diagnoseDuplicates(
				layer.contours.map((contour) => contour.id),
				(index) => `${layerPath}.contours[${index}].id`,
				"layer contour ID",
				context,
			)
			const layerPointIds = new Set<PointId>()
			for (
				let contourIndex = 0;
				contourIndex < layer.contours.length;
				contourIndex += 1
			) {
				const contour = layer.contours[contourIndex]
				if (contour === undefined) continue
				const contourPath = `${layerPath}.contours[${contourIndex}]`
				diagnoseDuplicates(
					contour.points.map((point) => point.id),
					(index) => `${contourPath}.points[${index}].id`,
					"contour point ID",
					context,
				)
				for (
					let pointIndex = 0;
					pointIndex < contour.points.length;
					pointIndex += 1
				) {
					const point = contour.points[pointIndex]
					if (point === undefined) continue
					if (layerPointIds.has(point.id)) {
						add(
							context,
							"source.duplicate",
							`${contourPath}.points[${pointIndex}].id`,
							`Point ID ${JSON.stringify(point.id)} may occur only once in a master layer.`,
						)
					}
					layerPointIds.add(point.id)
					if (point.mode !== "soft") continue
					if (point.incoming === undefined && point.outgoing === undefined) {
						add(
							context,
							"source.handle",
							`${contourPath}.points[${pointIndex}]`,
							"A soft node requires at least one handle.",
						)
						continue
					}
					if (
						point.incoming !== undefined &&
						point.outgoing !== undefined &&
						!handlesShareOppositeRay(point.incoming, point.outgoing)
					) {
						add(
							context,
							"source.handle",
							`${contourPath}.points[${pointIndex}]`,
							"A soft node's handles must be collinear and point in opposite directions.",
						)
					}
				}
			}
		}
	}

	for (let index = 0; index < source.cmap.length; index += 1) {
		const entry = source.cmap[index]
		if (entry !== undefined && !glyphIds.has(entry.glyphId)) {
			add(
				context,
				"source.reference",
				`$.cmap[${index}].glyphId`,
				`Unknown glyph reference ${JSON.stringify(entry.glyphId)}.`,
			)
		}
	}
	const pairKeys = new Set<string>()
	for (let index = 0; index < (source.kerning ?? []).length; index += 1) {
		const pair = source.kerning?.[index]
		if (pair === undefined) continue
		for (const side of ["left", "right"] as const) {
			if (!glyphIds.has(pair[side]))
				add(
					context,
					"source.reference",
					`$.kerning[${index}].${side}`,
					`Unknown glyph reference ${JSON.stringify(pair[side])}.`,
				)
		}
		if (!Number.isInteger(pair.value))
			add(
				context,
				"source.number",
				`$.kerning[${index}].value`,
				"Kerning values must be integer font units.",
			)
		const key = `${pair.left}/${pair.right}`
		if (pairKeys.has(key))
			add(
				context,
				"source.duplicate",
				`$.kerning[${index}]`,
				"Kerning pairs must be unique.",
			)
		pairKeys.add(key)
	}
}

/** Match the snapshot emitted by load(source) -> editorSourceSelector. */
function normalizeStateSource(source: EditorFontSource): EditorFontSource {
	return {
		...source,
		axes: source.axes.map((axis) => ({
			id: axis.id,
			tag: axis.tag,
			name: axis.name,
			min: axis.min,
			default: axis.default,
			max: axis.max,
			...(axis.hidden ? { hidden: true } : {}),
			...(axis.map === undefined ? {} : { map: axis.map }),
		})),
		instances: source.instances.map((instance) => ({
			id: instance.id,
			name: instance.name,
			coordinates: instance.coordinates,
			...(instance.postScriptName === undefined
				? {}
				: { postScriptName: instance.postScriptName }),
			...(instance.elidable ? { elidable: true } : {}),
		})),
		glyphs: source.glyphs.map((glyph) => {
			return {
				id: glyph.id,
				name: glyph.name,
				export: glyph.export,
				...(glyph.note === undefined || glyph.note.length === 0
					? {}
					: { note: glyph.note }),
				...(glyph.color === undefined ? {} : { color: glyph.color }),
				...(glyph.overlap ? { overlap: true } : {}),
				...(glyph.rules === undefined || glyph.rules.length === 0
					? {}
					: { rules: glyph.rules }),
				layers: glyph.layers.map((layer) => ({
					masterId: layer.masterId,
					advanceWidth: layer.advanceWidth,
					leftSideBearing: layer.leftSideBearing,
					contours: layer.contours.map((contour) => ({
						id: contour.id,
						closed: contour.closed,
						points: contour.points.map((point) => ({
							id: point.id,
							mode: point.mode,
							x: point.x,
							y: point.y,
							...(point.incoming === undefined
								? {}
								: { incoming: point.incoming }),
							...(point.outgoing === undefined
								? {}
								: { outgoing: point.outgoing }),
							...(point.corner === undefined ? {} : { corner: point.corner }),
						})),
					})),
				})),
			}
		}),
	}
}

export function validateSourceValue(
	value: unknown,
	mode: TimestampMode,
): SourceResult<EditorFontSource> {
	const context: ValidationContext = { errors: [] }
	let source: EditorFontSource
	try {
		source = parseRoot(value, mode, context)
		if (context.errors.length === 0) {
			diagnoseStructure(source, context)
			if (context.errors.length === 0) source = normalizeStateSource(source)
		}
	} catch {
		add(
			context,
			"source.object",
			"$",
			"Source data could not be inspected safely.",
		)
		return failure(context.errors)
	}
	return context.errors.length === 0 ? success(source) : failure(context.errors)
}
