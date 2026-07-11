import {
	TRIGRAPH_FORMAT,
	TRIGRAPH_IR_VERSION,
	type AdvanceWidth,
	type AxisMapEntry,
	type AxisTag,
	type CharacterMapEntry,
	type Diagnostic,
	type DiagnosticCode,
	type F2Dot14,
	type Fixed16Dot16,
	type FontMetadata,
	type FontMetrics,
	type FontNames,
	type FontStyle,
	type FUnit,
	type GlyphCoordinate,
	type GlyphVariation,
	type IngestResult,
	type IntermediateRegion,
	type NamedInstance,
	type NonEmptyReadonlyArray,
	type NonEmptyString,
	type NonIntermediateRegion,
	type NormalizedLocation,
	type OpenTypeTimestamp,
	type Point,
	type PointDelta,
	type PostScriptName,
	type SfntTag,
	type SimpleGlyph,
	type UInt16,
	type UnicodeScalar,
	type UnitsPerEm,
	type UserCoordinate,
	type VariableFont,
	type VariationAxis,
	type VariationDelta,
} from "./model.ts"
import { createCmapEncodingPlan } from "./cmap.ts"
import { createCanonicalEncodingPlan, packedDeltaSize } from "./encoding.ts"
import { markVariableFontValidated } from "./proof.ts"

type UnknownRecord = Record<string, unknown>

interface ValidationContext {
	readonly errors: Diagnostic[]
	readonly warnings: Diagnostic[]
}

const MAX_INT16 = 32_767
const MIN_INT16 = -32_768
const MIN_GLYPH_COORDINATE = -16_384
const MAX_GLYPH_COORDINATE = 16_383
const MAX_UINT16 = 65_535
const MAX_UINT32 = 4_294_967_295
const MAX_FIXED = MAX_INT16 + 65_535 / 65_536
const MIN_FIXED = MIN_INT16
const MAX_TIMESTAMP = (1n << 63n) - 1n
const MAX_FVAR_AXES = 16_382
const MAX_GVAR_TUPLES = 4_095
const REGISTERED_AXIS_TAGS = new Set(["ital", "opsz", "slnt", "wdth", "wght"])

const own = (value: UnknownRecord, key: string): boolean =>
	Object.prototype.hasOwnProperty.call(value, key)

function addDiagnostic(
	context: ValidationContext,
	severity: "error" | "warning",
	code: DiagnosticCode,
	path: string,
	message: string,
	table: string,
): void {
	const diagnostic = { severity, code, path, message, table } as const
	if (severity === "error") {
		context.errors.push(diagnostic)
	} else {
		context.warnings.push(diagnostic)
	}
}

function error(
	context: ValidationContext,
	code: DiagnosticCode,
	path: string,
	message: string,
	table: string,
): void {
	addDiagnostic(context, "error", code, path, message, table)
}

function warning(
	context: ValidationContext,
	code: DiagnosticCode,
	path: string,
	message: string,
	table: string,
): void {
	addDiagnostic(context, "warning", code, path, message, table)
}

function asRecord(
	value: unknown,
	path: string,
	context: ValidationContext,
	table: string,
): UnknownRecord | null {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		error(context, "font.object", path, "Expected an object.", table)
		return null
	}
	const prototype = Object.getPrototypeOf(value)
	const descriptors = Object.getOwnPropertyDescriptors(value)
	if (
		(prototype !== Object.prototype && prototype !== null) ||
		Object.values(descriptors).some(
			(descriptor) => "get" in descriptor || "set" in descriptor,
		)
	) {
		error(
			context,
			"font.object",
			path,
			"Expected a plain data object with no inherited or accessor fields.",
			table,
		)
		return null
	}
	return value as UnknownRecord
}

function exactKeys(
	value: UnknownRecord,
	allowed: readonly string[],
	path: string,
	context: ValidationContext,
	table: string,
): void {
	const allowedKeys = new Set(allowed)
	const keys = Reflect.ownKeys(value).sort((left, right) =>
		String(left) < String(right) ? -1 : String(left) > String(right) ? 1 : 0,
	)
	for (const key of keys) {
		if (typeof key !== "string") {
			error(
				context,
				"font.unknown_property",
				path,
				"Symbol properties are not permitted in the Trigraph IR.",
				table,
			)
			continue
		}
		if (!allowedKeys.has(key)) {
			error(
				context,
				"font.unknown_property",
				`${path}.${key}`,
				`Unknown property ${JSON.stringify(key)}.`,
				table,
			)
		}
	}
}

function asArray(
	value: unknown,
	path: string,
	context: ValidationContext,
	table: string,
): readonly unknown[] {
	if (!Array.isArray(value)) {
		error(context, "scalar.type", path, "Expected an array.", table)
		return []
	}
	const descriptors = Object.getOwnPropertyDescriptors(value)
	if (
		Object.getPrototypeOf(value) !== Array.prototype ||
		Object.values(descriptors).some(
			(descriptor) => "get" in descriptor || "set" in descriptor,
		) ||
		Reflect.ownKeys(value).some((key) => {
			if (key === "length") return false
			if (typeof key !== "string") return true
			const index = Number(key)
			return !(
				Number.isInteger(index) &&
				index >= 0 &&
				index < value.length &&
				String(index) === key
			)
		})
	) {
		error(
			context,
			"scalar.type",
			path,
			"Expected a plain dense data array without accessors or extra properties.",
			table,
		)
		return []
	}
	let indexedKeyCount = 0
	for (const key of Object.keys(value)) {
		const index = Number(key)
		if (
			Number.isInteger(index) &&
			index >= 0 &&
			index < value.length &&
			String(index) === key
		) {
			indexedKeyCount += 1
		}
	}
	if (indexedKeyCount !== value.length) {
		error(
			context,
			"scalar.type",
			path,
			"Sparse arrays are not permitted in the Trigraph IR.",
			table,
		)
		return []
	}
	return value
}

function asNonEmptyString(
	value: unknown,
	path: string,
	context: ValidationContext,
	table: string,
	code: DiagnosticCode = "name.empty",
): NonEmptyString {
	if (typeof value !== "string" || value.trim().length === 0) {
		error(context, code, path, "Expected a non-empty string.", table)
		return "invalid" as NonEmptyString
	}
	if (!value.isWellFormed()) {
		error(
			context,
			"name.unicode",
			path,
			"Strings must be well-formed Unicode without lone UTF-16 surrogates.",
			table,
		)
		return "invalid" as NonEmptyString
	}
	return value as NonEmptyString
}

function asBoolean(
	value: unknown,
	path: string,
	context: ValidationContext,
	table: string,
): boolean {
	if (typeof value !== "boolean") {
		error(context, "scalar.boolean", path, "Expected a boolean.", table)
		return false
	}
	return value
}

function asFiniteNumber(
	value: unknown,
	path: string,
	context: ValidationContext,
	table: string,
): number {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		error(context, "scalar.type", path, "Expected a finite number.", table)
		return 0
	}
	return value
}

function asInteger(
	value: unknown,
	min: number,
	max: number,
	path: string,
	context: ValidationContext,
	table: string,
	code: DiagnosticCode = "scalar.range",
): number {
	const parsed = asFiniteNumber(value, path, context, table)
	if (!Number.isInteger(parsed)) {
		error(context, "scalar.integer", path, "Expected an integer.", table)
		return 0
	}
	if (parsed < min || parsed > max) {
		error(
			context,
			code,
			path,
			`Expected a value from ${min} through ${max}.`,
			table,
		)
		return 0
	}
	return parsed
}

function asUInt16(
	value: unknown,
	path: string,
	context: ValidationContext,
	table: string,
): UInt16 {
	return asInteger(value, 0, MAX_UINT16, path, context, table) as UInt16
}

function asFUnit(
	value: unknown,
	path: string,
	context: ValidationContext,
	table: string,
): FUnit {
	return asInteger(value, MIN_INT16, MAX_INT16, path, context, table) as FUnit
}

function asGlyphCoordinate(
	value: unknown,
	path: string,
	context: ValidationContext,
): GlyphCoordinate {
	return asInteger(
		value,
		MIN_GLYPH_COORDINATE,
		MAX_GLYPH_COORDINATE,
		path,
		context,
		"glyf",
		"glyph.coordinate",
	) as GlyphCoordinate
}

