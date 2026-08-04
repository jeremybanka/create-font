import {
	DEFAULT_DESIGN_STROKE_STYLE,
	IDENTITY_DESIGN_TRANSFORM,
	type DesignAppearance,
	type DesignArtboard,
	type DesignContour,
	type DesignDocument,
	type DesignGroup,
	type DesignObject,
	type DesignPoint,
	type DesignSceneChild,
	type DesignSwatch,
	type DesignTransform,
} from "@create-design/source"

import type {
	SvgDiagnostic,
	SvgImportOptions,
	SvgImportResult,
} from "./types.ts"

interface XmlElement {
	readonly attributes: Readonly<Record<string, string>>
	readonly children: XmlElement[]
	readonly name: string
	text: string
}

const decodeXml = (value: string): string =>
	value
		.replaceAll("&quot;", '"')
		.replaceAll("&apos;", "'")
		.replaceAll("&lt;", "<")
		.replaceAll("&gt;", ">")
		.replaceAll("&amp;", "&")

function parseXml(source: string): XmlElement {
	if (/<!DOCTYPE|<!ENTITY/iu.test(source))
		throw new Error(
			"SVG document type and entity declarations are not supported.",
		)
	const root: XmlElement = {
		attributes: {},
		children: [],
		name: "#document",
		text: "",
	}
	const stack = [root]
	const tokenPattern =
		/<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|<[^>]+>|[^<]+/gu
	for (const match of source.matchAll(tokenPattern)) {
		const token = match[0]
		if (token.startsWith("<!--") || token.startsWith("<?")) continue
		if (token.startsWith("<![CDATA[")) {
			stack.at(-1)!.text += token.slice(9, -3)
			continue
		}
		if (!token.startsWith("<")) {
			stack.at(-1)!.text += decodeXml(token)
			continue
		}
		if (token.startsWith("</")) {
			const name = token.slice(2, -1).trim().split(":").at(-1)!.toLowerCase()
			const current = stack.pop()
			if (current === undefined || current.name !== name)
				throw new Error(`Mismatched SVG closing element </${name}>.`)
			continue
		}
		if (token.startsWith("<!")) continue
		const selfClosing = /\/\s*>$/u.test(token)
		const body = token
			.slice(1, selfClosing ? token.lastIndexOf("/") : -1)
			.trim()
		const nameMatch = /^([^\s/>]+)/u.exec(body)
		if (nameMatch === null) throw new Error("Malformed SVG element.")
		const rawName = nameMatch[1]!
		const name = rawName.split(":").at(-1)!.toLowerCase()
		const attributes: Record<string, string> = {}
		const rest = body.slice(rawName.length)
		const attributePattern = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/gu
		let consumed = ""
		for (const attribute of rest.matchAll(attributePattern)) {
			const key = attribute[1]!.split(":").at(-1)!.toLowerCase()
			attributes[key] = decodeXml(attribute[2] ?? attribute[3] ?? "")
			consumed += attribute[0]
		}
		if (rest.replace(attributePattern, "").trim().length > 0)
			throw new Error(`Malformed attributes on <${name}>.`)
		void consumed
		const element: XmlElement = { attributes, children: [], name, text: "" }
		stack.at(-1)!.children.push(element)
		if (!selfClosing) stack.push(element)
	}
	if (stack.length !== 1)
		throw new Error(`Unclosed SVG element <${stack.at(-1)!.name}>.`)
	const svg = root.children.find(({ name }) => name === "svg")
	if (svg === undefined)
		throw new Error("The imported document has no <svg> root.")
	return svg
}

function multiply(
	left: DesignTransform,
	right: DesignTransform,
): DesignTransform {
	return {
		a: left.a * right.a + left.c * right.b,
		b: left.b * right.a + left.d * right.b,
		c: left.a * right.c + left.c * right.d,
		d: left.b * right.c + left.d * right.d,
		e: left.a * right.e + left.c * right.f + left.e,
		f: left.b * right.e + left.d * right.f + left.f,
	}
}

