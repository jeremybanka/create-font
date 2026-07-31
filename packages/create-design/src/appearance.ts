import type { DesignAppearance, DesignObject, DesignSwatch } from "./types.ts"

export type AppearancePaintTarget = "fill" | "stroke"
export type AppearancePaintValue = string | null | "mixed"

export interface DesignAppearanceSummary {
	readonly fill: AppearancePaintValue
	readonly stroke: AppearancePaintValue
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
	}
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
						swatchId: fillId,
						width: appearance.stroke?.width ?? DEFAULT_DESIGN_STROKE_WIDTH,
					},
				}),
	}
}