function asVariationDelta(
	value: unknown,
	path: string,
	context: ValidationContext,
): VariationDelta {
	return asInteger(
		value,
		MIN_INT16,
		MAX_INT16,
		path,
		context,
		"gvar",
		"glyph.glyf_delta",
	) as VariationDelta
}

function asFixed(
	value: unknown,
	path: string,
	context: ValidationContext,
	table: string,
	code: DiagnosticCode,
): Fixed16Dot16 {
	const parsed = asFiniteNumber(value, path, context, table)
	if (
		parsed < MIN_FIXED ||
		parsed > MAX_FIXED ||
		!Number.isSafeInteger(parsed * 65_536)
	) {
		error(
			context,
			code,
			path,
			"Value is not exactly representable as signed Fixed16.16.",
			table,
		)
		return 0 as Fixed16Dot16
	}
	return parsed as Fixed16Dot16
}

function asF2Dot14(
	value: unknown,
	path: string,
	context: ValidationContext,
	table: "avar" | "gvar",
	code: DiagnosticCode,
): F2Dot14 {
	const parsed = asFiniteNumber(value, path, context, table)
	if (parsed < -1 || parsed > 1 || !Number.isSafeInteger(parsed * 16_384)) {
		error(
			context,
			code,
			path,
			"Expected an exact F2Dot14 value in the normalized range [-1, 1].",
			table,
		)
		return 0 as F2Dot14
	}
	return parsed as F2Dot14
}

function asTimestamp(
	value: unknown,
	path: string,
	context: ValidationContext,
): OpenTypeTimestamp {
	if (typeof value !== "bigint" || value < 0n || value > MAX_TIMESTAMP) {
		error(
			context,
			"metadata.timestamp",
			path,
			"Expected a non-negative signed 64-bit bigint in the OpenType epoch.",
			"head",
		)
		return 0n as OpenTypeTimestamp
	}
	return value as OpenTypeTimestamp
}

function asSfntTag(
	value: unknown,
	path: string,
	context: ValidationContext,
): SfntTag {
	const firstSpace = typeof value === "string" ? value.indexOf(" ") : -1
	const hasEmbeddedSpace =
		typeof value === "string" &&
		firstSpace >= 0 &&
		value.slice(firstSpace).trim().length > 0
	if (
		typeof value !== "string" ||
		value.length !== 4 ||
		!/^[\x20-\x7e]{4}$/.test(value) ||
		hasEmbeddedSpace ||
		value.trim().length === 0
	) {
		error(
			context,
			"metadata.vendor_id",
			path,
			"Expected a four-byte printable-ASCII OpenType tag.",
			"OS/2",
		)
		return "NONE" as SfntTag
	}
	return value as SfntTag
}

function asAxisTag(
	value: unknown,
	path: string,
	context: ValidationContext,
): AxisTag {
	const firstSpace = typeof value === "string" ? value.indexOf(" ") : -1
	const hasEmbeddedSpace =
		typeof value === "string" &&
		firstSpace >= 0 &&
		value.slice(firstSpace).trim().length > 0
	if (
		typeof value !== "string" ||
		value.length !== 4 ||
		!/^[A-Za-z][A-Za-z0-9 ]{3}$/.test(value) ||
		hasEmbeddedSpace
	) {
		error(
			context,
			"axis.tag",
			path,
			"Axis tags must be four characters, begin with a letter, and use only letters, digits, or trailing spaces.",
			"fvar",
		)
		return "INVL" as AxisTag
	}
	if (!REGISTERED_AXIS_TAGS.has(value) && !/^[A-Z][A-Z0-9]{3}$/.test(value)) {
		error(
			context,
			"axis.tag",
			path,
			"Use a registered axis tag or a foundry-defined tag made from four uppercase letters or digits.",
			"fvar",
		)
		return "INVL" as AxisTag
	}
	return value as AxisTag
}

function asPostScriptName(
	value: unknown,
	path: string,
	context: ValidationContext,
	code: DiagnosticCode = "name.postscript",
): PostScriptName {
	if (
		typeof value !== "string" ||
		value.length === 0 ||
		value.length > 63 ||
		![...value].every((character) => {
			const codePoint = character.codePointAt(0) ?? 0
			return (
				codePoint >= 33 && codePoint <= 126 && !"[](){}<>/%".includes(character)
			)
		})
	) {
		error(
			context,
			code,
			path,
			"Expected a 1–63 character PostScript name using the permitted printable-ASCII subset.",
			"name",
		)
		return "Invalid-Name" as PostScriptName
	}
	return value as PostScriptName
}

function validateRegisteredAxisRange(
	tag: string,
	values: readonly number[],
	path: string,
	context: ValidationContext,
): void {
	const valid = values.every((value) => {
		switch (tag) {
			case "wght":
				return value >= 1 && value <= 1_000
			case "wdth":
			case "opsz":
				return value > 0
			case "ital":
				return value >= 0 && value <= 1
			case "slnt":
				return value > -90 && value < 90
			default:
				return true
		}
	})
	if (!valid) {
		error(
			context,
			"axis.registered_range",
			path,
			`Axis ${JSON.stringify(tag)} uses coordinates outside its registered range.`,
			"fvar",
		)
	}
}

function parseAxisMap(
	value: unknown,
	path: string,
	context: ValidationContext,
): readonly AxisMapEntry[] {
	const source = asArray(value, path, context, "avar")
	if (source.length > MAX_UINT16) {
		error(
			context,
			"scalar.range",
			path,
			"An avar segment map can contain at most 65,535 entries.",
			"avar",
		)
	}
	const result = source.map((entry, index): AxisMapEntry => {
		const entryPath = `${path}[${index}]`
		const record = asRecord(entry, entryPath, context, "avar") ?? {}
		exactKeys(record, ["from", "to"], entryPath, context, "avar")
		return {
			from: asF2Dot14(
				record.from,
				`${entryPath}.from`,
				context,
				"avar",
				"axis.avar.coordinate",
			),
			to: asF2Dot14(
				record.to,
				`${entryPath}.to`,
				context,
				"avar",
				"axis.avar.coordinate",
			),
		}
	})

	for (let index = 1; index < result.length; index += 1) {
		const previous = result[index - 1]
		const current = result[index]
		if (previous !== undefined && current !== undefined) {
			if (current.from <= previous.from) {
				error(
					context,
					"axis.avar.from_order",
					`${path}[${index}].from`,
					"The avar from-coordinates must be strictly increasing.",
					"avar",
				)
			}
			if (current.to < previous.to) {
				error(
					context,
					"axis.avar.to_order",
					`${path}[${index}].to`,
					"The avar to-coordinates must be nondecreasing.",
					"avar",
				)
			}
		}
	}

	for (const [from, to] of [
		[-1, -1],
		[0, 0],
		[1, 1],
	] as const) {
		if (!result.some((entry) => entry.from === from && entry.to === to)) {
			error(
				context,
				"axis.avar.anchor",
				path,
				`An avar map must include the anchor ${from}→${to}.`,
				"avar",
			)
		}
	}
	return result
}