function transformFunction(
	name: string,
	values: readonly number[],
): DesignTransform {
	if (name === "matrix" && values.length === 6) {
		const [a, b, c, d, e, f] = values as [
			number,
			number,
			number,
			number,
			number,
			number,
		]
		return { a, b, c, d, e, f }
	}
	if (name === "translate" && (values.length === 1 || values.length === 2))
		return { ...IDENTITY_DESIGN_TRANSFORM, e: values[0]!, f: values[1] ?? 0 }
	if (name === "scale" && (values.length === 1 || values.length === 2))
		return { a: values[0]!, b: 0, c: 0, d: values[1] ?? values[0]!, e: 0, f: 0 }
	if (name === "rotate" && (values.length === 1 || values.length === 3)) {
		const radians = (values[0]! * Math.PI) / 180
		const rotation = {
			a: Math.cos(radians),
			b: Math.sin(radians),
			c: -Math.sin(radians),
			d: Math.cos(radians),
			e: 0,
			f: 0,
		}
		if (values.length === 1) return rotation
		const [x, y] = values.slice(1) as [number, number]
		return multiply(
			multiply({ ...IDENTITY_DESIGN_TRANSFORM, e: x, f: y }, rotation),
			{ ...IDENTITY_DESIGN_TRANSFORM, e: -x, f: -y },
		)
	}
	if ((name === "skewx" || name === "skewy") && values.length === 1) {
		const tangent = Math.tan((values[0]! * Math.PI) / 180)
		return name === "skewx"
			? { ...IDENTITY_DESIGN_TRANSFORM, c: tangent }
			: { ...IDENTITY_DESIGN_TRANSFORM, b: tangent }
	}
	throw new Error(
		`Unsupported or malformed SVG transform ${name}(${values.join(" ")}).`,
	)
}

function parseTransform(value: string | undefined): DesignTransform {
	if (value === undefined || value.trim() === "")
		return IDENTITY_DESIGN_TRANSFORM
	let transform: DesignTransform = IDENTITY_DESIGN_TRANSFORM
	const pattern = /([a-zA-Z]+)\s*\(([^)]*)\)/gu
	let matched = ""
	for (const match of value.matchAll(pattern)) {
		const values = (
			match[2]!.match(/[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/gu) ?? []
		).map(Number)
		if (values.some((number) => !Number.isFinite(number)))
			throw new Error(`SVG transform ${match[0]} contains a non-finite number.`)
		transform = multiply(
			transform,
			transformFunction(match[1]!.toLowerCase(), values),
		)
		matched += match[0]
	}
	if (value.replace(pattern, "").replaceAll(",", "").trim() !== "")
		throw new Error(`Malformed SVG transform: ${value}.`)
	void matched
	return transform
}

const numeric = (value: string | undefined, fallback?: number): number => {
	if (value === undefined && fallback !== undefined) return fallback
	if (
		value === undefined ||
		!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?(?:px|pt)?$/u.test(value.trim())
	)
		throw new Error(
			`Expected a finite SVG number, received ${value ?? "nothing"}.`,
		)
	const parsed = Number.parseFloat(value)
	if (!Number.isFinite(parsed))
		throw new Error(`SVG number is not finite: ${value}.`)
	return parsed
}

