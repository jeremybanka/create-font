export interface CurvePoint {
	readonly x: number
	readonly y: number
}

export interface CubicCurve {
	readonly p0: CurvePoint
	readonly c1: CurvePoint
	readonly c2: CurvePoint
	readonly p3: CurvePoint
}

export interface CubicSplit {
	readonly point: CurvePoint
	readonly left: CubicCurve
	readonly right: CubicCurve
}

export const interpolateCurvePoint = (
	left: CurvePoint,
	right: CurvePoint,
	amount: number,
): CurvePoint => ({
	x: left.x + (right.x - left.x) * amount,
	y: left.y + (right.y - left.y) * amount,
})

export function evaluateCubicCurve(
	cubic: CubicCurve,
	amount: number,
): CurvePoint {
	const inverse = 1 - amount
	const inverseSquared = inverse * inverse
	const amountSquared = amount * amount
	return {
		x:
			inverseSquared * inverse * cubic.p0.x +
			3 * inverseSquared * amount * cubic.c1.x +
			3 * inverse * amountSquared * cubic.c2.x +
			amountSquared * amount * cubic.p3.x,
		y:
			inverseSquared * inverse * cubic.p0.y +
			3 * inverseSquared * amount * cubic.c1.y +
			3 * inverse * amountSquared * cubic.c2.y +
			amountSquared * amount * cubic.p3.y,
	}
}

/** Exact de Casteljau subdivision at a normalized curve parameter. */
export function splitCubicCurve(cubic: CubicCurve, amount: number): CubicSplit {
	if (!Number.isFinite(amount) || amount < 0 || amount > 1) {
		throw new RangeError("Cubic split parameter must be in [0, 1].")
	}
	const p01 = interpolateCurvePoint(cubic.p0, cubic.c1, amount)
	const p12 = interpolateCurvePoint(cubic.c1, cubic.c2, amount)
	const p23 = interpolateCurvePoint(cubic.c2, cubic.p3, amount)
	const p012 = interpolateCurvePoint(p01, p12, amount)
	const p123 = interpolateCurvePoint(p12, p23, amount)
	const point = interpolateCurvePoint(p012, p123, amount)
	return {
		point,
		left: { p0: cubic.p0, c1: p01, c2: p012, p3: point },
		right: { p0: point, c1: p123, c2: p23, p3: cubic.p3 },
	}
}