function parseAxes(
	value: unknown,
	context: ValidationContext,
): readonly VariationAxis[] {
	const source = asArray(value, "$.axes", context, "fvar")
	if (source.length === 0 || source.length > MAX_FVAR_AXES) {
		error(
			context,
			"axis.count",
			"$.axes",
			`A variable font needs 1–${MAX_FVAR_AXES} axes so fvar instance records remain encodable.`,
			"fvar",
		)
	}
	const tags = new Set<string>()
	return source.map((axis, index): VariationAxis => {
		const path = `$.axes[${index}]`
		const record = asRecord(axis, path, context, "fvar") ?? {}
		exactKeys(
			record,
			["tag", "name", "min", "default", "max", "hidden", "map"],
			path,
			context,
			"fvar",
		)
		const tag = asAxisTag(record.tag, `${path}.tag`, context)
		if (tags.has(tag)) {
			error(
				context,
				"axis.duplicate_tag",
				`${path}.tag`,
				`Axis tag ${JSON.stringify(tag)} is duplicated.`,
				"fvar",
			)
		}
		tags.add(tag)
		const min = asFixed(
			record.min,
			`${path}.min`,
			context,
			"fvar",
			"axis.fixed",
		) as unknown as UserCoordinate
		const defaultValue = asFixed(
			record.default,
			`${path}.default`,
			context,
			"fvar",
			"axis.fixed",
		) as unknown as UserCoordinate
		const max = asFixed(
			record.max,
			`${path}.max`,
			context,
			"fvar",
			"axis.fixed",
		) as unknown as UserCoordinate
		if (min >= max) {
			error(
				context,
				"axis.range",
				path,
				"Axis min must be strictly less than max.",
				"fvar",
			)
		}
		if (defaultValue < min || defaultValue > max) {
			error(
				context,
				"axis.default_range",
				`${path}.default`,
				"Axis default must be within the inclusive min/max range.",
				"fvar",
			)
		}
		validateRegisteredAxisRange(tag, [min, defaultValue, max], path, context)
		const hidden = own(record, "hidden")
			? asBoolean(record.hidden, `${path}.hidden`, context, "fvar")
			: false
		const map = own(record, "map")
			? parseAxisMap(record.map, `${path}.map`, context)
			: null
		return {
			tag,
			name: asNonEmptyString(
				record.name,
				`${path}.name`,
				context,
				"name",
				"name.empty",
			),
			min,
			default: defaultValue,
			max,
			hidden,
			map,
		}
	})
}

function parseCoordinateRecord(
	value: unknown,
	axes: readonly VariationAxis[],
	path: string,
	context: ValidationContext,
	mode: "user" | "normalized",
): readonly number[] {
	const table = mode === "user" ? "fvar" : "gvar"
	const record = asRecord(value, path, context, table) ?? {}
	const expected = new Set(axes.map((axis) => axis.tag as string))
	const keys = Reflect.ownKeys(record).sort((left, right) =>
		String(left) < String(right) ? -1 : String(left) > String(right) ? 1 : 0,
	)
	for (const key of keys) {
		if (typeof key !== "string") {
			error(
				context,
				mode === "user" ? "instance.coordinate" : "region.axis_set",
				path,
				"Symbol coordinate keys are not permitted.",
				table,
			)
			continue
		}
		if (!expected.has(key)) {
			error(
				context,
				mode === "user" ? "instance.coordinate" : "region.axis_set",
				`${path}.${key}`,
				`Coordinate for unknown axis ${JSON.stringify(key)}.`,
				table,
			)
		}
	}
	return axes.map((axis) => {
		const tag = axis.tag as string
		const coordinatePath = `${path}.${tag}`
		if (!own(record, tag)) {
			error(
				context,
				mode === "user" ? "instance.coordinate" : "region.axis_set",
				coordinatePath,
				`Missing coordinate for axis ${JSON.stringify(tag)}.`,
				table,
			)
			return 0
		}
		if (mode === "normalized") {
			return asF2Dot14(
				record[tag],
				coordinatePath,
				context,
				"gvar",
				"region.normalized",
			)
		}
		const coordinate = asFixed(
			record[tag],
			coordinatePath,
			context,
			"fvar",
			"instance.coordinate",
		) as unknown as UserCoordinate
		if (coordinate < axis.min || coordinate > axis.max) {
			error(
				context,
				"instance.coordinate",
				coordinatePath,
				`Coordinate must be within [${axis.min}, ${axis.max}].`,
				"fvar",
			)
		}
		return coordinate
	})
}

function parseInstances(
	value: unknown,
	axes: readonly VariationAxis[],
	context: ValidationContext,
): readonly NamedInstance[] {
	const source = asArray(value, "$.instances", context, "fvar")
	if (source.length > MAX_UINT16) {
		error(
			context,
			"scalar.range",
			"$.instances",
			"fvar can encode at most 65,535 named instances.",
			"fvar",
		)
	}
	const locations = new Set<string>()
	return source.map((instance, index): NamedInstance => {
		const path = `$.instances[${index}]`
		const record = asRecord(instance, path, context, "fvar") ?? {}
		exactKeys(
			record,
			["name", "coordinates", "postScriptName", "elidable"],
			path,
			context,
			"fvar",
		)
		const coordinates = parseCoordinateRecord(
			record.coordinates,
			axes,
			`${path}.coordinates`,
			context,
			"user",
		) as readonly UserCoordinate[]
		const locationKey = coordinates.join(",")
		if (locations.has(locationKey)) {
			error(
				context,
				"instance.duplicate",
				`${path}.coordinates`,
				"Named-instance coordinates must be unique.",
				"fvar",
			)
		}
		locations.add(locationKey)
		return {
			name: asNonEmptyString(
				record.name,
				`${path}.name`,
				context,
				"name",
				"instance.name",
			),
			coordinates,
			postScriptName: own(record, "postScriptName")
				? asPostScriptName(
						record.postScriptName,
						`${path}.postScriptName`,
						context,
						"instance.postscript_name",
					)
				: null,
			elidable: own(record, "elidable")
				? asBoolean(record.elidable, `${path}.elidable`, context, "STAT")
				: false,
		}
	})
}

function validateDefaultInstanceNames(
	names: FontNames,
	axes: readonly VariationAxis[],
	instances: readonly NamedInstance[],
	context: ValidationContext,
): void {
	const emitsPostScriptNameIds = instances.some(
		(instance) => instance.postScriptName !== null,
	)
	const defaultSubfamilies = new Set<string>([
		names.subfamily,
		names.typographicSubfamily,
	])

	for (let index = 0; index < instances.length; index += 1) {
		const instance = instances[index]
		if (
			instance === undefined ||
			!instance.coordinates.every(
				(coordinate, axisIndex) => coordinate === axes[axisIndex]?.default,
			)
		) {
			continue
		}
		if (!defaultSubfamilies.has(instance.name)) {
			warning(
				context,
				"recommendation.default_instance_names",
				`$.instances[${index}].name`,
				"An fvar instance at the default location should reuse the legacy or typographic subfamily name.",
				"fvar",
			)
		}
		if (
			emitsPostScriptNameIds &&
			instance.postScriptName !== names.postScriptName
		) {
			warning(
				context,
				"recommendation.default_instance_names",
				`$.instances[${index}].postScriptName`,
				"When fvar instance PostScript-name IDs are emitted, the default-location instance should reuse the font's PostScript name.",
				"fvar",
			)
		}
	}
}

function parseMetadata(
	value: unknown,
	context: ValidationContext,
): FontMetadata {
	const record = asRecord(value, "$.metadata", context, "head") ?? {}
	exactKeys(
		record,
		[
			"unitsPerEm",
			"fontRevision",
			"vendorId",
			"lowestPpem",
			"createdAt",
			"modifiedAt",
		],
		"$.metadata",
		context,
		"head",
	)
	const unitsPerEm = asInteger(
		record.unitsPerEm,
		16,
		16_384,
		"$.metadata.unitsPerEm",
		context,
		"head",
		"metadata.units_per_em",
	) as UnitsPerEm
	if ((unitsPerEm & (unitsPerEm - 1)) !== 0) {
		warning(
			context,
			"recommendation.units_per_em_power_of_two",
			"$.metadata.unitsPerEm",
			"A power-of-two unitsPerEm is recommended for broad rasterizer compatibility.",
			"head",
		)
	}
	const createdAt = own(record, "createdAt")
		? asTimestamp(record.createdAt, "$.metadata.createdAt", context)
		: (0n as OpenTypeTimestamp)
	const modifiedAt = own(record, "modifiedAt")
		? asTimestamp(record.modifiedAt, "$.metadata.modifiedAt", context)
		: createdAt
	if (modifiedAt < createdAt) {
		error(
			context,
			"metadata.modified_before_created",
			"$.metadata.modifiedAt",
			"modifiedAt must not precede createdAt.",
			"head",
		)
	}
	return {
		unitsPerEm,
		fontRevision: asFixed(
			record.fontRevision,
			"$.metadata.fontRevision",
			context,
			"head",
			"metadata.fixed",
		),
		vendorId: asSfntTag(record.vendorId, "$.metadata.vendorId", context),
		lowestPpem: asUInt16(
			record.lowestPpem,
			"$.metadata.lowestPpem",
			context,
			"head",
		),
		createdAt,
		modifiedAt,
	}
}

