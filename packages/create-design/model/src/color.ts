import type {
	CmykColor,
	ColorDefinition,
	DesignSwatch,
	RgbColor,
} from "@create-design/source"

const clamp = (value: number, maximum: number): number =>
	Math.min(maximum, Math.max(0, Number.isFinite(value) ? value : 0))

const round = (value: number, places = 2): number => {
	const factor = 10 ** places
	return Math.round(value * factor) / factor
}

export function normalizeColor(color: ColorDefinition): ColorDefinition {
	return color.space === "rgb"
		? {
				space: "rgb",
				r: Math.round(clamp(color.r, 255)),
				g: Math.round(clamp(color.g, 255)),
				b: Math.round(clamp(color.b, 255)),
			}
		: {
				space: "cmyk",
				c: round(clamp(color.c, 100)),
				m: round(clamp(color.m, 100)),
				y: round(clamp(color.y, 100)),
				k: round(clamp(color.k, 100)),
			}
}

export function cmykToRgb(color: CmykColor): RgbColor {
	const normalized = normalizeColor(color) as CmykColor
	const c = normalized.c / 100
	const m = normalized.m / 100
	const y = normalized.y / 100
	const k = normalized.k / 100
	return {
		space: "rgb",
		r: Math.round(255 * (1 - c) * (1 - k)),
		g: Math.round(255 * (1 - m) * (1 - k)),
		b: Math.round(255 * (1 - y) * (1 - k)),
	}
}

export function rgbToCmyk(color: RgbColor): CmykColor {
	const normalized = normalizeColor(color) as RgbColor
	const r = normalized.r / 255
	const g = normalized.g / 255
	const b = normalized.b / 255
	const k = 1 - Math.max(r, g, b)
	if (k >= 1) return { space: "cmyk", c: 0, m: 0, y: 0, k: 100 }
	return {
		space: "cmyk",
		c: round(((1 - r - k) / (1 - k)) * 100),
		m: round(((1 - g - k) / (1 - k)) * 100),
		y: round(((1 - b - k) / (1 - k)) * 100),
		k: round(k * 100),
	}
}

export function resolvedRgb(swatch: DesignSwatch): RgbColor {
	if (swatch.source.space === "rgb") {
		return normalizeColor(swatch.source) as RgbColor
	}
	if (swatch.alternate?.space === "rgb") {
		return normalizeColor(swatch.alternate) as RgbColor
	}
	return cmykToRgb(swatch.source)
}

export function resolvedCmyk(swatch: DesignSwatch): CmykColor {
	if (swatch.source.space === "cmyk") {
		return normalizeColor(swatch.source) as CmykColor
	}
	if (swatch.alternate?.space === "cmyk") {
		return normalizeColor(swatch.alternate) as CmykColor
	}
	return rgbToCmyk(swatch.source)
}

export function swatchCss(swatch: DesignSwatch): string {
	const { r, g, b } = resolvedRgb(swatch)
	return `rgb(${r} ${g} ${b})`
}

export function oppositeColorSpace(
	color: ColorDefinition,
): ColorDefinition["space"] {
	return color.space === "rgb" ? "cmyk" : "rgb"
}
