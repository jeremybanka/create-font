import { DEFAULT_DESIGN_STROKE_STYLE } from "@create-design/source"

import type {
	DesignAppearance,
	DesignObject,
	DesignStroke,
	DesignSwatch,
} from "./types.ts"

export type AppearancePaintTarget = "fill" | "stroke"
export type AppearancePaintValue = string | null | "mixed"

export interface DesignAppearanceSummary {
	readonly fill: AppearancePaintValue
	readonly stroke: AppearancePaintValue
	readonly strokeStyle: DesignStrokeSummary
}

export type AppearancePropertyValue<Value> = Value | null | "mixed"

export interface DesignStrokeSummary {
	readonly width: AppearancePropertyValue<number>
	readonly cap: AppearancePropertyValue<DesignStroke["cap"]>
	readonly join: AppearancePropertyValue<DesignStroke["join"]>
	readonly miterLimit: AppearancePropertyValue<number>
	readonly dashArray: AppearancePropertyValue<readonly number[]>
	readonly dashOffset: AppearancePropertyValue<number>
}

/** The create-design authoring default for a newly enabled stroke. */
export const DEFAULT_DESIGN_STROKE_WIDTH = 1

export function defaultDesignAppearance(
	swatches: readonly DesignSwatch[],
): DesignAppearance {
	const swatch =
		swatches.find((candidate) => candidate.id === "swatch:coral") ?? swatches[0]
	return swatch === undefined ? {} : { fill: { swatchId: swatch.id } }
}

export function validDesignAppearance(
	appearance: DesignAppearance,
	swatches: readonly DesignSwatch[],
): DesignAppearance {
	const ids = new Set(swatches.map((swatch) => swatch.id))
	return {
		...(appearance.fill !== undefined && ids.has(appearance.fill.swatchId)
			? { fill: appearance.fill }
			: {}),
		...(appearance.stroke !== undefined && ids.has(appearance.stroke.swatchId)
			? { stroke: appearance.stroke }
			: {}),
	}
}

function paintValue(
	appearances: readonly DesignAppearance[],
	target: AppearancePaintTarget,
): AppearancePaintValue {
	const values = appearances.map(
		(appearance) => appearance[target]?.swatchId ?? null,
	)
	const first = values[0] ?? null
	return values.every((value) => value === first) ? first : "mixed"
}

function strokePropertyValue<Key extends keyof Omit<DesignStroke, "swatchId">>(
	appearances: readonly DesignAppearance[],
	key: Key,
): AppearancePropertyValue<DesignStroke[Key]> {
	const values = appearances.map(
		(appearance) => appearance.stroke?.[key] ?? null,
	)
	const first = values[0] ?? null
	const equal = values.every((value) =>
		Array.isArray(first) && Array.isArray(value)
			? first.length === value.length &&
				first.every((entry, index) => entry === value[index])
			: value === first,
	)
	return equal ? (first as AppearancePropertyValue<DesignStroke[Key]>) : "mixed"
}

export function summarizeDesignAppearance(
	objects: readonly DesignObject[],
	current: DesignAppearance,
): DesignAppearanceSummary {
	const appearances =
		objects.length === 0
			? [current]
			: objects.map((object) => object.appearance)
	return {
		fill: paintValue(appearances, "fill"),
		stroke: paintValue(appearances, "stroke"),
		strokeStyle: {
			width: strokePropertyValue(appearances, "width"),
			cap: strokePropertyValue(appearances, "cap"),
			join: strokePropertyValue(appearances, "join"),
			miterLimit: strokePropertyValue(appearances, "miterLimit"),
			dashArray: strokePropertyValue(appearances, "dashArray"),
			dashOffset: strokePropertyValue(appearances, "dashOffset"),
		},
	}
}

export function updateDesignStroke(
	appearance: DesignAppearance,
	properties: Partial<Omit<DesignStroke, "swatchId">>,
): DesignAppearance {
	return appearance.stroke === undefined
		? appearance
		: { ...appearance, stroke: { ...appearance.stroke, ...properties } }
}

export function setDesignAppearancePaint(
	appearance: DesignAppearance,
	target: AppearancePaintTarget,
	swatchId: string | undefined,
): DesignAppearance {
	if (target === "fill") {
		const { fill: _fill, ...rest } = appearance
		return swatchId === undefined ? rest : { ...rest, fill: { swatchId } }
	}
	const { stroke: _stroke, ...rest } = appearance
	return swatchId === undefined
		? rest
		: {
				...rest,
				stroke: {
					...(appearance.stroke ?? DEFAULT_DESIGN_STROKE_STYLE),
					swatchId,
					width: appearance.stroke?.width ?? DEFAULT_DESIGN_STROKE_WIDTH,
				},
			}
}

export function swapDesignAppearancePaints(
	appearance: DesignAppearance,
): DesignAppearance {
	const fillId = appearance.fill?.swatchId
	const strokeId = appearance.stroke?.swatchId
	return {
		...(strokeId === undefined ? {} : { fill: { swatchId: strokeId } }),
		...(fillId === undefined
			? {}
			: {
					stroke: {
						...(appearance.stroke ?? DEFAULT_DESIGN_STROKE_STYLE),
						swatchId: fillId,
						width: appearance.stroke?.width ?? DEFAULT_DESIGN_STROKE_WIDTH,
					},
				}),
	}
}