function parseNames(value: unknown, context: ValidationContext): FontNames {
	const record = asRecord(value, "$.names", context, "name") ?? {}
	const keys = [
		"family",
		"subfamily",
		"uniqueId",
		"fullName",
		"version",
		"postScriptName",
		"typographicFamily",
		"typographicSubfamily",
	] as const
	exactKeys(record, keys, "$.names", context, "name")
	const strings = keys
		.filter((key) => key !== "postScriptName")
		.map((key) =>
			asNonEmptyString(record[key], `$.names.${key}`, context, "name"),
		)
	const version = strings[4] ?? ("invalid" as NonEmptyString)
	const versionMatch = /^Version\s+(\d+)\.(\d+)/i.exec(version)
	if (
		versionMatch === null ||
		Number(versionMatch[1]) >= MAX_UINT16 ||
		Number(versionMatch[2]) >= MAX_UINT16
	) {
		error(
			context,
			"name.version",
			"$.names.version",
			"Version names must begin with Version <major>.<minor>, with each component below 65,535.",
			"name",
		)
	}
	const totalUtf16Bytes = strings.reduce(
		(total, string) => total + string.length * 2,
		0,
	)
	if (
		strings.some((string) => string.length * 2 > MAX_UINT16) ||
		totalUtf16Bytes > MAX_UINT16
	) {
		error(
			context,
			"scalar.range",
			"$.names",
			"Required UTF-16BE name storage must fit 16-bit name-table offsets.",
			"name",
		)
	}
	return {
		family: strings[0] ?? ("invalid" as NonEmptyString),
		subfamily: strings[1] ?? ("invalid" as NonEmptyString),
		uniqueId: strings[2] ?? ("invalid" as NonEmptyString),
		fullName: strings[3] ?? ("invalid" as NonEmptyString),
		version,
		postScriptName: asPostScriptName(
			record.postScriptName,
			"$.names.postScriptName",
			context,
		),
		typographicFamily: strings[5] ?? ("invalid" as NonEmptyString),
		typographicSubfamily: strings[6] ?? ("invalid" as NonEmptyString),
	}
}

function parseMetrics(value: unknown, context: ValidationContext): FontMetrics {
	const record = asRecord(value, "$.metrics", context, "OS/2") ?? {}
	const keys = [
		"ascender",
		"descender",
		"lineGap",
		"winAscent",
		"winDescent",
		"xHeight",
		"capHeight",
		"underlinePosition",
		"underlineThickness",
	] as const
	exactKeys(record, keys, "$.metrics", context, "OS/2")
	const ascender = asFUnit(
		record.ascender,
		"$.metrics.ascender",
		context,
		"OS/2",
	)
	const descender = asFUnit(
		record.descender,
		"$.metrics.descender",
		context,
		"OS/2",
	)
	const lineGap = asFUnit(record.lineGap, "$.metrics.lineGap", context, "OS/2")
	if (ascender - descender + lineGap <= 0) {
		error(
			context,
			"scalar.range",
			"$.metrics",
			"The typographic baseline-to-baseline distance must be positive.",
			"OS/2",
		)
	}
	return {
		ascender,
		descender,
		lineGap,
		winAscent: asUInt16(
			record.winAscent,
			"$.metrics.winAscent",
			context,
			"OS/2",
		),
		winDescent: asUInt16(
			record.winDescent,
			"$.metrics.winDescent",
			context,
			"OS/2",
		),
		xHeight: asFUnit(record.xHeight, "$.metrics.xHeight", context, "OS/2"),
		capHeight: asFUnit(
			record.capHeight,
			"$.metrics.capHeight",
			context,
			"OS/2",
		),
		underlinePosition: asFUnit(
			record.underlinePosition,
			"$.metrics.underlinePosition",
			context,
			"post",
		),
		underlineThickness: asFUnit(
			record.underlineThickness,
			"$.metrics.underlineThickness",
			context,
			"post",
		),
	}
}

function parseStyle(value: unknown, context: ValidationContext): FontStyle {
	const record = asRecord(value, "$.style", context, "OS/2") ?? {}
	exactKeys(
		record,
		["weightClass", "widthClass", "italic", "bold", "oblique", "italicAngle"],
		"$.style",
		context,
		"OS/2",
	)
	const italic = asBoolean(record.italic, "$.style.italic", context, "OS/2")
	const oblique = asBoolean(record.oblique, "$.style.oblique", context, "OS/2")
	if (italic && oblique) {
		error(
			context,
			"style.italic_oblique",
			"$.style",
			"The OS/2 italic and oblique selection bits are mutually exclusive in this profile.",
			"OS/2",
		)
	}
	return {
		weightClass: asInteger(
			record.weightClass,
			1,
			1_000,
			"$.style.weightClass",
			context,
			"OS/2",
			"style.range",
		) as UInt16,
		widthClass: asInteger(
			record.widthClass,
			1,
			9,
			"$.style.widthClass",
			context,
			"OS/2",
			"style.range",
		) as UInt16,
		italic,
		bold: asBoolean(record.bold, "$.style.bold", context, "OS/2"),
		oblique,
		italicAngle: asFixed(
			record.italicAngle,
			"$.style.italicAngle",
			context,
			"post",
			"metadata.fixed",
		),
	}
}

function widthClassForWidth(width: number): number {
	const stops = [50, 62.5, 75, 87.5, 100, 112.5, 125, 150, 200]
	if (width <= (stops[0] ?? 50)) return 1
	if (width >= (stops[stops.length - 1] ?? 200)) return 9
	for (let index = 0; index < stops.length - 1; index += 1) {
		const left = stops[index]
		const right = stops[index + 1]
		if (left !== undefined && right !== undefined && width <= right) {
			return Math.round(index + 1 + (width - left) / (right - left))
		}
	}
	return 5
}

function validateStyleAxes(
	style: FontStyle,
	axes: readonly VariationAxis[],
	context: ValidationContext,
): void {
	const byTag = new Map(axes.map((axis) => [axis.tag as string, axis]))
	const weight = byTag.get("wght")
	if (
		weight !== undefined &&
		Number(weight.default) !== Number(style.weightClass)
	) {
		error(
			context,
			"style.axis_mismatch",
			"$.style.weightClass",
			"OS/2 weightClass must equal the default wght coordinate.",
			"OS/2",
		)
	}
	const width = byTag.get("wdth")
	if (
		width !== undefined &&
		widthClassForWidth(width.default) !== style.widthClass
	) {
		error(
			context,
			"style.axis_mismatch",
			"$.style.widthClass",
			"OS/2 widthClass must correspond to the default wdth coordinate.",
			"OS/2",
		)
	}
	const slant = byTag.get("slnt")
	if (
		slant !== undefined &&
		Number(slant.default) !== Number(style.italicAngle)
	) {
		error(
			context,
			"style.axis_mismatch",
			"$.style.italicAngle",
			"post italicAngle must equal the default slnt coordinate.",
			"post",
		)
	}
	if (
		slant !== undefined &&
		style.oblique !== (slant.default !== 0) &&
		!style.italic
	) {
		error(
			context,
			"style.axis_mismatch",
			"$.style.oblique",
			"The oblique style flag must describe the default slnt instance.",
			"OS/2",
		)
	}
	const italic = byTag.get("ital")
	if (italic !== undefined && style.italic !== (italic.default !== 0)) {
		error(
			context,
			"style.axis_mismatch",
			"$.style.italic",
			"The italic style flag must describe the default ital instance.",
			"OS/2",
		)
	}
	if (italic !== undefined && slant !== undefined) {
		warning(
			context,
			"recommendation.axis_pair",
			"$.axes",
			"Using ital and slnt together is valid but discouraged unless the family truly varies on both axes.",
			"fvar",
		)
	}
}