function points(value: string): readonly Readonly<{ x: number; y: number }>[] {
	const values =
		value.match(/[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/gu)?.map(Number) ??
		[]
	if (values.length % 2 !== 0)
		throw new Error("SVG points must contain x/y pairs.")
	return Array.from({ length: values.length / 2 }, (_, index) => ({
		x: values[index * 2]!,
		y: values[index * 2 + 1]!,
	}))
}

interface ParsedPath {
	readonly contours: readonly Omit<DesignContour, "id">[]
}

type MutablePathPoint = {
	id: string
	x: number
	y: number
	incoming?: { x: number; y: number }
	outgoing?: { x: number; y: number }
}

function parsePath(data: string): ParsedPath {
	const tokens =
		data.match(/[a-zA-Z]|[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/gu) ?? []
	let index = 0
	let command = ""
	let current = { x: 0, y: 0 }
	let start = current
	let lastCubicControl: Readonly<{ x: number; y: number }> | null = null
	let lastQuadraticControl: Readonly<{ x: number; y: number }> | null = null
	let points: MutablePathPoint[] = []
	const contours: Omit<DesignContour, "id">[] = []
	const flush = (closed = false): void => {
		if (points.length > 0) contours.push({ closed, points })
		points = []
	}
	const isCommand = (token: string | undefined): boolean =>
		token !== undefined && /^[a-zA-Z]$/u.test(token)
	const take = (): number => {
		const token = tokens[index++]
		if (token === undefined || isCommand(token))
			throw new Error(`Malformed SVG path data near token ${index}.`)
		return Number(token)
	}
	const point = (relative: boolean): { x: number; y: number } => {
		const x = take()
		const y = take()
		return relative ? { x: current.x + x, y: current.y + y } : { x, y }
	}
	const appendLine = (to: Readonly<{ x: number; y: number }>): void => {
		points.push({ id: "", ...to })
		current = to
		lastCubicControl = null
		lastQuadraticControl = null
	}
	while (index < tokens.length) {
		if (isCommand(tokens[index])) command = tokens[index++]!
		if (command === "")
			throw new Error("SVG path data must begin with a command.")
		const relative = command === command.toLowerCase()
		const kind = command.toUpperCase()
		if (kind === "Z") {
			flush(true)
			current = start
			command = ""
			continue
		}
		if (kind === "A")
			throw new Error("SVG elliptical arc path commands are not supported.")
		if (kind === "M") {
			const to = point(relative)
			flush()
			points = [{ id: "", ...to }]
			current = to
			start = to
			lastCubicControl = null
			lastQuadraticControl = null
			command = relative ? "l" : "L"
			continue
		}
		if (points.length === 0)
			throw new Error(`SVG ${kind} command appears before a move command.`)
		if (kind === "L") appendLine(point(relative))
		else if (kind === "H")
			appendLine({ x: relative ? current.x + take() : take(), y: current.y })
		else if (kind === "V")
			appendLine({ x: current.x, y: relative ? current.y + take() : take() })
		else if (kind === "C") {
			const control1 = point(relative)
			const control2 = point(relative)
			const to = point(relative)
			const previous = points.at(-1)!
			previous.outgoing = {
				x: control1.x - current.x,
				y: control1.y - current.y,
			}
			points.push({
				id: "",
				...to,
				incoming: { x: control2.x - to.x, y: control2.y - to.y },
			})
			current = to
			lastCubicControl = control2
			lastQuadraticControl = null
		} else if (kind === "S") {
			const control1 =
				lastCubicControl === null
					? current
					: {
							x: current.x * 2 - lastCubicControl.x,
							y: current.y * 2 - lastCubicControl.y,
						}
			const control2 = point(relative)
			const to = point(relative)
			const previous = points.at(-1)!
			previous.outgoing = {
				x: control1.x - current.x,
				y: control1.y - current.y,
			}
			points.push({
				id: "",
				...to,
				incoming: { x: control2.x - to.x, y: control2.y - to.y },
			})
			current = to
			lastCubicControl = control2
			lastQuadraticControl = null
		} else if (kind === "Q" || kind === "T") {
			const control: Readonly<{ x: number; y: number }> =
				kind === "Q"
					? point(relative)
					: lastQuadraticControl === null
						? current
						: {
								x: current.x * 2 - lastQuadraticControl.x,
								y: current.y * 2 - lastQuadraticControl.y,
							}
			const to = point(relative)
			const control1 = {
				x: current.x + (2 / 3) * (control.x - current.x),
				y: current.y + (2 / 3) * (control.y - current.y),
			}
			const control2 = {
				x: to.x + (2 / 3) * (control.x - to.x),
				y: to.y + (2 / 3) * (control.y - to.y),
			}
			points.at(-1)!.outgoing = {
				x: control1.x - current.x,
				y: control1.y - current.y,
			}
			points.push({
				id: "",
				...to,
				incoming: { x: control2.x - to.x, y: control2.y - to.y },
			})
			current = to
			lastQuadraticControl = control
			lastCubicControl = null
		} else throw new Error(`Unsupported SVG path command ${kind}.`)
	}
	flush()
	return { contours }
}

const styleAttributes = (element: XmlElement): Record<string, string> => {
	const style: Record<string, string> = {}
	for (const declaration of (element.attributes.style ?? "").split(";")) {
		const separator = declaration.indexOf(":")
		if (separator > 0)
			style[declaration.slice(0, separator).trim().toLowerCase()] = declaration
				.slice(separator + 1)
				.trim()
	}
	return { ...style, ...element.attributes }
}

const colorNames: Readonly<Record<string, string>> = {
	black: "#000000",
	white: "#ffffff",
	red: "#ff0000",
	green: "#008000",
	blue: "#0000ff",
	yellow: "#ffff00",
	cyan: "#00ffff",
	magenta: "#ff00ff",
	gray: "#808080",
	grey: "#808080",
	transparent: "none",
}

function parseColor(
	value: string,
): Readonly<{ r: number; g: number; b: number }> | null | undefined {
	const normalized = (colorNames[value.toLowerCase()] ?? value)
		.trim()
		.toLowerCase()
	if (normalized === "none") return null
	if (/^#[0-9a-f]{3}$/u.test(normalized))
		return {
			r: Number.parseInt(normalized[1]! + normalized[1]!, 16),
			g: Number.parseInt(normalized[2]! + normalized[2]!, 16),
			b: Number.parseInt(normalized[3]! + normalized[3]!, 16),
		}
	if (/^#[0-9a-f]{6}$/u.test(normalized))
		return {
			r: Number.parseInt(normalized.slice(1, 3), 16),
			g: Number.parseInt(normalized.slice(3, 5), 16),
			b: Number.parseInt(normalized.slice(5, 7), 16),
		}
	const rgb =
		/^rgb\(\s*(\d+(?:\.\d+)?)\s*[, ]\s*(\d+(?:\.\d+)?)\s*[, ]\s*(\d+(?:\.\d+)?)\s*\)$/u.exec(
			normalized,
		)
	if (rgb !== null)
		return {
			r: Math.min(255, Number(rgb[1])),
			g: Math.min(255, Number(rgb[2])),
			b: Math.min(255, Number(rgb[3])),
		}
	return undefined
}

function childTitle(element: XmlElement): string | undefined {
	return (
		element.children.find(({ name }) => name === "title")?.text.trim() ||
		undefined
	)
}

export function importSvg(
	source: string,
	document: DesignDocument,
	options: SvgImportOptions = {},
): SvgImportResult {
	const diagnostics: SvgDiagnostic[] = []
	const issue = (
		code: string,
		message: string,
		severity: SvgDiagnostic["severity"] = "warning",
		element?: string,
	): void => {
		diagnostics.push(
			Object.freeze({
				code,
				message,
				severity,
				stage: "import",
				...(element === undefined ? {} : { element }),
			}),
		)
	}
	let root: XmlElement
	try {
		root = parseXml(source)
	} catch (error) {
		issue(
			"svg.import.invalid-xml",
			error instanceof Error ? error.message : String(error),
			"error",
		)
		return Object.freeze({
			diagnostics: Object.freeze(diagnostics),
			document,
			importedObjectIds: Object.freeze([]),
			ok: false,
		})
	}
	const artboard =
		document.artboards.find(({ id }) => id === options.artboardId) ??
		document.artboards[0]
	if (artboard === undefined) {
		issue(
			"svg.import.missing-artboard",
			"SVG import requires a destination artboard.",
			"error",
		)
		return Object.freeze({
			diagnostics: Object.freeze(diagnostics),
			document,
			importedObjectIds: Object.freeze([]),
			ok: false,
		})
	}
	const used = new Set([
		...document.objects.map(({ id }) => id),
		...document.swatches.map(({ id }) => id),
		...(document.groups ?? []).map(({ id }) => id),
	])
	let sequence = 0
	const allocate = (prefix: "object" | "swatch" | "group"): string => {
		for (;;) {
			const suffix = options.nextId?.() ?? `svg-${sequence++}`
			const id = `${prefix}:${suffix}`
			if (!used.has(id)) {
				used.add(id)
				return id
			}
		}
	}
	const rootStyle = styleAttributes(root)
	const viewBoxValues = root.attributes.viewbox
		?.match(/[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/gu)
		?.map(Number)
	let viewBox: readonly [number, number, number, number]
	try {
		viewBox =
			viewBoxValues?.length === 4
				? (viewBoxValues as unknown as [number, number, number, number])
				: [
						0,
						0,
						numeric(root.attributes.width, artboard.width),
						numeric(root.attributes.height, artboard.height),
					]
		if (
			!(viewBox[2] > 0) ||
			!(viewBox[3] > 0) ||
			viewBox.some((value) => !Number.isFinite(value))
		)
			throw new Error(
				"SVG viewBox width and height must be positive finite numbers.",
			)
	} catch (error) {
		issue(
			"svg.import.invalid-viewbox",
			error instanceof Error ? error.message : String(error),
			"error",
			"svg",
		)
		return Object.freeze({
			diagnostics: Object.freeze(diagnostics),
			document,
			importedObjectIds: Object.freeze([]),
			ok: false,
		})
	}
	if (
		root.attributes.preserveaspectratio !== undefined &&
		root.attributes.preserveaspectratio !== "none"
	)
		issue(
			"svg.import.preserve-aspect-ratio",
			"preserveAspectRatio is mapped directly to the destination artboard bounds.",
			"warning",
			"svg",
		)
	const base = multiply(
		{
			a: artboard.width / viewBox[2],
			b: 0,
			c: 0,
			d: artboard.height / viewBox[3],
			e: artboard.x,
			f: artboard.y,
		},
		{ ...IDENTITY_DESIGN_TRANSFORM, e: -viewBox[0], f: -viewBox[1] },
	)
	const objects: DesignObject[] = []
	const groups: DesignGroup[] = []
	const swatches: DesignSwatch[] = []
	const importedObjectIds: string[] = []
	const swatchByColor = new Map<string, string>()
	const swatchFor = (
		color: Readonly<{ r: number; g: number; b: number }>,
	): string => {
		const key = `${color.r},${color.g},${color.b}`
		const existing = swatchByColor.get(key)
		if (existing !== undefined) return existing
		const id = allocate("swatch")
		swatches.push({
			id,
			name: `SVG #${[color.r, color.g, color.b].map((value) => Math.round(value).toString(16).padStart(2, "0")).join("")}`,
			source: { space: "rgb", ...color },
		})
		swatchByColor.set(key, id)
		return id
	}
	const appearance = (
		attributes: Record<string, string>,
		element: XmlElement,
	): DesignAppearance => {
		const result: {
			fill?: { swatchId: string }
			stroke?: NonNullable<DesignAppearance["stroke"]>
		} = {}
		for (const attribute of [
			"filter",
			"mask",
			"clip-path",
			"opacity",
			"fill-opacity",
			"stroke-opacity",
		] as const) {
			const value = attributes[attribute]
			if (
				value !== undefined &&
				!(
					attribute === "clip-path" &&
					value === "url(#create-design-artboard-clip)"
				)
			)
				issue(
					`svg.import.unsupported-${attribute}`,
					`${attribute} is not supported by the create-design source model.`,
					"warning",
					element.name,
				)
		}
		const fillValue = attributes.fill ?? "black"
		const fill = parseColor(fillValue)
		if (fill === undefined)
			issue(
				"svg.import.unsupported-fill",
				`Unsupported SVG fill paint ${fillValue}.`,
				"warning",
				element.name,
			)
		else if (fill !== null) result.fill = { swatchId: swatchFor(fill) }
		const strokeValue = attributes.stroke ?? "none"
		const stroke = parseColor(strokeValue)
		if (stroke === undefined)
			issue(
				"svg.import.unsupported-stroke",
				`Unsupported SVG stroke paint ${strokeValue}.`,
				"warning",
				element.name,
			)
		else if (stroke !== null) {
			try {
				const dashArray =
					attributes["stroke-dasharray"] === undefined ||
					attributes["stroke-dasharray"] === "none"
						? []
						: (
								attributes["stroke-dasharray"].match(
									/[+-]?(?:\d+\.?\d*|\.\d+)/gu,
								) ?? []
							).map(Number)
				result.stroke = {
					swatchId: swatchFor(stroke),
					width: numeric(attributes["stroke-width"], 1),
					cap: (["butt", "round", "square"].includes(
						attributes["stroke-linecap"] ?? "butt",
					)
						? (attributes["stroke-linecap"] ?? "butt")
						: "butt") as "butt" | "round" | "square",
					join: (["miter", "round", "bevel"].includes(
						attributes["stroke-linejoin"] ?? "miter",
					)
						? (attributes["stroke-linejoin"] ?? "miter")
						: "miter") as "miter" | "round" | "bevel",
					miterLimit: numeric(
						attributes["stroke-miterlimit"],
						DEFAULT_DESIGN_STROKE_STYLE.miterLimit,
					),
					dashArray,
					dashOffset: numeric(attributes["stroke-dashoffset"], 0),
				}
			} catch (error) {
				issue(
					"svg.import.invalid-stroke",
					error instanceof Error ? error.message : String(error),
					"warning",
					element.name,
				)
			}
		}
		return result
	}
	const inheritedProperties = [
		"fill",
		"fill-rule",
		"stroke",
		"stroke-width",
		"stroke-linecap",
		"stroke-linejoin",
		"stroke-miterlimit",
		"stroke-dasharray",
		"stroke-dashoffset",
		"opacity",
		"fill-opacity",
		"stroke-opacity",
		"filter",
		"mask",
		"clip-path",
	]
	const importChildren = (
		elements: readonly XmlElement[],
		parentTransform: DesignTransform,
		inherited: Readonly<Record<string, string>>,
	): DesignSceneChild[] => {
		const children: DesignSceneChild[] = []
		for (const element of elements) {
			if (
				element.name === "title" ||
				element.name === "desc" ||
				element.name === "metadata"
			)
				continue
			if (["defs", "clippath"].includes(element.name)) {
				for (const definition of element.children)
					if (
						[
							"lineargradient",
							"radialgradient",
							"pattern",
							"filter",
							"mask",
							"image",
						].includes(definition.name)
					)
						issue(
							`svg.import.unsupported-${definition.name}`,
							`<${definition.name}> definitions are not supported by the create-design source model.`,
							"warning",
							definition.name,
						)
				continue
			}
			if (
				["text", "image", "use", "filter", "mask", "foreignobject"].includes(
					element.name,
				)
			) {
				issue(
					`svg.import.unsupported-${element.name}`,
					`<${element.name}> content was not imported.`,
					"warning",
					element.name,
				)
				continue
			}
			const own = styleAttributes(element)
			const combined: Record<string, string> = { ...inherited }
			for (const property of inheritedProperties)
				if (own[property] !== undefined) combined[property] = own[property]!
			let combinedTransform: DesignTransform
			try {
				combinedTransform = multiply(
					parentTransform,
					parseTransform(own.transform),
				)
			} catch (error) {
				issue(
					"svg.import.unsupported-transform",
					error instanceof Error ? error.message : String(error),
					"warning",
					element.name,
				)
				continue
			}
			if (
				element.name === "g" ||
				element.name === "svg" ||
				element.name === "a"
			) {
				const nested = importChildren(
					element.children,
					combinedTransform,
					combined,
				)
				if (element.name === "g" && nested.length > 0) {
					const id = allocate("group")
					groups.push({
						id,
						name:
							childTitle(element) ??
							element.attributes["aria-label"] ??
							element.attributes.id ??
							"Imported group",
						children: nested,
					})
					children.push({ kind: "group", id })
				} else children.push(...nested)
				continue
			}
			let geometry: DesignObject["geometry"] | null = null
			const objectId = allocate("object")
			try {
				if (element.name === "rect") {
					if (numeric(own.rx, 0) !== 0 || numeric(own.ry, 0) !== 0)
						throw new Error("Rounded SVG rectangles are not supported.")
					geometry = {
						kind: "rectangle",
						x: numeric(own.x, 0),
						y: numeric(own.y, 0),
						width: numeric(own.width),
						height: numeric(own.height),
					}
				} else if (element.name === "ellipse" || element.name === "circle") {
					const radiusX =
						element.name === "circle" ? numeric(own.r) : numeric(own.rx)
					const radiusY = element.name === "circle" ? radiusX : numeric(own.ry)
					geometry = {
						kind: "ellipse",
						centerX: numeric(own.cx, 0),
						centerY: numeric(own.cy, 0),
						radiusX,
						radiusY,
					}
				} else if (["line", "polyline", "polygon"].includes(element.name)) {
					const rawPoints =
						element.name === "line"
							? [
									{ x: numeric(own.x1, 0), y: numeric(own.y1, 0) },
									{ x: numeric(own.x2, 0), y: numeric(own.y2, 0) },
								]
							: points(own.points ?? "")
					geometry = {
						kind: "path",
						fillRule:
							combined["fill-rule"] === "evenodd" ? "evenodd" : "nonzero",
						contours: [
							{
								id: `${objectId}:contour:0`,
								closed: element.name === "polygon",
								points: rawPoints.map((point, pointIndex) => ({
									id: `${objectId}:contour:0:point:${pointIndex}`,
									...point,
								})),
							},
						],
					}
				} else if (element.name === "path") {
					const parsed = parsePath(own.d ?? "")
					geometry = {
						kind: "path",
						fillRule:
							combined["fill-rule"] === "evenodd" ? "evenodd" : "nonzero",
						contours: parsed.contours.map((contour, contourIndex) => ({
							...contour,
							id: `${objectId}:contour:${contourIndex}`,
							points: contour.points.map((point, pointIndex) => ({
								...point,
								id: `${objectId}:contour:${contourIndex}:point:${pointIndex}`,
							})),
						})),
					}
				} else {
					issue(
						"svg.import.unsupported-element",
						`<${element.name}> content was not imported.`,
						"warning",
						element.name,
					)
					continue
				}
			} catch (error) {
				issue(
					"svg.import.unsupported-geometry",
					error instanceof Error ? error.message : String(error),
					"warning",
					element.name,
				)
				continue
			}
			const object: DesignObject = {
				id: objectId,
				name: childTitle(element) ?? own.id ?? `Imported ${element.name}`,
				geometry,
				transform: combinedTransform,
				appearance: appearance(combined, element),
			}
			objects.push(object)
			importedObjectIds.push(object.id)
			children.push({ kind: "object", id: object.id })
		}
		return children
	}
	const importedScene = importChildren(root.children, base, rootStyle)
	if (objects.length === 0 && diagnostics.length > 0)
		return Object.freeze({
			diagnostics: Object.freeze(diagnostics),
			document,
			importedObjectIds: Object.freeze([]),
			ok: false,
		})
	const nextDocument: DesignDocument = {
		...document,
		swatches: [...document.swatches, ...swatches],
		objects: [...document.objects, ...objects],
		scene: [
			...(document.scene ??
				document.objects.map(({ id }) => ({ kind: "object" as const, id }))),
			...importedScene,
		],
		groups: [...(document.groups ?? []), ...groups],
	}
	return Object.freeze({
		diagnostics: Object.freeze(diagnostics),
		document: nextDocument,
		importedObjectIds: Object.freeze(importedObjectIds),
		ok: true,
	})
}
