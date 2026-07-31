export interface Point {
	readonly x: number
	readonly y: number
}

export interface Cubic {
	readonly p0: Point
	readonly c1: Point
	readonly c2: Point
	readonly p3: Point
}

export interface Contour {
	readonly points: readonly Point[]
	readonly closed: boolean
}

export interface Bounds {
	readonly minX: number
	readonly minY: number
	readonly maxX: number
	readonly maxY: number
}

export type Orientation = "clockwise" | "counter-clockwise" | "degenerate"

export interface ParameterizedPoint extends Point {
	/** Normalized parameter on the source primitive. */
	readonly parameter: number
}