function parseRegion(
	value: unknown,
	axes: readonly VariationAxis[],
	path: string,
	context: ValidationContext,
): NonIntermediateRegion | IntermediateRegion {
	const record = asRecord(value, path, context, "gvar") ?? {}
	exactKeys(record, ["peak", "start", "end"], path, context, "gvar")
	const peak = parseCoordinateRecord(
		record.peak,
		axes,
		`${path}.peak`,
		context,
		"normalized",
	) as unknown as NormalizedLocation
	if (peak.every((coordinate) => coordinate === 0)) {
		error(
			context,
			"region.zero_peak",
			`${path}.peak`,
			"A gvar peak tuple must activate at least one axis.",
			"gvar",
		)
	}
	const hasStart = own(record, "start")
	const hasEnd = own(record, "end")
	if (hasStart !== hasEnd) {
		error(
			context,
			"region.intermediate",
			path,
			"Intermediate regions must provide both start and end tuples.",
			"gvar",
		)
	}
	if (hasStart && hasEnd) {
		const start = parseCoordinateRecord(
			record.start,
			axes,
			`${path}.start`,
			context,
			"normalized",
		) as unknown as NormalizedLocation
		const end = parseCoordinateRecord(
			record.end,
			axes,
			`${path}.end`,
			context,
			"normalized",
		) as unknown as NormalizedLocation
		for (let index = 0; index < axes.length; index += 1) {
			const startValue = start[index] ?? 0
			const peakValue = peak[index] ?? 0
			const endValue = end[index] ?? 0
			if (
				startValue > peakValue ||
				peakValue > endValue ||
				(startValue < 0 && endValue > 0 && peakValue !== 0)
			) {
				error(
					context,
					"region.intermediate",
					`${path}.peak.${axes[index]?.tag ?? index}`,
					"Each intermediate support must satisfy start ≤ peak ≤ end and cannot cross zero for a nonzero peak.",
					"gvar",
				)
			}
		}
		return { kind: "intermediate", peak, start, end }
	}
	return { kind: "non-intermediate", peak }
}

function parsePoint(
	value: unknown,
	path: string,
	context: ValidationContext,
): Point {
	const record = asRecord(value, path, context, "glyf") ?? {}
	exactKeys(record, ["x", "y", "onCurve"], path, context, "glyf")
	return {
		x: asGlyphCoordinate(record.x, `${path}.x`, context),
		y: asGlyphCoordinate(record.y, `${path}.y`, context),
		onCurve: asBoolean(record.onCurve, `${path}.onCurve`, context, "glyf"),
	}
}

function parsePointDelta(
	value: unknown,
	path: string,
	context: ValidationContext,
): PointDelta {
	const record = asRecord(value, path, context, "gvar") ?? {}
	exactKeys(record, ["x", "y"], path, context, "gvar")
	return {
		x: asVariationDelta(record.x, `${path}.x`, context),
		y: asVariationDelta(record.y, `${path}.y`, context),
	}
}

function parseVariation(
	value: unknown,
	axes: readonly VariationAxis[],
	pointCount: number,
	path: string,
	context: ValidationContext,
): GlyphVariation {
	const record = asRecord(value, path, context, "gvar") ?? {}
	exactKeys(record, ["region", "deltas"], path, context, "gvar")
	const deltasRecord =
		asRecord(record.deltas, `${path}.deltas`, context, "gvar") ?? {}
	exactKeys(
		deltasRecord,
		["points", "phantom"],
		`${path}.deltas`,
		context,
		"gvar",
	)
	const pointSource = asArray(
		deltasRecord.points,
		`${path}.deltas.points`,
		context,
		"gvar",
	)
	if (pointSource.length !== pointCount) {
		error(
			context,
			"glyph.glyf_delta",
			`${path}.deltas.points`,
			`Complete gvar coverage requires exactly ${pointCount} point deltas; received ${pointSource.length}.`,
			"gvar",
		)
	}
	const points = pointSource.map((delta, index) =>
		parsePointDelta(delta, `${path}.deltas.points[${index}]`, context),
	)
	const phantomPath = `${path}.deltas.phantom`
	const phantom =
		asRecord(deltasRecord.phantom, phantomPath, context, "gvar") ?? {}
	exactKeys(
		phantom,
		["left", "right", "top", "bottom"],
		phantomPath,
		context,
		"gvar",
	)
	const phantomDeltas = {
		left: asVariationDelta(phantom.left, `${phantomPath}.left`, context),
		right: asVariationDelta(phantom.right, `${phantomPath}.right`, context),
		top: asVariationDelta(phantom.top, `${phantomPath}.top`, context),
		bottom: asVariationDelta(phantom.bottom, `${phantomPath}.bottom`, context),
	}
	const xDeltas = [
		...points.map((delta) => delta.x as number),
		phantomDeltas.left,
		phantomDeltas.right,
		0,
		0,
	]
	const yDeltas = [
		...points.map((delta) => delta.y as number),
		0,
		0,
		phantomDeltas.top,
		phantomDeltas.bottom,
	]
	const variationDataSize =
		1 + packedDeltaSize(xDeltas) + packedDeltaSize(yDeltas)
	if (variationDataSize > MAX_UINT16) {
		error(
			context,
			"glyph.gvar_data_size",
			`${path}.deltas`,
			"The tuple's packed point and delta data exceeds gvar's 16-bit variationDataSize field.",
			"gvar",
		)
	}
	return {
		region: parseRegion(record.region, axes, `${path}.region`, context),
		deltas: {
			points,
			phantom: phantomDeltas,
		},
	}
}

function validateRelativeCoordinates(
	points: readonly Point[],
	path: string,
	context: ValidationContext,
): void {
	let previousX = 0
	let previousY = 0
	for (let index = 0; index < points.length; index += 1) {
		const point = points[index]
		if (point === undefined) continue
		const deltaX = point.x - previousX
		const deltaY = point.y - previousY
		if (
			deltaX < MIN_INT16 ||
			deltaX > MAX_INT16 ||
			deltaY < MIN_INT16 ||
			deltaY > MAX_INT16
		) {
			error(
				context,
				"glyph.relative_coordinate",
				path,
				"Sequential glyf coordinates must have signed 16-bit relative deltas.",
				"glyf",
			)
			return
		}
		previousX = point.x
		previousY = point.y
	}
}

function getXBounds(points: readonly Point[]): {
	readonly xMin: number
	readonly xMax: number
} {
	let xMin = Number.POSITIVE_INFINITY
	let xMax = Number.NEGATIVE_INFINITY
	for (const point of points) {
		xMin = Math.min(xMin, point.x)
		xMax = Math.max(xMax, point.x)
	}
	return { xMin, xMax }
}

function parseGlyphs(
	value: unknown,
	axes: readonly VariationAxis[],
	context: ValidationContext,
): readonly SimpleGlyph[] {
	const source = asArray(value, "$.glyphs", context, "glyf")
	if (source.length === 0 || source.length > MAX_UINT16) {
		error(
			context,
			"glyph.count",
			"$.glyphs",
			"A font must contain 1–65,535 glyphs.",
			"maxp",
		)
	}
	const glyphNames = new Set<string>()
	const glyphs = source.map((glyph, glyphIndex): SimpleGlyph => {
		const path = `$.glyphs[${glyphIndex}]`
		const record = asRecord(glyph, path, context, "glyf") ?? {}
		exactKeys(
			record,
			[
				"kind",
				"name",
				"advanceWidth",
				"leftSideBearing",
				"contours",
				"variations",
				"overlap",
			],
			path,
			context,
			"glyf",
		)
		if (record.kind !== "simple") {
			error(
				context,
				"scalar.type",
				`${path}.kind`,
				"Version 1 accepts only unhinted simple TrueType glyphs.",
				"glyf",
			)
		}
		const name = asNonEmptyString(
			record.name,
			`${path}.name`,
			context,
			"glyf",
			"glyph.name",
		)
		if (glyphNames.has(name)) {
			error(
				context,
				"glyph.name",
				`${path}.name`,
				`Glyph name ${JSON.stringify(name)} is duplicated.`,
				"glyf",
			)
		}
		glyphNames.add(name)
		const advanceWidth = asUInt16(
			record.advanceWidth,
			`${path}.advanceWidth`,
			context,
			"hmtx",
		) as number as AdvanceWidth
		const leftSideBearing = asFUnit(
			record.leftSideBearing,
			`${path}.leftSideBearing`,
			context,
			"hmtx",
		)
		const contourSource = asArray(
			record.contours,
			`${path}.contours`,
			context,
			"glyf",
		)
		if (contourSource.length > MAX_INT16) {
			error(
				context,
				"glyph.contour_count",
				`${path}.contours`,
				"A simple glyph can contain at most 32,767 contours.",
				"glyf",
			)
		}
		const contours = contourSource.map((contour, contourIndex) => {
			const contourPath = `${path}.contours[${contourIndex}]`
			const points = asArray(contour, contourPath, context, "glyf")
			if (points.length === 0) {
				error(
					context,
					"glyph.empty_contour",
					contourPath,
					"Contours cannot be empty; use zero contours for an empty glyph.",
					"glyf",
				)
			}
			return points.map((point, pointIndex) =>
				parsePoint(point, `${contourPath}[${pointIndex}]`, context),
			) as unknown as NonEmptyReadonlyArray<Point>
		})
		const flattened = contours.flat()
		if (flattened.length > MAX_UINT16) {
			error(
				context,
				"glyph.point_count",
				`${path}.contours`,
				"maxp and glyf can encode at most 65,535 points in one simple glyph.",
				"maxp",
			)
		}
		validateRelativeCoordinates(flattened, `${path}.contours`, context)
		if (flattened.length === 0) {
			if (leftSideBearing !== 0) {
				error(
					context,
					"glyph.lsb",
					`${path}.leftSideBearing`,
					"An empty glyph must use a zero left side bearing in this profile.",
					"hmtx",
				)
			}
		} else {
			const { xMin } = getXBounds(flattened)
			if (leftSideBearing !== xMin) {
				error(
					context,
					"glyph.lsb",
					`${path}.leftSideBearing`,
					`Variable TrueType glyphs require leftSideBearing (${leftSideBearing}) to equal xMin (${xMin}).`,
					"hmtx",
				)
			}
		}
		const variationSource = asArray(
			record.variations,
			`${path}.variations`,
			context,
			"gvar",
		)
		if (variationSource.length > MAX_GVAR_TUPLES) {
			error(
				context,
				"glyph.gvar_count",
				`${path}.variations`,
				"gvar permits at most 4,095 tuple-variation records per glyph.",
				"gvar",
			)
		}
		const variations = variationSource.map((variation, variationIndex) =>
			parseVariation(
				variation,
				axes,
				flattened.length,
				`${path}.variations[${variationIndex}]`,
				context,
			),
		)
		const intermediateCount = variations.filter(
			(variation) => variation.region.kind === "intermediate",
		).length
		const embeddedHeaderSize =
			4 +
			variations.length * 4 +
			variations.length * axes.length * 2 +
			intermediateCount * axes.length * 4
		if (embeddedHeaderSize > MAX_UINT16) {
			error(
				context,
				"glyph.gvar_count",
				`${path}.variations`,
				"The logical tuple headers cannot be represented by gvar's 16-bit data offset.",
				"gvar",
			)
		}
		const overlap = own(record, "overlap")
			? asBoolean(record.overlap, `${path}.overlap`, context, "glyf")
			: false
		if (overlap && flattened.length === 0) {
			error(
				context,
				"glyph.overlap",
				`${path}.overlap`,
				"An empty glyph has no first point on which glyf can encode OVERLAP_SIMPLE.",
				"glyf",
			)
		}
		return {
			kind: "simple",
			name,
			advanceWidth,
			leftSideBearing,
			contours,
			variations,
			overlap,
		}
	})
	if (glyphs[0]?.name !== ".notdef") {
		error(
			context,
			"glyph.notdef",
			"$.glyphs[0].name",
			"Glyph ID 0 must be named .notdef.",
			"glyf",
		)
	}
	if (glyphs[0] !== undefined && glyphs[0].contours.length === 0) {
		warning(
			context,
			"recommendation.notdef_outline",
			"$.glyphs[0].contours",
			"A visible .notdef outline is recommended so missing characters are apparent.",
			"glyf",
		)
	}
	return glyphs
}

function parseCmap(
	value: unknown,
	glyphCount: number,
	context: ValidationContext,
): readonly CharacterMapEntry[] {
	const source = asArray(value, "$.cmap", context, "cmap")
	if (source.length === 0) {
		error(
			context,
			"cmap.code_point",
			"$.cmap",
			"This profile requires at least one Unicode character mapping.",
			"cmap",
		)
	}
	const codePoints = new Set<number>()
	const result = source.map((entry, index): CharacterMapEntry => {
		const path = `$.cmap[${index}]`
		const record = asRecord(entry, path, context, "cmap") ?? {}
		exactKeys(record, ["codePoint", "glyph"], path, context, "cmap")
		const codePoint = asInteger(
			record.codePoint,
			0,
			0x10_ffff,
			`${path}.codePoint`,
			context,
			"cmap",
			"cmap.code_point",
		)
		if (codePoint >= 0xd800 && codePoint <= 0xdfff) {
			error(
				context,
				"cmap.code_point",
				`${path}.codePoint`,
				"Unicode surrogate code points are not scalar values.",
				"cmap",
			)
		}
		if (codePoints.has(codePoint)) {
			error(
				context,
				"cmap.duplicate",
				`${path}.codePoint`,
				`U+${codePoint.toString(16).toUpperCase().padStart(4, "0")} is mapped more than once.`,
				"cmap",
			)
		}
		codePoints.add(codePoint)
		const glyph = asInteger(
			record.glyph,
			0,
			Math.max(0, glyphCount - 1),
			`${path}.glyph`,
			context,
			"cmap",
			"cmap.glyph",
		)
		return {
			codePoint: codePoint as UnicodeScalar,
			glyph: glyph as CharacterMapEntry["glyph"],
		}
	})
	const uffffIndex = result.findIndex((entry) => entry.codePoint === 0xffff)
	if (uffffIndex >= 0 && !result.some((entry) => entry.codePoint > 0xffff)) {
		error(
			context,
			"cmap.code_point",
			`$.cmap[${uffffIndex}].codePoint`,
			"A BMP-only Windows cmap reserves U+FFFF for format 4's terminal missing-glyph segment.",
			"cmap",
		)
	}
	return result.sort((left, right) => left.codePoint - right.codePoint)
}

function validateCmapCapacity(
	cmap: readonly CharacterMapEntry[],
	context: ValidationContext,
): void {
	const plan = createCmapEncodingPlan(cmap)
	if (
		plan.format === 4 &&
		(plan.subtableLength > MAX_UINT16 || plan.segmentCount * 2 > MAX_UINT16)
	) {
		error(
			context,
			"font.table_size",
			"$.cmap",
			"The canonical Windows BMP cmap cannot fit format 4's 16-bit length and segment-count fields.",
			"cmap",
		)
	}
	if (
		plan.format === 12 &&
		(plan.subtableLength > MAX_UINT32 || plan.groupCount > MAX_UINT32)
	) {
		error(
			context,
			"font.table_size",
			"$.cmap",
			"The canonical full-repertoire cmap cannot fit format 12's 32-bit fields.",
			"cmap",
		)
	}
}

function getOneAxisBreakpoints(
	variations: readonly GlyphVariation[],
): readonly number[] {
	const values = new Set([-1, 0, 1])
	const addBoundary = (value: number): void => {
		values.add(value)
		const previous = value - 1 / 16_384
		const next = value + 1 / 16_384
		if (previous >= -1) values.add(previous)
		if (next <= 1) values.add(next)
	}
	for (const variation of variations) {
		addBoundary(Number(variation.region.peak[0] ?? 0))
		if (variation.region.kind === "intermediate") {
			addBoundary(Number(variation.region.start[0] ?? 0))
			addBoundary(Number(variation.region.end[0] ?? 0))
		}
	}
	return [...values].sort((left, right) => left - right)
}

function addLinearRange(
	slopeChanges: Float64Array,
	interceptChanges: Float64Array,
	start: number,
	end: number,
	slope: number,
	intercept: number,
): void {
	if (start > end) return
	slopeChanges[start] = (slopeChanges[start] ?? 0) + slope
	interceptChanges[start] = (interceptChanges[start] ?? 0) + intercept
	slopeChanges[end + 1] = (slopeChanges[end + 1] ?? 0) - slope
	interceptChanges[end + 1] = (interceptChanges[end + 1] ?? 0) - intercept
}

function getOneAxisExtrema(
	base: number,
	variations: readonly GlyphVariation[],
	coefficient: (variation: GlyphVariation) => number,
	breakpoints: readonly number[],
): { readonly minimum: number; readonly maximum: number } {
	const indexByValue = new Map(
		breakpoints.map((value, index) => [value, index]),
	)
	const slopeChanges = new Float64Array(breakpoints.length + 1)
	const interceptChanges = new Float64Array(breakpoints.length + 1)
	const pointAdjustments = new Float64Array(breakpoints.length)

	for (const variation of variations) {
		const amount = coefficient(variation)
		if (amount === 0) continue
		const peak = Number(variation.region.peak[0] ?? 0)
		const start =
			variation.region.kind === "intermediate"
				? Number(variation.region.start[0] ?? 0)
				: Math.min(0, peak)
		const end =
			variation.region.kind === "intermediate"
				? Number(variation.region.end[0] ?? 0)
				: Math.max(0, peak)
		if (
			start > peak ||
			peak > end ||
			(start < 0 && end > 0 && peak !== 0) ||
			peak === 0
		) {
			addLinearRange(
				slopeChanges,
				interceptChanges,
				0,
				breakpoints.length - 1,
				0,
				amount,
			)
			continue
		}

		const startIndex = indexByValue.get(start)
		const peakIndex = indexByValue.get(peak)
		const endIndex = indexByValue.get(end)
		if (
			startIndex === undefined ||
			peakIndex === undefined ||
			endIndex === undefined
		) {
			continue
		}
		if (start === peak && peak === end) {
			pointAdjustments[peakIndex] = (pointAdjustments[peakIndex] ?? 0) + amount
			continue
		}
		if (start < peak) {
			const divisor = peak - start
			addLinearRange(
				slopeChanges,
				interceptChanges,
				startIndex,
				peakIndex,
				amount / divisor,
				(-amount * start) / divisor,
			)
		}
		if (peak < end) {
			const divisor = end - peak
			addLinearRange(
				slopeChanges,
				interceptChanges,
				start < peak ? peakIndex + 1 : peakIndex,
				endIndex,
				-amount / divisor,
				(amount * end) / divisor,
			)
		}
	}

	let slope = 0
	let intercept = 0
	let minimum = Number.POSITIVE_INFINITY
	let maximum = Number.NEGATIVE_INFINITY
	for (let index = 0; index < breakpoints.length; index += 1) {
		slope += slopeChanges[index] ?? 0
		intercept += interceptChanges[index] ?? 0
		const value =
			base +
			slope * (breakpoints[index] ?? 0) +
			intercept +
			(pointAdjustments[index] ?? 0)
		minimum = Math.min(minimum, value)
		maximum = Math.max(maximum, value)
	}
	return { minimum, maximum }
}

function validateDerivedMetrics(
	glyphs: readonly SimpleGlyph[],
	metrics: FontMetrics,
	axisCount: number,
	context: ValidationContext,
): void {
	let minRightSideBearing = Number.POSITIVE_INFINITY
	let maxXExtent = Number.NEGATIVE_INFINITY
	let hasContourGlyph = false
	let conservativeYMin = 0
	let conservativeYMax = 0
	let advanceTotal = 0
	let nonzeroAdvances = 0

	for (let glyphIndex = 0; glyphIndex < glyphs.length; glyphIndex += 1) {
		const glyph = glyphs[glyphIndex]
		if (glyph === undefined) continue
		const points = glyph.contours.flat()
		const bounds = getXBounds(points)
		const xMin = points.length === 0 ? 0 : bounds.xMin
		const xMax = points.length === 0 ? 0 : bounds.xMax
		if (points.length > 0) {
			const width = xMax - xMin
			const rightSideBearing =
				glyph.advanceWidth - glyph.leftSideBearing - width
			minRightSideBearing = Math.min(minRightSideBearing, rightSideBearing)
			maxXExtent = Math.max(maxXExtent, glyph.leftSideBearing + width)
			hasContourGlyph = true
		}
		if (glyph.advanceWidth !== 0) {
			advanceTotal += glyph.advanceWidth
			nonzeroAdvances += 1
		}
		let minimumAdvance: number
		let maximumAdvance: number
		let coordinateVariationOutOfRange = false
		if (axisCount === 1) {
			const breakpoints = getOneAxisBreakpoints(glyph.variations)
			const advance = getOneAxisExtrema(
				Number(glyph.advanceWidth),
				glyph.variations,
				(variation) =>
					Number(variation.deltas.phantom.right) -
					Number(variation.deltas.phantom.left),
				breakpoints,
			)
			minimumAdvance = advance.minimum
			maximumAdvance = advance.maximum
			for (let pointIndex = 0; pointIndex < points.length; pointIndex += 1) {
				const point = points[pointIndex]
				if (point === undefined) continue
				const x = getOneAxisExtrema(
					Number(point.x),
					glyph.variations,
					(variation) => Number(variation.deltas.points[pointIndex]?.x ?? 0),
					breakpoints,
				)
				const y = getOneAxisExtrema(
					Number(point.y),
					glyph.variations,
					(variation) => Number(variation.deltas.points[pointIndex]?.y ?? 0),
					breakpoints,
				)
				if (
					x.minimum < MIN_GLYPH_COORDINATE - 1e-9 ||
					x.maximum > MAX_GLYPH_COORDINATE + 1e-9 ||
					y.minimum < MIN_GLYPH_COORDINATE - 1e-9 ||
					y.maximum > MAX_GLYPH_COORDINATE + 1e-9
				) {
					coordinateVariationOutOfRange = true
				}
				conservativeYMin = Math.min(conservativeYMin, y.minimum)
				conservativeYMax = Math.max(conservativeYMax, y.maximum)
			}
		} else {
			minimumAdvance = Number(glyph.advanceWidth)
			maximumAdvance = Number(glyph.advanceWidth)
			for (const variation of glyph.variations) {
				const advanceDelta =
					Number(variation.deltas.phantom.right) -
					Number(variation.deltas.phantom.left)
				minimumAdvance += Math.min(0, advanceDelta)
				maximumAdvance += Math.max(0, advanceDelta)
			}
			for (let pointIndex = 0; pointIndex < points.length; pointIndex += 1) {
				const point = points[pointIndex]
				if (point === undefined) continue
				let minDeltaX = 0
				let maxDeltaX = 0
				let minDeltaY = 0
				let maxDeltaY = 0
				for (const variation of glyph.variations) {
					const delta = variation.deltas.points[pointIndex]
					const deltaX = delta?.x ?? 0
					const deltaY = delta?.y ?? 0
					minDeltaX += Math.min(0, deltaX)
					maxDeltaX += Math.max(0, deltaX)
					minDeltaY += Math.min(0, deltaY)
					maxDeltaY += Math.max(0, deltaY)
				}
				if (
					point.x + minDeltaX < MIN_GLYPH_COORDINATE ||
					point.x + maxDeltaX > MAX_GLYPH_COORDINATE ||
					point.y + minDeltaY < MIN_GLYPH_COORDINATE ||
					point.y + maxDeltaY > MAX_GLYPH_COORDINATE
				) {
					coordinateVariationOutOfRange = true
				}
				conservativeYMin = Math.min(conservativeYMin, point.y + minDeltaY)
				conservativeYMax = Math.max(conservativeYMax, point.y + maxDeltaY)
			}
		}
		if (minimumAdvance < 0 || maximumAdvance > MAX_UINT16) {
			error(
				context,
				"glyph.metric_variation",
				`$.glyphs[${glyphIndex}].variations`,
				axisCount === 1
					? "The exact one-axis variation support must keep advance width within the unsigned 16-bit metric range."
					: "Conservative multi-axis gvar bounds must keep advance width within the unsigned 16-bit metric range.",
				"gvar",
			)
		}
		if (coordinateVariationOutOfRange) {
			error(
				context,
				"glyph.coordinate",
				`$.glyphs[${glyphIndex}].variations`,
				axisCount === 1
					? "The exact one-axis variation support must keep every outline point within the TrueType grid [-16384, 16383]."
					: "Conservative multi-axis variation bounds must keep every outline point within the TrueType grid [-16384, 16383].",
				"gvar",
			)
		}
	}

	if (
		hasContourGlyph &&
		(minRightSideBearing < MIN_INT16 ||
			minRightSideBearing > MAX_INT16 ||
			maxXExtent < MIN_INT16 ||
			maxXExtent > MAX_INT16)
	) {
		error(
			context,
			"glyph.table_metric",
			"$.glyphs",
			"Derived hhea extrema must fit signed 16-bit fields.",
			"hhea",
		)
	}
	const averageAdvance =
		nonzeroAdvances === 0 ? 0 : Math.round(advanceTotal / nonzeroAdvances)
	if (averageAdvance > MAX_INT16) {
		error(
			context,
			"glyph.table_metric",
			"$.glyphs",
			"The derived OS/2 xAvgCharWidth must fit a signed 16-bit field.",
			"OS/2",
		)
	}
	const requiredAscent = Math.max(0, Math.ceil(conservativeYMax - 1e-9))
	const requiredDescent = Math.max(0, Math.ceil(-conservativeYMin - 1e-9))
	if (
		metrics.winAscent < requiredAscent ||
		metrics.winDescent < requiredDescent
	) {
		error(
			context,
			"win_metrics.coverage",
			"$.metrics",
			`winAscent/winDescent must cover ${
				axisCount === 1 ? "exact one-axis" : "conservative multi-axis"
			} variation bounds (+${requiredAscent}/-${requiredDescent}).`,
			"OS/2",
		)
	}
}

function validateNameAndStatCapacity(
	names: FontNames,
	axes: readonly VariationAxis[],
	instances: readonly NamedInstance[],
	context: ValidationContext,
): void {
	const baseNames = [
		names.family,
		names.subfamily,
		names.uniqueId,
		names.fullName,
		names.version,
		names.postScriptName,
		names.typographicFamily,
		names.typographicSubfamily,
	]
	const customNames = [
		...axes.map((axis) => axis.name),
		...instances.map((instance) => instance.name),
		...instances.flatMap((instance) =>
			instance.postScriptName === null ? [] : [instance.postScriptName],
		),
	]
	const recordCount = baseNames.length + customNames.length
	if (6 + recordCount * 12 > MAX_UINT16) {
		error(
			context,
			"scalar.range",
			"$.instances",
			"The Windows name records would place name-table string storage beyond its 16-bit offset.",
			"name",
		)
	}
	const uniqueStrings = new Set([...baseNames, ...customNames])
	let storageBytes = 0
	for (const string of uniqueStrings) {
		const byteLength = string.length * 2
		if (byteLength > MAX_UINT16) {
			error(
				context,
				"scalar.range",
				"$.names",
				"Every UTF-16BE name string must fit a 16-bit length field.",
				"name",
			)
		}
		storageBytes += byteLength
	}
	if (storageBytes > MAX_UINT16) {
		error(
			context,
			"scalar.range",
			"$.names",
			"Deduplicated UTF-16BE name storage must fit 16-bit string offsets.",
			"name",
		)
	}

	if (instances.length > 0) {
		const axisValueSize = axes.length === 1 ? 12 : 8 + axes.length * 6
		const lastAxisValueOffset =
			instances.length * 2 + (instances.length - 1) * axisValueSize
		if (lastAxisValueOffset > MAX_UINT16) {
			error(
				context,
				"scalar.range",
				"$.instances",
				"STAT axis-value tables for named instances exceed 16-bit offsets.",
				"STAT",
			)
		}
	}
}

function validateTopLevelTableSizes(
	glyphs: readonly SimpleGlyph[],
	axes: readonly VariationAxis[],
	instances: readonly NamedInstance[],
	cmap: readonly CharacterMapEntry[],
	names: FontNames,
	context: ValidationContext,
): void {
	const plan = createCanonicalEncodingPlan({
		glyphs,
		axes,
		instances,
		cmap,
		names,
	})
	for (const table of plan.tableLengths) {
		if (table.length <= MAX_UINT32) continue
		const path =
			table.tag === "cmap"
				? "$.cmap"
				: table.tag === "name"
					? "$.names"
					: table.tag === "glyf" ||
						  table.tag === "gvar" ||
						  table.tag === "loca" ||
						  table.tag === "hmtx"
						? "$.glyphs"
						: "$.axes"
		error(
			context,
			"font.table_size",
			path,
			`The canonical ${table.tag} table would exceed an SFNT table's 32-bit length.`,
			table.tag,
		)
	}
	if (plan.sfntSize > MAX_UINT32) {
		error(
			context,
			"font.table_size",
			"$",
			"The padded font and table directory exceed the SFNT 32-bit offset address space.",
			"sfnt",
		)
	}
}

function deepFreeze<Value>(value: Value): Value {
	if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
		return value
	}
	for (const child of Object.values(value)) {
		deepFreeze(child)
	}
	return Object.freeze(value)
}

function sortDiagnostics(diagnostics: Diagnostic[]): readonly Diagnostic[] {
	const compare = (left: string, right: string): number =>
		left < right ? -1 : left > right ? 1 : 0
	return diagnostics.sort(
		(left, right) =>
			compare(left.path, right.path) ||
			compare(left.code, right.code) ||
			compare(left.message, right.message),
	)
}

/**
 * Validates, canonicalizes, clones, brands, and deeply freezes an untrusted
 * logical variable-font value. A successful result is the sole public route to
 * a `VariableFont` accepted by lowering APIs.
 */
function ingestVariableFontData(value: unknown): IngestResult {
	const context: ValidationContext = { errors: [], warnings: [] }
	const source = asRecord(value, "$", context, "sfnt")
	if (source === null) {
		const errors = sortDiagnostics(
			context.errors,
		) as NonEmptyReadonlyArray<Diagnostic>
		return deepFreeze({ ok: false, errors, warnings: [] })
	}
	exactKeys(
		source,
		[
			"format",
			"irVersion",
			"metadata",
			"names",
			"metrics",
			"style",
			"axes",
			"instances",
			"glyphs",
			"cmap",
		],
		"$",
		context,
		"sfnt",
	)
	if (source.format !== TRIGRAPH_FORMAT) {
		error(
			context,
			"font.format",
			"$.format",
			`Expected ${JSON.stringify(TRIGRAPH_FORMAT)}.`,
			"sfnt",
		)
	}
	if (source.irVersion !== TRIGRAPH_IR_VERSION) {
		error(
			context,
			"font.ir_version",
			"$.irVersion",
			`Expected IR version ${TRIGRAPH_IR_VERSION}.`,
			"sfnt",
		)
	}

	const metadata = parseMetadata(source.metadata, context)
	const names = parseNames(source.names, context)
	const metrics = parseMetrics(source.metrics, context)
	const style = parseStyle(source.style, context)
	const axes = parseAxes(source.axes, context)
	const instances = parseInstances(source.instances, axes, context)
	const glyphs = parseGlyphs(source.glyphs, axes, context)
	const cmap = parseCmap(source.cmap, glyphs.length, context)
	validateStyleAxes(style, axes, context)
	validateDerivedMetrics(glyphs, metrics, axes.length, context)
	validateDefaultInstanceNames(names, axes, instances, context)
	validateCmapCapacity(cmap, context)
	validateNameAndStatCapacity(names, axes, instances, context)
	validateTopLevelTableSizes(glyphs, axes, instances, cmap, names, context)

	const customNameCount =
		axes.length +
		instances.length +
		instances.filter((instance) => instance.postScriptName !== null).length
	if (customNameCount > 32_512) {
		error(
			context,
			"scalar.range",
			"$.instances",
			"Axis and instance labels exceed the custom name-ID range 256–32767.",
			"name",
		)
	}

	const warnings = sortDiagnostics(context.warnings)
	if (context.errors.length > 0) {
		const errors = sortDiagnostics(
			context.errors,
		) as NonEmptyReadonlyArray<Diagnostic>
		return deepFreeze({ ok: false, errors, warnings })
	}

	const font = {
		format: TRIGRAPH_FORMAT,
		irVersion: TRIGRAPH_IR_VERSION,
		metadata,
		names,
		metrics,
		style,
		axes,
		instances,
		glyphs,
		cmap,
	} as VariableFont
	markVariableFontValidated(font)
	return deepFreeze({ ok: true, value: font, warnings })
}

export function ingestVariableFont(value: unknown): IngestResult {
	try {
		return ingestVariableFontData(value)
	} catch {
		return deepFreeze({
			ok: false,
			errors: [
				{
					severity: "error",
					code: "font.object",
					path: "$",
					message: "The source value could not be read as inert data.",
					table: "sfnt",
				},
			],
			warnings: [],
		})
	}
}
